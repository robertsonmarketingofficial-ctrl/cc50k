import csv
import email
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from coldflow import campaigns, db, inboxes, leads, planner, replies, scheduler, sender
from coldflow.config import load_settings
from coldflow.templates import missing_fields, render

ROOT = Path(__file__).resolve().parent.parent
MONDAY = date(2026, 10, 19)


class PlannerTests(unittest.TestCase):
    def test_monthly_50k(self):
        plan = planner.build_plan(planner.PlanInputs(target_emails=50_000, period="month"))
        self.assertEqual(plan.emails_per_day, 2381)
        self.assertEqual(plan.active_inboxes, 80)
        self.assertEqual(plan.total_inboxes, 92)
        self.assertEqual(plan.domains, 31)
        self.assertEqual(plan.new_leads, 16667)

    def test_weekly_50k(self):
        plan = planner.build_plan(planner.PlanInputs(target_emails=50_000, period="week"))
        self.assertEqual(plan.emails_per_day, 10_000)
        self.assertEqual(plan.active_inboxes, 334)
        self.assertEqual(plan.total_inboxes, 385)
        self.assertEqual(plan.domains, 129)


class TemplateTests(unittest.TestCase):
    def test_fallbacks_and_nesting(self):
        ctx = {"first_name": "", "city": "Tampa", "industry": "roofing"}
        text = "Hi {{first_name|there}}, {{icebreaker|saw {{industry|service}} firms in {{city|town}}.}}"
        self.assertEqual(render(text, ctx), "Hi there, saw roofing firms in Tampa.")

    def test_missing_without_fallback(self):
        self.assertEqual(missing_fields("Hi {{first_name}}", {"first_name": " "}), ["first_name"])
        self.assertEqual(missing_fields("Hi {{first_name|there}}", {}), [])


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        cfg = self.dir / "coldflow.toml"
        cfg.write_text('[company]\nname = "Test Agency"\nphysical_address = "1 Test St, Testville"\n')
        self.settings = load_settings(cfg)
        self.settings["sending"].update(min_delay_seconds=0, max_delay_seconds=0)
        self.conn = db.connect(self.settings.path("db"))

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def write_csv(self, name, rows):
        path = self.dir / name
        with path.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        return path

    def add_inboxes(self, n, warm_start):
        rows = [{"email": f"s{i}@send{i // 3}.com", "from_name": "Sam Seller", "provider": "google",
                 "warmup_start": warm_start.isoformat()} for i in range(n)]
        inboxes.import_csv(self.conn, self.write_csv("inboxes.csv", rows), 30)

    def add_leads(self, n, per_domain=1):
        rows = [{"Email": f"owner{i}@biz{i // per_domain}.com", "First Name": f"Pat{i}", "Company Name": f"Biz {i}",
                 "verification": "valid"} for i in range(n)]
        return leads.import_csv(self.conn, self.write_csv("leads.csv", rows), self.settings["leads"])


class LeadTests(Fixture):
    def test_hygiene(self):
        rows = [
            {"email": "good@acme.com", "verification": "valid"},
            {"email": "info@acme.com", "verification": "valid"},
            {"email": "someone@gmail.com", "verification": "valid"},
            {"email": "risky@acme.com", "verification": "catch-all"},
            {"email": "bad@acme.com", "verification": "invalid"},
            {"email": "not-an-email", "verification": ""},
            {"email": "GOOD@acme.com", "verification": "valid"},
            {"email": "blocked@nope.com", "verification": "valid"},
        ]
        db.suppress(self.conn, "nope.com", "competitor")
        stats = leads.import_csv(self.conn, self.write_csv("l.csv", rows), self.settings["leads"])
        self.assertEqual(stats["imported"], 1)
        self.assertEqual(stats["duplicate"], 1)
        for reason in ("role_account", "free_mail", "catch_all", "verifier_invalid", "bad_syntax", "suppressed"):
            self.assertEqual(stats[f"rejected_{reason}"], 1, reason)


