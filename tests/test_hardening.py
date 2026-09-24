"""Tests for the reliability fixes: SMTP reuse, crash recovery, retries, incremental IMAP,
Microsoft OAuth, alerts and stack pricing."""
import email
import json
import os
import smtplib
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from coldflow import alerts, auth, campaigns, db, inboxes, planner, replies, scheduler, sender
from coldflow.config import load_settings

ROOT = Path(__file__).resolve().parent.parent
MONDAY = date(2026, 10, 19)
QUIET = dict(log=lambda *_: None)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        cfg = self.dir / "coldflow.toml"
        cfg.write_text('[company]\nname = "Test Agency"\nphysical_address = "1 Test St"\n'
                       '[oauth_microsoft]\nclient_id = "cid"\n')
        self.settings = load_settings(cfg)
        self.settings["sending"].update(min_delay_seconds=0, max_delay_seconds=0)
        self.conn = db.connect(self.settings.path("db"))
        self.enterContext(mock.patch.dict(os.environ, {"CF_PW_S0_AT_SEND0_COM": "pw", "CF_PW_S1_AT_SEND0_COM": "pw"}))
        campaigns.register(self.conn, ROOT / "campaigns" / "local-services.toml")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def add_inboxes(self, n=1, provider="google"):
        path = self.dir / "inb.csv"
        rows = "\n".join(f"s{i}@send0.com,Sam Seller,{provider},{(MONDAY - timedelta(days=60)).isoformat()}"
                         for i in range(n))
        path.write_text("email,from_name,provider,warmup_start\n" + rows + "\n")
        inboxes.import_csv(self.conn, path, 30)

    def add_leads(self, n):
        for i in range(n):
            self.conn.execute("INSERT INTO leads (email, domain, first_name, company) VALUES (?,?,?,?)",
                              (f"owner{i}@biz{i}.com", f"biz{i}.com", f"Pat{i}", f"Biz {i}"))
        self.conn.commit()
        campaigns.enroll(self.conn, "local-services")
        scheduler.build_queue(self.conn, MONDAY, self.settings)

    def run_live(self, **kw):
        return sender.run(self.conn, MONDAY, self.settings, live=True, ignore_window=True, **QUIET, **kw)


class SmtpPoolTests(Base):
    def test_reuses_session_and_reconnects_when_stale(self):
        self.add_inboxes(1)
        servers = [mock.MagicMock(), mock.MagicMock()]
        servers[0].send_message.side_effect = [None, smtplib.SMTPServerDisconnected("idle"), None]
        with mock.patch.object(sender, "_connect", side_effect=servers) as connect:
            pool = sender.SmtpPool(self.settings)
            inbox = self.conn.execute("SELECT * FROM inboxes").fetchone()
            pool.send(inbox, email.message.EmailMessage())
            pool.send(inbox, email.message.EmailMessage())   # reused session drops -> fresh login
            pool.send(inbox, email.message.EmailMessage())   # reuses the new session
            self.assertEqual(connect.call_count, 2)
            self.assertEqual(pool.logins, 2)
            self.assertEqual(servers[1].send_message.call_count, 2)
            pool.close()

    def test_one_login_per_inbox_for_a_day(self):
        self.add_inboxes(2)
        self.add_leads(10)
        with mock.patch.object(sender, "_connect", side_effect=lambda *a: mock.MagicMock()):
            stats = self.run_live()
        self.assertEqual(stats["sent"], 10)
        self.assertEqual(stats["smtp_logins"], 2)


class FailureHandlingTests(Base):
    def test_crash_mid_send_is_not_resent(self):
        self.add_inboxes(1)
        self.add_leads(1)
        send = self.conn.execute("SELECT * FROM sends").fetchone()
        self.conn.execute("UPDATE sends SET status='sending', message_id='<m@x>', subject='hello' WHERE id=?",
                          (send["id"],))
        self.conn.commit()
        with mock.patch.object(sender, "_connect") as connect:
            stats = self.run_live()
        connect.assert_not_called()
        self.assertEqual(stats["recovered_interrupted"], 1)
        enr = self.conn.execute("SELECT * FROM enrollments").fetchone()
        self.assertEqual((enr["step"], enr["thread_message_id"]), (1, "<m@x>"))

    def test_refused_recipient_is_suppressed(self):
        self.add_inboxes(1)
        self.add_leads(1)
        server = mock.MagicMock()
        server.send_message.side_effect = smtplib.SMTPRecipientsRefused({"owner0@biz0.com": (550, b"no such user")})
        with mock.patch.object(sender, "_connect", return_value=server):
            stats = self.run_live()
        self.assertEqual(stats["send_rejected"], 1)
        self.assertTrue(db.is_suppressed(self.conn, "owner0@biz0.com"))

    def test_transient_error_retries_then_gives_up(self):
        self.add_inboxes(1)
        self.add_leads(1)
        with mock.patch.object(sender, "_connect", side_effect=smtplib.SMTPDataError(451, b"try later")):
            for expected in ("retry", "retry", "failed"):
                self.assertEqual(self.run_live()[f"send_{expected}"], 1)
        self.assertEqual(self.conn.execute("SELECT status FROM enrollments").fetchone()[0], "stopped")

    def test_auth_failure_keeps_queue_without_burning_attempts(self):
        self.add_inboxes(1)
        self.add_leads(3)
        with mock.patch.object(sender, "_connect", side_effect=smtplib.SMTPAuthenticationError(535, b"bad")) as c:
            stats = self.run_live()
        self.assertEqual(c.call_count, 1)  # stopped trying this inbox after the first failure
        self.assertEqual(stats["inbox_auth_failed"], 1)
        rows = self.conn.execute("SELECT status, attempts FROM sends").fetchall()
        self.assertTrue(all(r["status"] == "queued" and r["attempts"] == 0 for r in rows))


