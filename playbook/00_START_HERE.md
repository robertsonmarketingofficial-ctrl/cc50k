# Start here

**Goal:** 50,000 cold B2B emails per month (Phase 1), with a path to 50,000 per week (Phase 2),
to book sales calls for the agency.

## Read in this order

| # | Doc | What you get |
|---|-----|--------------|
| 01 | [Capacity and budget](01_capacity_and_budget.md) | How many domains, inboxes, leads and dollars |
| 02 | [Infrastructure setup](02_infrastructure_setup.md) | Domains, inboxes, SPF/DKIM/DMARC, warmup |
| 03 | [Lead sourcing](03_lead_sourcing.md) | Where the ~17k leads a month come from, and how to clean them |
| 04 | [Offer and copy](04_offer_and_copy.md) | What to say, and how to test it |
| 05 | [Compliance](05_compliance.md) | CAN-SPAM, GDPR/PECR, CASL: who you can email and how |
| 06 | [Daily and weekly operations](06_operations_sop.md) | The routine, reply handling, KPIs, what to do when numbers drop |
| 07 | [90-day rollout](07_90_day_rollout.md) | Week-by-week plan from zero to full volume |
| 08 | [Software guide](08_software_guide.md) | Every `coldflow` command and how the pieces fit |
| 09 | [Cheapest setup](09_cheapest_setup.md) | The ~$700/month way to run 50k/month, and what you trade for it |

## The whole system on one page

```
 Lead sources ─► verify ─► coldflow leads import ─► campaign enroll
 (Apollo, etc.)  (bounce     (dedupe, role/free-mail    (by niche)
                  checker)    filters, suppression)
                                                          │
 92 inboxes on 31 secondary domains ◄── schedule ◄────────┘
 (warmed 14 days, ramp 5→30/day)       (follow-ups first, caps, 2 per company/day)
          │
          ▼
 send --live  (plain text, spaced 2-6 min per inbox, 8am-5pm Mon-Fri)
          │
          ▼
 replies  (IMAP sweep) ─► interested/reply ─► YOU reply within 1 business hour ─► booked call
                       ─► opt-out/bounce ─► do-not-contact list, sequence stopped
                       ─► health check ─► auto-pause bad inboxes
          │
          ▼
 dashboard + weekly review ─► rewrite copy / swap lists / retire burned domains
```

## Decisions made for you (change them if you disagree)

- **Sending method (lean stack, ~$700/month):** about half Microsoft Exchange Online ($4) and half
  reseller Google Workspace (~$3-3.90) inboxes on secondary domains. `coldflow` sends and rotates
  (Microsoft via OAuth), and Instantly's $47 Growth plan does warmup only. ESPs such as SES,
  SendGrid and Mailchimp prohibit cold email and will shut the account down.
- **Per-inbox volume:** 30 cold emails a day. Going higher is where most setups burn out.
- **Sequence:** 3 emails over about 8 days, plain text, no links in email 1. 50k emails means
  about 16.7k new leads a month.
- **Sending days:** Monday to Friday, 8am-5pm in your timezone.
- **Tracking:** no open or click tracking. Tracking pixels and rewritten links hurt inbox
  placement, and opens are unreliable anyway. Replies are the metric.

## Before you do anything else, get these ready

1. A real postal address for the footer (a PO box or registered virtual mailbox is fine in the US).
2. One or two proof points: client results with numbers. The copy has `[[ONE-LINE PROOF]]`
   slots that must be filled before the software will send.
3. Your niches. Pick 1-3 from the campaign files, or write your own.
4. A booking link and a process for fast replies. Positive replies go cold within hours.