class FlowTests(Fixture):
    def setUp(self):
        super().setUp()
        campaigns.register(self.conn, ROOT / "campaigns" / "local-services.toml")

    def test_warmup_ramp(self):
        row = {"warmup_start": "2026-10-01", "daily_cap": 30}
        w = self.settings["warmup"]
        self.assertEqual(inboxes.cap_for(row, date(2026, 10, 14), w), 0)
        self.assertEqual(inboxes.cap_for(row, date(2026, 10, 15), w), 5)
        self.assertEqual(inboxes.cap_for(row, date(2026, 10, 25), w), 25)
        self.assertEqual(inboxes.cap_for(row, date(2026, 11, 30), w), 30)

    def test_schedule_respects_caps_and_company_limit(self):
        self.add_inboxes(3, MONDAY - timedelta(days=60))
        self.add_leads(200, per_domain=5)
        self.assertEqual(campaigns.enroll(self.conn, "local-services"), 200)
        stats = scheduler.build_queue(self.conn, MONDAY, self.settings)
        # 3 inboxes x 30 cap x 0.6 new share = 54 first-touch emails
        self.assertEqual(stats["new_queued"], 54)
        per_inbox = self.conn.execute(
            "SELECT MAX(n) FROM (SELECT COUNT(*) n FROM sends GROUP BY inbox_id)").fetchone()[0]
        self.assertLessEqual(per_inbox, 18)
        per_domain = self.conn.execute(
            """SELECT MAX(n) FROM (SELECT COUNT(*) n FROM sends s JOIN leads l ON l.id=s.lead_id
               GROUP BY l.domain)""").fetchone()[0]
        self.assertLessEqual(per_domain, 2)
        # Scheduling again the same day adds nothing.
        self.assertEqual(scheduler.build_queue(self.conn, MONDAY, self.settings)["new_queued"], 0)

    def test_no_sends_on_weekend_or_during_warmup(self):
        self.add_inboxes(3, MONDAY - timedelta(days=3))
        self.add_leads(20)
        campaigns.enroll(self.conn, "local-services")
        self.assertEqual(scheduler.build_queue(self.conn, MONDAY + timedelta(days=5), self.settings)["not_a_sending_day"], 1)
        self.assertEqual(scheduler.build_queue(self.conn, MONDAY, self.settings)["new_queued"], 0)

    def test_dry_run_then_sequence_advances_and_reply_stops_it(self):
        self.add_inboxes(1, MONDAY - timedelta(days=60))
        self.add_leads(3)
        campaigns.enroll(self.conn, "local-services")
        scheduler.build_queue(self.conn, MONDAY, self.settings)

        stats = sender.run(self.conn, MONDAY, self.settings, live=False, log=lambda *_: None)
        self.assertEqual(stats["dry_run_written"], 3)
        eml = sorted((self.settings.path("outbox") / MONDAY.isoformat()).glob("*.eml"))[0]
        msg = email.message_from_bytes(eml.read_bytes())
        body = msg.get_payload(decode=True).decode()
        self.assertIn("1 Test St, Testville", body)
        self.assertIn("no thanks", body)
        self.assertNotIn("{{", body + msg["Subject"])
        self.assertTrue(msg["List-Unsubscribe"].startswith("<mailto:"))

        # Simulate live sends without SMTP.
        self.enterContext(mock.patch.object(sender, "_connect", return_value=mock.MagicMock()))
        stats = sender.run(self.conn, MONDAY, self.settings, live=True, ignore_window=True, log=lambda *_: None)
        self.assertEqual(stats["sent"], 3)
        enr = self.conn.execute("SELECT * FROM enrollments ORDER BY id").fetchall()
        self.assertTrue(all(e["step"] == 1 and e["next_send_date"] == "2026-10-22" for e in enr))

        # Lead 1 replies; lead 2 bounces.
        lead1, lead2 = [r["email"] for r in self.conn.execute("SELECT email FROM leads ORDER BY id LIMIT 2")]
        reply = email.message_from_string(
            f"From: Pat <{lead1}>\nSubject: Re: hi\nMessage-ID: <r1@x>\n\nSounds good, let's talk Tuesday.\n\n"
            f"On Mon, Oct 19, 2026 Sam wrote:\n> Hi Pat")
        bounce = email.message_from_string(
            "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\nSubject: Delivery Status Notification (Failure)\n"
            f"Message-ID: <b1@x>\n\nAddress not found. Final-Recipient: rfc822; {lead2}\n")
        self.assertEqual(replies.apply(self.conn, 1, reply), "interested")
        self.assertEqual(replies.apply(self.conn, 1, bounce), "bounce")
        self.assertIsNone(replies.apply(self.conn, 1, reply))  # duplicate ignored
        self.assertTrue(db.is_suppressed(self.conn, lead2))

        stats = scheduler.build_queue(self.conn, date(2026, 10, 22), self.settings)
        self.assertEqual(stats["followups_queued"], 1)
        sender.run(self.conn, date(2026, 10, 22), self.settings, live=True, ignore_window=True, log=lambda *_: None)
        follow = self.conn.execute("SELECT subject FROM sends WHERE step=1 AND status='sent'").fetchone()
        self.assertTrue(follow["subject"].startswith("Re: "))

    def test_edit_markers_found(self):
        camp = campaigns.load_campaign(ROOT / "campaigns" / "local-services.toml")
        self.assertTrue(camp.edit_markers())


class ClassifierTests(unittest.TestCase):
    def kind(self, subject, body, **headers):
        raw = "".join(f"{k.replace('_', '-')}: {v}\n" for k, v in headers.items())
        return replies.classify(email.message_from_string(f"From: a@b.com\nSubject: {subject}\n{raw}\n{body}"))[0]

    def test_kinds(self):
        self.assertEqual(self.kind("Re: hi", "Please remove me from your list"), "unsubscribe")
        self.assertEqual(self.kind("Re: hi", "Not interested, thanks"), "not_interested")
        self.assertEqual(self.kind("Re: hi", "How much does this cost?"), "interested")
        self.assertEqual(self.kind("Re: hi", "Who is this?"), "reply")
        self.assertEqual(self.kind("Automatic reply: hi", "I'm away"), "auto_reply")
        self.assertEqual(self.kind("Re: hi", "Away until Monday", Auto_Submitted="auto-replied"), "auto_reply")


if __name__ == "__main__":
    unittest.main()
