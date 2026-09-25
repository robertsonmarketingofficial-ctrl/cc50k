# Automation audit: where the manual hours go

Audited: the coldflow code, campaigns, templates, scripts and playbook SOPs (03 lead sourcing,
06 operations, the offers). There is no live data yet (no database, CRM or client accounts in the repo),
so hours below are **estimates for Phase 1 volume** (~4,200 leads/week, ~1,500-2,000 unique businesses),
not measurements. Re-check them after 4 weeks of real running.

## Already automated (no action)

Data cleaning and dedupe, role/free-mail filtering, suppression, follow-up sequencing, inbox ramp-up,
reply triage (interested / not now / unsubscribe / bounce / auto-reply), bounce handling, inbox health
alerts, the daily dashboard, DNS checks. These were the biggest manual jobs in a cold email operation
and coldflow already does them.

## Still manual: opportunities ranked by value

| # | Task | Manual effort now | Frequency | Complexity to automate | Time saved | Business impact | Dependencies | Failure risks |
|---|---|---|---|---|---|---|---|---|
| 1 | **Lead research, qualification and icebreakers** (open each site, judge fit, write a line) | ~1 min per business → **25-33 h/week**, or $150-350/mo in enrichment tool credits. In practice it gets skipped | Weekly, every batch | Low (**built: `leads enrich`**) | ~25-30 h/week (leaves 20 min of spot-checks) | **High**: better fit means fewer wasted sends and more replies; tier-A leads go first | A `Website` column or business email domain; internet from the machine running it | JS-loaded widgets missed (handled: absences never go into emails); sites that block bots show as unreachable; wrong-company domain |
| 2 | **Reply → CRM logging** (run `export --interested-only`, paste into CRM or sheet) | ~2 min per interested reply, 15-40 a week → ~0.5-1.5 h/week, plus leads forgotten | Daily | Low: POST each interested reply to a Google Sheet / HubSpot webhook from `replies` | ~1 h/week | **High**: slow follow-up on a hot reply is the most expensive leak in the funnel | CRM API key or Sheet webhook | Duplicate rows (key on message ID); an expired token fails silently, so alert on it |
| 3 | **Weekly numbers review** (fill the table in 06_operations_sop by hand) | 30-45 min | Weekly | Low: `report` already has the numbers; add a weekly CSV/markdown output | ~30-40 min/week | Medium: you'll actually look at it, and spot a burning domain sooner | None | Low |
| 4 | **Email verification** (upload to MillionVerifier, download, re-import) | ~20 min | Weekly | Low: API call in a script | ~15-20 min/week | Medium: skipped verification means bounces, which burn domains | MillionVerifier API key and credits | Re-running burns credits (cache results by email) |
| 5 | **Revenue Leak Audit prep** (45-60 min per prospect) | 45-60 min × 3-10 booked audits → 3-10 h/week | Per booked call | Low-medium: `audit_notes` from #1 already pre-fills the website half; next step is filling an audit doc template | ~15-25 min per audit | High: faster audits mean more calls handled | #1; an audit template | Unverified "not seen" claims reaching a prospect. The notes say "verify" for that reason |
| 6 | **Proposals** from call notes | 45-60 min each, 2-5 a week | Per qualified call | Low: one fill-in proposal template per offer (price, scope, guarantee pre-written) | ~30-40 min each | Medium-high: same-day proposals close more | Offer pricing locked in (see Offers) | Wrong price or scope. A human always reads it before sending |
| 7 | **Client onboarding** (Missed-Call Rescue setup 2-4 h per client) | 2-4 h | 1-4 clients/month | Medium: intake form + a saved GoHighLevel/Twilio snapshot + checklist | 1-2 h per client | Medium: faster go-live, fewer mistakes | GHL snapshot access, Twilio | Misconfigured call forwarding means the client loses calls. Always test-call before handover |
| 8 | **Client monthly reports** | ~1 h per client | Monthly | Medium: pull from GHL/Twilio APIs | ~45 min per client | Grows with client count; not worth it under ~5 clients | Client platform API access | Wrong numbers damage trust. Keep a manual review |
| 9 | Mystery-shop calls | 10-15 min each | Per audit | Don't automate | — | — | — | Call-recording consent laws; the human call is the point |
| 10 | Domain/inbox purchase | 1-2 h per batch | Every few months | Not worth it (`dnscheck` already verifies setup) | — | Low | — | — |

## Priority order

1. **Website enrichment**: done. The biggest block of manual hours, and it lifts the whole funnel.
2. **Interested reply → CRM/Sheet**: about 30 lines added to `replies`. Do this once replies start arriving.
3. **Weekly report output** and **verification API**: small and mechanical; do them together.
4. **Proposal and audit templates**: documents, not code. Write once per offer.
5. Onboarding snapshot and client reporting: only after the first 3-5 clients show what repeats.

Don't build a platform. Each item above is a script or a template. Add the next one only when the
manual version is costing you more than an hour a week.
