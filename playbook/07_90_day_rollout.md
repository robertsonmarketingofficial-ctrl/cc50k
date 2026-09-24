# 90-day rollout

Phase 1 target: **50,000 emails a month by week 5.** Phase 2 (50k/week) is a decision at day 60-90.

## Week 0: build (days 1-5)

- [ ] Choose 1-2 niches and fill the `[[ONE-LINE PROOF]]` slots in their campaign files
- [ ] Buy **31 domains**; forward each to the main site; log them in `domain_tracker.csv`
- [ ] Create **92 inboxes** (3 per domain), names and photos; app passwords
- [ ] DNS: MX, SPF, DKIM, DMARC on all 31 domains; `dns-check` passes; mail-tester ≥ 9/10
- [ ] Connect all inboxes to a warmup service and start warmup. **Record the date**, since it's
      each inbox's `warmup_start`
- [ ] Install `coldflow` on an always-on machine (small VPS or office PC), `init`, fill in
      `coldflow.toml` (company name, postal address, timezone)
- [ ] `inboxes import`; put the passwords in a private `.env` (see `scripts/env.example`)
- [ ] Load the do-not-contact list

## Weeks 1-2: warm up and prepare leads

- [ ] Warmup runs; no cold email (`coldflow` sends nothing yet)
- [ ] Pull, verify and import the **first 20,000 leads**; enroll them
- [ ] `campaign preview` on 20 random leads per campaign; fix copy and fallbacks
- [ ] Dry runs: `schedule --date <first cold day>` then `send --date <first cold day>`; read a
      sample of `.eml` files
- [ ] Set up cron (`scripts/crontab.example`), the CRM or sheet, and a booking link
- [ ] Decide who answers replies, and how fast

## Weeks 3-4: ramp

- [ ] First cold day: each inbox sends 5, ramping +2 per day (fleet: ~400/day → ~2,400/day)
- [ ] Daily: status, answer replies, watch bounce rate closely (list problems show up here)
- [ ] End of week 4: first A/B read on email 1 (~300+ leads per variant)

## Weeks 5-8: full volume and calibration

- [ ] ~2,400/day, ~12k/week, ~50k/month
- [ ] Weekly review every Monday (see `06_operations_sop.md`)
- [ ] Replace the planning assumptions in `plan` with real numbers:
      `python -m coldflow plan --reply-rate 0.018 --deal-value 1800`
- [ ] Double down on the best niche; swap out the weakest

## Weeks 9-12: optimize, then decide on Phase 2

Go to 50k/week only if **all** of these hold for 4 straight weeks:
- [ ] reply rate ≥ 1.5% and positive share ≥ 30%
- [ ] bounce rate < 2% and no more than 10% of inboxes paused at any time
- [ ] you can answer 4x the positive replies within an hour (hire a setter/SDR first)
- [ ] lead supply for ~72k new leads a month is secured and verified

If yes: buy the remaining ~98 domains and ~293 inboxes **all at once**, warm them for 14 days,
then ramp. Existing inboxes keep running. The same `coldflow` install handles it; only the send
run gets longer. At 10k/day, use a 9-hour window or split the fleet across two machines, each
with its own database and its own share of inboxes and leads.
