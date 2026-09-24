# The cheapest way to send 50k a month

**About $700/month (~$0.014 per email)**, down from ~$1,020 with Instantly doing the sending and
~$2,000 with a per-inbox warmup tool. Prices checked September 2026; confirm before buying.

```bash
python -m coldflow plan                   # lean stack + comparison of all three
python -m coldflow plan --period week     # the same at 50k/week
```

## Where the money goes, and the cheapest option for each line

| Line | Cheapest option that still works | Phase 1 cost |
|---|---|---|
| **Inboxes (92)** | Half **Microsoft Exchange Online Plan 1** ($4/inbox, annual, bought direct from Microsoft), half **cold-email Google Workspace reseller** inboxes (~$3-3.90) | **~$320-370** |
| **Domains (31)** | Plain `.com` from Porkbun, Namecheap or Cloudflare (at cost) | **~$31** ($372/yr up front) |
| **Warmup** | **Instantly Growth plan, $47/mo** ($37.60 on annual). Unlimited inboxes and unlimited warmup, and warmup doesn't count against the plan's email limit. Use it for **warmup only** | **$38-47** |
| **Sending** | **coldflow** on a $5-6/month server | **~$6** |
| **Lead data** | Google Maps scrapers for local niches; one Apollo seat for B2B titles | **~$50-150** |
| **Verification** | MillionVerifier: ~25k checks a month to keep ~16.7k good leads | **~$60-90** |
| **Total** | | **~$500-700/mo** |

The planner uses $4/inbox and $0.015/lead (data plus verification), which gives **$702/mo**.
Cheap lead sources pull that down toward $500.

### Why this combination is the cheapest

1. **Warmup is the most expensive line if you pay per inbox.** At $9-29 per inbox, 92 inboxes cost
   $830-2,700 a month for warmup alone. Instantly's cheapest plan warms any number of inboxes for $47.
2. **Sending is free if you run it yourself.** Instantly's own sending needs the $97+ plan at this
   volume. coldflow sends through your own inboxes at no cost, and it now handles Microsoft sign-in
   (OAuth), so the cheap Microsoft inboxes work.
3. **Inboxes are the biggest line, so the per-inbox price matters most.** $4 instead of $7 saves
   about $275 a month at Phase 1 and about $1,150 at Phase 2.

## Set it up

1. **Microsoft (about 46 inboxes).** Buy Exchange Online (Plan 1) licenses. Spread the inboxes
   across **2 tenants (about 23 each)**: Microsoft applies outbound limits and spam blocks per
   tenant, so one flagged tenant then can't stop all of them. Create the Entra app registration
   ([02 Infrastructure](02_infrastructure_setup.md#microsoft-oauth-one-time-setup)), then run
   `python -m coldflow auth login` once per tenant batch.
2. **Google (about 46 inboxes)** from a cold-email Workspace reseller. Before paying, confirm with
   them that:
   - cold outreach is allowed on their accounts
   - you get **IMAP/SMTP access with app passwords** (coldflow needs it; some resellers only
     support connecting through a sending tool's OAuth)
   - you can export or move the inboxes if you leave
3. **Warmup:** sign up for Instantly Growth, connect all 92 inboxes (Microsoft via OAuth, Google via
   app password), turn on warmup, and **don't create campaigns there**. coldflow ignores warmup
   mail when it reads inboxes, because it only downloads messages from leads and bounces.
4. **coldflow** does everything else: `daily --live` from cron, alerts to Slack or email.

## Phase 2 (50k/week) on the lean stack

| | Lean | Hybrid (Instantly sends) | DIY + per-inbox warmup |
|---|---|---|---|
| Monthly | **~$2,800** | ~$4,180 | ~$8,530 |

Instantly Growth still covers warmup for all 385 inboxes. The savings grow with scale.

## Cheaper still, and why I wouldn't

| Idea | Saves | Why not |
|---|---|---|
| Zoho Mail (~$1/inbox) or similar budget hosts | ~$250/mo | Their terms prohibit bulk/cold email, and deliverability to Gmail/Outlook is weaker |
| "Private SMTP" inbox providers (~$2-3, custom servers) | ~$100/mo | Fine for a few inboxes; agency tests report inconsistent inbox placement at 100+ |
| 40 emails/inbox/day instead of 30 (69 inboxes) | ~$90/mo | Burns domains faster; replacing them costs more than you save |
| Skipping warmup or verification | $50-100/mo | Bounces and spam placement take the whole fleet down |
| Instantly Growth *sending* instead of coldflow | $0 | Capped at 5,000 emails/month; only warmup is unlimited |

## Trade-offs of the lean stack (what you give up)

- **You run the sender yourself.** coldflow needs a server, cron and someone who can read a log
  line. The daily summary alert covers most of the watching.
- **Reseller dependency.** You don't own the Google tenant. Keep the domains in **your** registrar
  account so you can move inboxes if needed.
- **Microsoft OAuth setup** is a one-time 20-30 minutes per tenant (app registration, one browser
  sign-in per inbox).
- **Replies are spread across 92 inboxes.** coldflow reads them all for you. Use the dashboard's "Replies
  to handle" list, or forward all inboxes to one shared mailbox.

## When to pay more

Switch to the **hybrid** stack (Instantly Hypergrowth does the sending, ~$1,020/mo) if nobody on
the team can look after a server. You pay about $320/month more to avoid running your own sender.
