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
- **Provider mix: about half Microsoft, half Google.** Recipients on Outlook tend to get better
  placement from Microsoft senders and vice versa, and the mix spreads risk. Cheapest options
  ([09 Cheapest setup](09_cheapest_setup.md)): **Exchange Online Plan 1** ($4, bought direct from
  Microsoft) and **cold-email Google Workspace resellers** (~$3-3.90). The direct options are
  Google Workspace Business Starter ($7 annual) and Microsoft 365 Business Basic ($7).
- **Microsoft: at most about 25 inboxes per tenant.** Microsoft applies outbound limits and spam
  blocks to the whole tenant, so split the fleet across 2 or more tenants.
- **Google inboxes sign in with an app password.** 2-Step Verification must be on first. coldflow
  reads the password from an environment variable. If you buy from a reseller, confirm they give
  you IMAP/SMTP access with app passwords before paying.
- **Microsoft inboxes sign in with OAuth.** Microsoft is retiring password sign-in for SMTP.
  coldflow uses OAuth (XOAUTH2) for them automatically; setup is below.

```bash
python -m coldflow inboxes import my_inboxes.csv   # provider=microsoft rows default to auth=oauth
python -m coldflow inboxes env                      # the .env lines to fill in for Google inboxes
python -m coldflow auth login                       # one browser sign-in per Microsoft inbox
python -m coldflow auth status                      # every inbox should say "ok"
```

### Microsoft OAuth (one-time setup)

Do this once. One app registration covers all your tenants.

1. **Register the app.** Entra admin center → *App registrations* → *New registration*.
   - Name: `coldflow`
   - Supported account types: *Accounts in any organizational directory* (so the same app works
     in every tenant)
   - No redirect URI
2. **Allow device-code sign-in.** In the app: *Authentication* → *Allow public client flows* → **Yes**.
3. **Add permissions.** *API permissions* → *Add a permission* → *APIs my organization uses* →
   **Office 365 Exchange Online** → *Delegated* → tick **SMTP.Send** and **IMAP.AccessAsUser.All**.
   Then click *Grant admin consent*.
4. **Turn on authenticated SMTP for each sending mailbox.** Microsoft 365 admin center → *Users* →
   (user) → *Mail* → *Manage email apps* → tick **Authenticated SMTP** and **IMAP**. For many
   mailboxes at once, use PowerShell: `Set-CASMailbox <user> -SmtpClientAuthenticationDisabled $false`.
   OAuth SMTP still needs this setting on.
5. **Point coldflow at the app.** Copy the app's *Application (client) ID* into `coldflow.toml`
   under `[oauth_microsoft] client_id`.
6. **Sign in each inbox.** Run `python -m coldflow auth login`. For each Microsoft inbox it prints a
   code: open the link in a **private browser window**, sign in **as that inbox**, and approve. In
   each additional tenant, have that tenant's admin do the first sign-in and tick *Consent on behalf
   of your organization*.
7. Tokens are stored in `data/tokens.json` (file mode 600) and renew automatically. They expire
   after about 90 days without use, so an inbox that has been paused longer needs `auth login --email` again.
   `auth status` shows any inbox that needs it, and the daily alert does too.

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

- Connect every inbox to a **warmup service**. It sends and replies to real-looking emails so
  mailbox providers see normal activity. `coldflow` does **not** do warmup itself; it enforces the
  cold-sending ramp around it.
- **Cheapest option:** Instantly's Growth plan ($47/mo) warms an unlimited number of inboxes, and
  warmup doesn't count toward its sending limit. Connect all inboxes, turn on warmup, and don't run
  campaigns there. Per-inbox warmup tools ($9-29 each) cost $830+ a month for 92 inboxes.
- coldflow ignores warmup traffic when it reads inboxes: it only downloads messages from leads it
  emailed and bounce notices.
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
