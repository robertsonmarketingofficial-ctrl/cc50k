# Daily and weekly operations

## Daily (sending days), about 30-60 minutes plus replies

| When | Task | Command |
|---|---|---|
| 7:30 | Automated run: sweep replies → health check → build queue → send → dashboard | `python -m coldflow daily --live` (cron, see `scripts/`) |
| 8:00 | Open `reports/dashboard.html`. Any paused inboxes? Any bounce rate climbing? | `python -m coldflow status` |
| 8:00-17:00 | **Answer positive replies within 1 hour**, from the same inbox | Gmail/Outlook or a unified inbox |
| 12:00 + 16:00 | Sweep replies again so opt-outs and replies stop the sequence fast | `python -m coldflow replies` |
| 17:00 | Log positive replies and booked calls in the CRM | `python -m coldflow export --interested-only` |

**The send run takes a while.** At Phase 1 (≈2,400 emails over 80 inboxes, 2-6 minute gaps per
inbox) it takes about 2 hours. Start it early enough that it finishes before `window_end`. Anything
unsent rolls to the next day automatically.

## Weekly (Monday morning, about 1 hour)

1. **Numbers review** (fill the table below from `status` and the dashboard).
2. **Inbox health:** replace auto-paused inboxes with spares; check blocklists; review Google
   Postmaster Tools.
3. **Copy:** decide A/B winners (300+ leads per variant), write the next challenger.
4. **Leads:** make sure next week's ~4,200 leads are verified, imported and enrolled.
5. **Do-not-contact list:** add new clients and anyone who asked not to be contacted.

| Week | Sent | Leads contacted | Reply % | Positive | Calls booked | Bounce % | Paused inboxes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## KPIs and thresholds

| Metric | Healthy | Warning, investigate | Stop and fix |
|---|---|---|---|
| Bounce rate | < 1.5% | 1.5-3% | > 3% (auto-pause) |
| Reply rate (per lead) | > 2% | 1-2% | < 0.5% for 2+ weeks |
| Positive share of replies | > 35% | 20-35% | < 20% |
| Opt-out / "remove me" rate | < 0.5% | 0.5-2% | > 2% (auto-pause) |
| Spam complaint rate (Postmaster) | < 0.1% | 0.1-0.3% | > 0.3% |

## Troubleshooting

**Reply rate suddenly drops (same copy, same niche)** → deliverability. Send tests from a few
inboxes to seed accounts you own on Gmail and Outlook, and check whether they land in spam. If so:
lower caps to 15/day for a week, check DNS (`dns-check`), check blocklists, and remove any links.

**Bounces over 3%** → the list. Re-verify, stop catch-alls, check the source. The inbox is paused;
give it 2 weeks of warmup only.

**Lots of replies, few positives** → targeting or offer. Narrow the ICP, sharpen the proof, change the CTA.

**Many "who are you?" replies** → the message lacks context. Add a clearer "why you, why now" line.

**SMTP auth failures** → the app password was revoked or 2-Step Verification was changed. Recreate
the app password and update the env var. `coldflow` skips that inbox for the day and continues.

## Roles (when you hire help)

| Role | Owns |
|---|---|
| You / closer | Positive replies, calls, offer and copy decisions |
| Ops VA | Lead pulls, verification, imports, daily status, CRM logging |
| Tech (part-time) | Domains, DNS, inbox provisioning, server/cron |