def raw(uid_from, subject, body, **headers):
    extra = "".join(f"{k.replace('_', '-')}: {v}\n" for k, v in headers.items())
    return f"From: {uid_from}\nSubject: {subject}\nMessage-ID: <{abs(hash((uid_from, subject, body)))}@x>\n{extra}\n{body}\n".encode()


class FakeIMAP:
    def __init__(self, mailbox, uidvalidity=7):
        self.mailbox, self.uidvalidity = mailbox, uidvalidity
        self.searches, self.full_fetches, self.auth = [], [], None

    def login(self, user, password):
        self.auth = ("LOGIN", user)

    def authenticate(self, mech, cb):
        self.auth = (mech, cb(b""))

    def select(self, name, readonly=False):
        return "OK", [str(len(self.mailbox)).encode()]

    def response(self, code):
        return code, [str(self.uidvalidity).encode()]

    def uid(self, cmd, *args):
        if cmd == "SEARCH":
            self.searches.append(args)
            if args[0] == "UID":
                lo = int(args[1].split(":")[0])
                uids = [u for u in self.mailbox if u >= lo] or [max(self.mailbox)]
            else:
                uids = list(self.mailbox)
            return "OK", [" ".join(map(str, sorted(uids))).encode()]
        uids = [int(x) for x in args[0].split(",")]
        if "HEADER.FIELDS" in args[1]:
            parts = []
            for u in uids:
                hdr = self.mailbox[u].split(b"\n\n", 1)[0] + b"\n\n"
                parts += [(f"{u} (UID {u} BODY[HEADER.FIELDS (FROM)] {{{len(hdr)}}}".encode(), hdr), b")"]
            return "OK", parts
        self.full_fetches += uids
        return "OK", [(f"{uids[0]} (UID {uids[0]} BODY[] {{1}}".encode(), self.mailbox[uids[0]]), b")"]

    def logout(self):
        pass


class ImapTests(Base):
    def test_incremental_header_first_sweep(self):
        self.add_inboxes(1)
        self.add_leads(2)
        with mock.patch.object(sender, "_connect", return_value=mock.MagicMock()):
            self.run_live()
        box = {
            1: raw("warmup@other.com", "hi friend", "warmup chatter"),
            2: raw("owner0@biz0.com", "Re: hi", "How much does this cost?"),
            3: raw("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification",
                   "Final-Recipient: rfc822; owner1@biz1.com"),
        }
        fake = FakeIMAP(box)
        fetcher = lambda job: replies.fetch_inbox(job, imap_factory=lambda h, p: fake)  # noqa: E731
        stats, problems = replies.poll(self.conn, self.settings, fetcher=fetcher, **QUIET)
        self.assertEqual(problems, [])
        self.assertEqual(stats["messages_scanned"], 3)
        self.assertEqual(sorted(fake.full_fetches), [2, 3])  # warmup mail never downloaded
        self.assertEqual((stats["interested"], stats["bounce"]), (1, 1))
        self.assertEqual(fake.searches[0][0], "SINCE")

        # Second sweep: only UIDs after 3 are requested; nothing new -> nothing scanned.
        stats, _ = replies.poll(self.conn, self.settings, fetcher=fetcher, **QUIET)
        self.assertEqual(fake.searches[-1], ("UID", "4:*"))
        self.assertEqual(stats["messages_scanned"], 0)

        # New mail arrives.
        box[4] = raw("owner0@biz0.com", "Re: hi", "also, call me tomorrow")
        stats, _ = replies.poll(self.conn, self.settings, fetcher=fetcher, **QUIET)
        self.assertEqual(stats["messages_scanned"], 1)

        # Mailbox rebuilt (UIDVALIDITY changes) -> falls back to a date search.
        fake.uidvalidity = 99
        replies.poll(self.conn, self.settings, fetcher=fetcher, **QUIET)
        self.assertEqual(fake.searches[-1][0], "SINCE")

    def test_imap_error_reported_not_raised(self):
        self.add_inboxes(1)

        def boom(host, port):
            raise OSError("connection refused")

        stats, problems = replies.poll(self.conn, self.settings,
                                       fetcher=lambda job: replies.fetch_inbox(job, imap_factory=boom), **QUIET)
        self.assertEqual(stats["inbox_errors"], 1)
        self.assertIn("connection refused", problems[0])


