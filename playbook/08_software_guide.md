# Software guide: coldflow

Stdlib-only Python 3.11+, one SQLite file. Runs on any always-on Mac, Linux or Windows machine,
or a $5-10/month VPS.

## Install

```bash
unzip cc50k-email-system.zip && cd cc50k
python3 --version                      # 3.11 or newer
pip install dnspython                  # optional: dns-check and MX checks on import
python -m coldflow init
python -m unittest discover -s tests   # should print OK
```

On Windows, `pip install tzdata` if timezone names aren't recognized.

## How the pieces fit

```
leads ──enroll──► enrollments (pending)
                      │  schedule (per day)
                      ▼
inboxes ─ cap_for(day) ─► sends (queued) ──send──► SMTP ──► sends (sent), enrollment step+1
                                                          next_send_date = day + gap
IMAP ──replies──► events (reply / interested / not_interested / unsubscribe / bounce / auto_reply)
                      └─► enrollment stopped, suppression list updated, inbox health
```

- **Schedule** puts due follow-ups first, on the inbox that started each thread. New leads fill
  what's left, up to `new_lead_share` of each inbox's cap and at most
  `max_per_company_domain_per_day` per company. Re-running it on the same day adds nothing extra.
- **Send** interleaves inboxes with a random 2-6 minute gap per inbox. Right before each email it
  re-checks that the lead hasn't replied or opted out. It stops at `window_end`, and whatever is
  left rolls over to the next day.
  - **Connection reuse:** each inbox keeps its SMTP session open between emails for up to
    `smtp_reuse_seconds` (240) and reconnects when the server has dropped it. With 2-6 minute gaps,
    many emails skip a new TLS handshake and login; the daily summary shows the login count.
  - **Crash safety:** an email is marked `sending` (with its Message-ID) before it goes out. If the
    process dies there, the next run marks it sent and moves the sequence on, rather than risk a
    duplicate.
  - **Failures:** a refused recipient (550) is treated as a hard bounce and suppressed. Temporary
    errors stay queued and are retried on later runs, up to `max_attempts` (3). Sign-in failures
    keep the inbox's queue intact without using up attempts.
- **Replies** checks up to 8 inboxes in parallel (`imap_workers`), read-only.
  - **Only new mail:** it remembers the last message it saw in each inbox, so each sweep reads only
    what arrived since. If the mailbox is rebuilt it falls back to the last 3 days.
  - **Headers first:** it downloads headers and fetches the full message only when it's from a lead
    that inbox emailed (or their company) or is a bounce notice. Warmup traffic is never downloaded.
  - `replies --deep --days 14` re-reads two weeks to catch late bounces (weekly cron).
  - A reply from a colleague at the same company counts as a reply for that company.

## Commands

