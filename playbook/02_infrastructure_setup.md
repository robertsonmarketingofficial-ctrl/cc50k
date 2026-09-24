# Infrastructure setup

Track each domain in `templates/domain_tracker.csv`.

## 1. Domains

- **Never send cold email from your main agency domain.** If a secondary domain gets flagged,
  you retire it. If your main domain gets flagged, your client email and invoices go to spam.
- Buy lookalike `.com` domains: `get<brand>.com`, `<brand>media.com`, `try<brand>.com`,
  `<brand>-agency.com`, `<brand>hq.com`. Avoid hyphen soup and odd TLDs (.xyz, .top, .info).
- Buy from one registrar that has an easy API or bulk DNS editing (Porkbun, Namecheap and
  Cloudflare Registrar are all common choices).
- **Redirect each domain to your main website** (301 forward) so anyone who checks it sees a real
  business.
- Domains don't need to be old, but give them the 14-day warmup.

## 2. Inboxes

- **3 inboxes per domain**, each a real-looking person: `alex@`, `alex.r@`, `a.robertson@`. Use
  real names from your team (or a consistent persona you'll actually answer as). Add a profile photo.
- Provider mix: mostly Google Workspace, with about 25-40% Microsoft 365 if you can. Recipients on
  Outlook tend to get better placement from Microsoft senders and vice versa, and the mix spreads risk.
- For each inbox, create an **app password** (Google needs 2-Step Verification on first; Microsoft
  needs SMTP AUTH enabled for the mailbox). `coldflow` reads it from an environment variable:

```bash
python -m coldflow inboxes import my_inboxes.csv
python -m coldflow inboxes env     # prints the export lines to fill in; keep them in a private .env
```

- **Microsoft 365 note:** SMTP AUTH is disabled by default and Microsoft has been retiring basic
  auth. If app-password SMTP isn't available on your tenant, run those inboxes through a hosted
  sender that supports OAuth, and use `coldflow` for leads and planning.
- **Google note:** if Google turns off app-password access for your Workspace, switch those inboxes
  to a hosted sender too, or use a Workspace admin setting that still allows it. Check this in week 0.

## 3. DNS for every domain (do all of this before warmup)

| Record | Host | Value (example) |
|---|---|---|
| MX | `@` | Google: `smtp.google.com` (priority 1). Microsoft: `<domain>.mail.protection.outlook.com` |
| SPF (TXT) | `@` | Google: `v=spf1 include:_spf.google.com ~all` · Microsoft: `v=spf1 include:spf.protection.outlook.com ~all` |
| DKIM | Google: `google._domainkey` TXT from Admin → Apps → Gmail → Authenticate email. Microsoft: `selector1/selector2._domainkey` CNAMEs from Defender portal | 2048-bit key |
| DMARC (TXT) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@<your main domain>` |

- Start DMARC at `p=none` while you watch reports, then move to `p=quarantine` after 2-4 weeks of
  clean reports. Google and Yahoo require DMARC for bulk senders.
- Only one SPF record per domain. If you add another service, merge the includes.
- Check everything:

```bash
pip install dnspython
python -m coldflow dns-check              # every domain in your inbox list
python -m coldflow dns-check getacme-media.com
```

Also send a test to https://www.mail-tester.com from each new domain and aim for 9/10 or better.

## 4. Warmup (14 days minimum, then keep it running)

- Connect every inbox to a **warmup service** (most cold email tools include one, or use a
  standalone one). It sends and replies to real-looking emails so mailbox providers see normal
  activity. `coldflow` does **not** do warmup itself; it enforces the cold-sending ramp around it.
- Warmup volume: start around 5-10/day, rising to 20-40/day. **Keep warmup on permanently**, even
  at full cold volume.
- `coldflow` settings (`[warmup]` in `coldflow.toml`):
  - `warmup_only_days = 14`: no cold email at all for 14 days after `warmup_start`
  - then `ramp_start = 5`, `ramp_step = 2` up to `default_daily_cap = 30`
- Set each inbox's `warmup_start` in the CSV to the day you really turned warmup on.

## 5. Sending hygiene (already enforced by coldflow)

- Plain text only. No images, attachments or tracking pixels. No links in email 1.
- 2-6 minutes between two emails from the same inbox; business hours, weekdays.
- At most 2 first-touch emails per company domain per day.
- Follow-ups reply in the same thread from the same inbox.

## 6. Rotation and retirement

- Keep about 15% of inboxes as spares that are warmed but not sending cold. When `coldflow`
  auto-pauses an inbox, or a domain lands on a blocklist, swap in a spare the same day.
- Check your domains against the major blocklists (Spamhaus DBL, SURBL, URIBL) weekly with any
  free MX/blacklist lookup tool.
- A paused inbox gets **warmup only for 2 weeks**, then comes back at the ramp start. A domain
  flagged twice gets retired: `python -m coldflow inboxes retire --email ...` for each inbox,
  and buy a replacement.
- Plan on replacing roughly 10-20% of domains per quarter at Phase 1 volume.