class OAuthTests(Base):
    def test_microsoft_defaults_to_oauth(self):
        self.add_inboxes(1, provider="microsoft")
        row = self.conn.execute("SELECT auth, smtp_host FROM inboxes").fetchone()
        self.assertEqual((row["auth"], row["smtp_host"]), ("oauth", "smtp.office365.com"))

    def test_device_login_then_cached_then_refresh(self):
        store = auth.TokenStore(self.settings.path("tokens"))
        replies_ = iter([
            {"device_code": "dc", "user_code": "ABC", "verification_uri": "https://microsoft.com/devicelogin",
             "interval": 1, "expires_in": 60, "message": "go sign in"},
            {"error": "authorization_pending"},
            {"access_token": "AT1", "refresh_token": "RT1", "expires_in": 3600},
        ])
        auth.device_login("a@b.com", self.settings["oauth_microsoft"], store,
                          post=lambda url, data: next(replies_), log=lambda *_: None, sleep=lambda s: None)
        self.assertEqual(oct(os.stat(store.path).st_mode & 0o777), "0o600")
        calls = []

        def post(url, data):
            calls.append(data)
            return {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 3600}

        cfg = self.settings["oauth_microsoft"]
        self.assertEqual(auth.access_token("a@b.com", cfg, store, post=post), "AT1")  # cached
        self.assertEqual(calls, [])
        later = lambda: 10**10  # noqa: E731
        self.assertEqual(auth.access_token("a@b.com", cfg, store, post=post, now=later), "AT2")
        self.assertEqual(calls[0]["refresh_token"], "RT1")
        self.assertEqual(store.get("a@b.com")["refresh_token"], "RT2")  # rotated token saved

    def test_xoauth2_used_for_smtp_and_imap(self):
        self.add_inboxes(1, provider="microsoft")
        inbox = self.conn.execute("SELECT * FROM inboxes").fetchone()
        server = mock.MagicMock()
        auth.smtp_login(server, inbox, "TOKEN")
        mech, cb = server.auth.call_args[0]
        self.assertEqual(mech, "XOAUTH2")
        self.assertEqual(cb(), "user=s0@send0.com\x01auth=Bearer TOKEN\x01\x01")
        self.assertEqual(cb(b"error"), "")
        imap = FakeIMAP({1: b"x"})
        auth.imap_login(imap, "oauth", "s0@send0.com", "TOKEN")
        self.assertEqual(imap.auth, ("XOAUTH2", b"user=s0@send0.com\x01auth=Bearer TOKEN\x01\x01"))

    def test_missing_token_is_a_clear_error(self):
        self.add_inboxes(1, provider="microsoft")
        inbox = self.conn.execute("SELECT * FROM inboxes").fetchone()
        with self.assertRaisesRegex(auth.AuthError, "auth login"):
            auth.secret_for(inbox, self.settings)


class AlertTests(Base):
    def test_summary_warns_and_webhook_posts(self):
        self.add_inboxes(2)
        self.conn.execute("UPDATE inboxes SET status='paused', paused_reason='bounce rate 4.0% over 7d' WHERE id=1")
        self.conn.commit()
        subject, text, warn = alerts.build_summary(self.conn, self.settings, MONDAY, problems=["x@y.com: IMAP down"])
        self.assertTrue(warn)
        self.assertIn("Inbox paused: s0@send0.com", text)
        self.assertIn("Lead supply low", text)
        self.assertIn("IMAP down", text)
        posted = []
        self.settings["alerts"]["webhook_url"] = "https://hooks.example/abc"
        used = alerts.notify(self.settings, subject, text, post=lambda url, payload: posted.append((url, payload)))
        self.assertEqual(used, ["webhook"])
        self.assertIn("warning", json.dumps(posted[0][1]))

    def test_no_channels_configured(self):
        self.assertEqual(alerts.notify(self.settings, "s", "t"), [])


class StackTests(unittest.TestCase):
    def test_lean_is_cheapest(self):
        costs = {name: cost for name, cost, _ in planner.compare_stacks(planner.PlanInputs())}
        self.assertLess(costs["lean"], costs["hybrid"])
        self.assertLess(costs["hybrid"], costs["diy"])

    def test_hypergrowth_blocks(self):
        self.assertEqual(planner.tool_cost("instantly_hypergrowth", 50_000, 16_667), 97)
        self.assertEqual(planner.tool_cost("instantly_hypergrowth", 217_000, 72_000), 97 + 87 * 2)


if __name__ == "__main__":
    unittest.main()