| Command | What it does |
|---|---|
| `init` | Create `coldflow.toml` and the database |
| `plan [--period week\|month] [--target N] [--per-inbox 30] [--per-domain 3] [--steps 3] [--inbox-cost] [--lead-cost] [--reply-rate] [--deal-value] [--ramp-csv f]` | Infrastructure, cost and funnel math |
| `inboxes import FILE` | Add or update inboxes (email, from_name, provider, password_env, daily_cap, warmup_start) |
| `inboxes list` / `env` | Caps and health / print env var lines for passwords |
| `inboxes pause\|resume\|retire --email X` | Manual control |
| `leads enrich FILE [--niche local\|ecom\|b2b] [--min-score N] [--out F]` | Visit each lead's website; add fit score, tier, icebreaker and audit notes (run before import) |
| `leads import FILE [--source tag]` | Clean and import leads |
| `leads suppress FILE [--reason]` | Add emails or domains to the do-not-contact list; stops in-flight sequences |
| `leads export [OUT] [--status new]` | Clean CSV for a hosted sending tool |
| `leads count` | Leads by status |
| `campaign add FILE` | Register or refresh a campaign file |
| `campaign enroll NAME [--limit N] [--filter col=val]` | Queue fresh leads into a campaign |
| `campaign preview NAME [--lead EMAIL]` | Render every step and variant for a lead |
| `campaign pause\|resume NAME` / `campaign list` | |
| `schedule [--date]` | Build the day's queue |
| `send [--date] [--live] [--limit N] [--ignore-window]` | Dry run writes `.eml` files; `--live` sends |
| `replies [--deep] [--days 3]` | IMAP sweep (new mail only; `--deep` re-reads `--days`) + health check |
| `auth login [--email X]` | Microsoft OAuth sign-in (all OAuth inboxes without a token, or one) |
| `auth status` | Check every inbox can sign in (password set / token valid) |
| `alert-test` | Send today's summary to the configured webhook/email |
| `health` | Auto-pause inboxes over bounce/opt-out limits |
| `status` / `dashboard [--out]` | Terminal summary / HTML dashboard |
| `export [--interested-only] [--out]` | Replies CSV for your CRM |
| `dns-check [domains…]` | MX/SPF/DKIM/DMARC check |
| `daily [--live]` | replies → schedule → send → dashboard → summary alert (sent even if a step crashes) |

Use `--config path/to/other.toml` to run a second, separate instance (for example, one per machine
at Phase 2 scale).

## Inbox CSV

```
email,from_name,provider,auth,password_env,daily_cap,warmup_start
alex@getacme-media.com,Alex Robertson,google,password,,30,2026-10-01
alex@tryacmemedia.com,Alex Robertson,microsoft,oauth,,30,2026-10-01
```

- `auth`: `password` (app password in an env var) or `oauth` (Microsoft; default for
  `provider=microsoft`). See [02 Infrastructure](02_infrastructure_setup.md#microsoft-oauth-one-time-setup).

- `provider`: `google`, `microsoft` or `zoho` sets the SMTP/IMAP hosts. Custom hosts can go in
  `smtp_host,smtp_port,imap_host,imap_port`.
- `password_env` blank → `CF_PW_<EMAIL>` (see `inboxes env`). Not used for OAuth inboxes.

## Campaign file

```toml
name = "local-services"
[filters]                    # optional
industry = ["roofing", "hvac"]
[[steps]]
day = 0
  [[steps.variants]]
  subject = "..."
  body = """..."""
[[steps]]
day = 3                      # blank subject = reply in the same thread
  [[steps.variants]]
  subject = ""
  body = """..."""
```

Set `new_thread = true` on a step to start a fresh thread (it then needs its own subject).

## Go-live checklist

- [ ] `coldflow.toml`: real company name, postal address, timezone, window
- [ ] All `[[PLACEHOLDERS]]` replaced (live sending refuses otherwise)
- [ ] `dns-check` clean; every inbox warmed ≥ 14 days (`inboxes list` shows cap > 0)
- [ ] Do-not-contact list loaded
- [ ] `campaign preview` read for 10+ random leads
- [ ] Dry-run `.eml` files read
- [ ] `send --live --limit 10` sent to real leads, and you checked the Sent folder of those inboxes
- [ ] `auth status` shows every inbox "ok"
- [ ] `alert-test` arrives in Slack/email
- [ ] Cron installed; `replies` runs at least 3 times a day
- [ ] Database backed up nightly (`data/coldflow.db`)

## Limits to know

- Reply classification uses keyword rules. Skim "reply" and "not_interested" events in the
  dashboard; nothing is ever auto-answered.
- The software controls cold volume, not warmup. Use a warmup service alongside it (cheapest:
  Instantly Growth, see [09](09_cheapest_setup.md)).
- Google inboxes still use app passwords. If your Workspace admin (or reseller) disables them,
  those inboxes need a hosted sender, or Google OAuth added to coldflow.
- Nothing checks inbox placement (spam vs inbox). Send a weekly test to seed accounts you own on
  Gmail and Outlook.
