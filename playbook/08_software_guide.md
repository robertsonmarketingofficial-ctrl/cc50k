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
- **Replies** reads the last 3 days of each inbox (read-only, messages aren't marked read),
  classifies each message, and ignores warmup traffic from non-leads. A reply from a colleague at
  the same company counts as a reply for that company.

## Commands

| Command | What it does |
|---|---|
| `init` | Create `coldflow.toml` and the database |
| `plan [--period week\|month] [--target N] [--per-inbox 30] [--per-domain 3] [--steps 3] [--inbox-cost] [--lead-cost] [--reply-rate] [--deal-value] [--ramp-csv f]` | Infrastructure, cost and funnel math |
| `inboxes import FILE` | Add or update inboxes (email, from_name, provider, password_env, daily_cap, warmup_start) |
| `inboxes list` / `env` | Caps and health / print env var lines for passwords |
| `inboxes pause\|resume\|retire --email X` | Manual control |
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
| `replies [--days 3]` | IMAP sweep + health check |
| `health` | Auto-pause inboxes over bounce/opt-out limits |
| `status` / `dashboard [--out]` | Terminal summary / HTML dashboard |
| `export [--interested-only] [--out]` | Replies CSV for your CRM |
| `dns-check [domains…]` | MX/SPF/DKIM/DMARC check |
| `daily [--live]` | replies → schedule → send → dashboard |

Use `--config path/to/other.toml` to run a second, separate instance (for example, one per machine
at Phase 2 scale).

## Inbox CSV

```
email,from_name,provider,password_env,daily_cap,warmup_start
alex@getacme-media.com,Alex Robertson,google,,30,2026-10-01
```

- `provider`: `google`, `microsoft` or `zoho` sets the SMTP/IMAP hosts. Custom hosts can go in
  `smtp_host,smtp_port,imap_host,imap_port`.
- `password_env` blank → `CF_PW_<EMAIL>` (see `inboxes env`).

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
- [ ] Cron installed; `replies` runs at least 3 times a day
- [ ] Database backed up nightly (`data/coldflow.db`)

## Limits to know

- Reply classification uses keyword rules. Skim "reply" and "not_interested" events in the
  dashboard; nothing is ever auto-answered.
- Bounces that arrive more than 3 days late are missed unless you run `replies --days 14` weekly.
- The software controls cold volume, not warmup. Use a warmup service alongside it.
