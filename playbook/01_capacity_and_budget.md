# Capacity and budget

Run the numbers yourself with any inputs:

```bash
python -m coldflow plan --period month                  # 50k per month
python -m coldflow plan --period week                   # 50k per week
python -m coldflow plan --period month --per-inbox 25 --inbox-cost 6 --deal-value 2000
python -m coldflow plan --period month --ramp-csv ramp.csv   # 90-day capacity calendar
```

## The core formula

```
emails per sending day = target / sending days            (21 per month, 5 per week)
active inboxes         = emails per day / 30              (30 cold emails per inbox per day)
total inboxes          = active x 1.15                    (15% spare for rotation and burned inboxes)
domains                = total inboxes / 3                (3 inboxes per domain)
new leads              = target / 3                       (3-step sequence)
```

## Phase 1: 50,000 per month

| Item | Number |
|---|---|
| Emails per sending day | 2,381 |
| Active inboxes | 80 |
| Total inboxes (with spare) | 92 |
| Domains | 31 |
| New verified leads per month | ~16,700 |
| Leads per sending day | ~800 |

**Monthly cost by setup** (September 2026 prices; `python -m coldflow plan` shows the full breakdown):

| Setup | How it works | Monthly |
|---|---|---|
| **Lean (recommended, cheapest)** | $4 inboxes (Exchange Online P1 / reseller Google), coldflow sends, Instantly Growth ($47) warms | **~$700** |
| Hybrid | $7 Google/Microsoft inboxes, Instantly Hypergrowth ($97) warms and sends | ~$1,020 |
| DIY | $7 inboxes, coldflow sends, per-inbox warmup tool (~$12/inbox) | ~$2,035 |

Plus **~$372 up front** for 31 domains. All three include ~$250/mo for lead data and
verification ($0.015/lead). Details and trade-offs: [09 Cheapest setup](09_cheapest_setup.md).

## Phase 2: 50,000 per week

| Item | Number |
|---|---|
| Emails per sending day | 10,000 |
| Active inboxes | 334 |
| Total inboxes | 385 |
| Domains | 129 |
| New verified leads per week | ~16,700 (≈72k/month) |

That is about 4.2x Phase 1 in inboxes and leads. Monthly: **lean ~$2,800**, hybrid ~$4,180,
DIY ~$8,530, plus ~$1,550 of domains up front.
Go there only after Phase 1 shows a working offer: a reply rate at or above 1.5% and positive
replies turning into calls. More volume does not fix a bad offer. It burns domains faster.

**Cost levers at Phase 2 scale:** the lean setup's savings grow with inbox count, because
Instantly Growth warms any number of inboxes for a flat fee. Leads become the second-biggest cost
at 72k a month; cheap data costs more in bounces and burned domains, so keep verification.

## Funnel expectations (planning assumptions, not promises)

| Stage | Conservative | Good | Your actuals |
|---|---|---|---|
| Reply rate (per lead) | 1% | 3%+ | |
| Positive share of replies | 25% | 40% | |
| Positive reply → booked call | 40% | 60% | |
| Call → client | 15% | 25% | |

At 16.7k leads/month and 2% replies: ~333 replies → ~117 interested → ~58 calls → ~11 clients.
Treat the first 30 days as calibration and replace these with your real numbers in `plan`.

## Ramp: when the full volume actually arrives

Inboxes don't send cold email for 14 days, then go 5 → 7 → 9 … → 30/day, so an inbox reaches full
speed about day 26-27. Buy **all** the domains and inboxes in week 0 so the whole fleet warms in
parallel. Buying in stages means waiting a month for each new batch.
