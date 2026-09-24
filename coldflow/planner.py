"""Capacity math: how many inboxes, domains, leads and dollars a volume target needs."""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

PERIOD_SENDING_DAYS = {"week": 5, "month": 21}


@dataclass
class PlanInputs:
    target_emails: int = 50_000
    period: str = "month"                 # 'week' | 'month'
    per_inbox_daily: int = 30             # cold emails per inbox per day at full ramp
    inboxes_per_domain: int = 3
    sequence_steps: float = 3.0           # avg emails each lead receives
    spare_ratio: float = 0.15             # extra inboxes held back for rotation / burned inboxes
    inbox_cost_month: float = 7.20        # Google Workspace Business Starter per seat (check current price)
    domain_cost_year: float = 12.00
    warmup_cost_inbox_month: float = 0.0  # if your warmup tool bills per inbox
    lead_cost_each: float = 0.02          # data + verification per lead
    reply_rate: float = 0.02              # replies per lead contacted
    positive_share: float = 0.35          # share of replies that are interested
    meeting_share: float = 0.5            # interested replies that book a call
    close_rate: float = 0.20              # calls that become clients
    deal_value_month: float = 1_500.0     # average monthly retainer


@dataclass
class Plan:
    inputs: PlanInputs
    sending_days: int
    emails_per_day: int
    active_inboxes: int
    total_inboxes: int
    domains: int
    new_leads: int
    monthly_cost: float
    setup_cost: float
    replies: int
    interested: int
    meetings: int
    clients: float
    new_mrr: float

    def as_dict(self) -> dict:
        d = asdict(self)
        d["inputs"] = asdict(self.inputs)
        return d


def build_plan(p: PlanInputs) -> Plan:
    if p.period not in PERIOD_SENDING_DAYS:
        raise ValueError(f"period must be one of {sorted(PERIOD_SENDING_DAYS)}")
    days = PERIOD_SENDING_DAYS[p.period]
    per_day = math.ceil(p.target_emails / days)
    active = math.ceil(per_day / p.per_inbox_daily)
    total = math.ceil(active * (1 + p.spare_ratio))
    domains = math.ceil(total / p.inboxes_per_domain)
    new_leads = math.ceil(p.target_emails / p.sequence_steps)
    periods_per_month = 1 if p.period == "month" else 52 / 12
    monthly_leads = new_leads * periods_per_month
    monthly_cost = (
        total * (p.inbox_cost_month + p.warmup_cost_inbox_month)
        + domains * p.domain_cost_year / 12
        + monthly_leads * p.lead_cost_each
    )
    setup_cost = domains * p.domain_cost_year
    replies = round(new_leads * p.reply_rate)
    interested = round(replies * p.positive_share)
    meetings = round(interested * p.meeting_share)
    clients = round(meetings * p.close_rate, 1)
    return Plan(
        inputs=p,
        sending_days=days,
        emails_per_day=per_day,
        active_inboxes=active,
        total_inboxes=total,
        domains=domains,
        new_leads=new_leads,
        monthly_cost=round(monthly_cost, 2),
        setup_cost=round(setup_cost, 2),
        replies=replies,
        interested=interested,
        meetings=meetings,
        clients=clients,
        new_mrr=round(clients * p.deal_value_month, 2),
    )


def format_plan(plan: Plan) -> str:
    p = plan.inputs
    per = p.period
    lines = [
        f"TARGET: {p.target_emails:,} cold emails per {per} ({plan.sending_days} sending days)",
        "",
        "INFRASTRUCTURE",
        f"  Emails per sending day ........ {plan.emails_per_day:,}",
        f"  Active sending inboxes ........ {plan.active_inboxes:,}  (@ {p.per_inbox_daily}/inbox/day)",
        f"  Total inboxes incl. {int(p.spare_ratio*100)}% spare .. {plan.total_inboxes:,}",
        f"  Sending domains ............... {plan.domains:,}  (@ {p.inboxes_per_domain} inboxes/domain)",
        "",
        "LEADS",
        f"  New verified leads per {per} ... {plan.new_leads:,}  ({p.sequence_steps:g}-step sequence)",
        "",
        "COST (estimate - check current vendor pricing)",
        f"  Up-front domains .............. ${plan.setup_cost:,.2f}",
        f"  Monthly run-rate .............. ${plan.monthly_cost:,.2f}",
        "",
        f"FUNNEL per {per} (assumptions: {p.reply_rate:.1%} reply, {p.positive_share:.0%} positive,"
        f" {p.meeting_share:.0%} book, {p.close_rate:.0%} close)",
        f"  Replies ....................... {plan.replies:,}",
        f"  Interested .................... {plan.interested:,}",
        f"  Meetings ...................... {plan.meetings:,}",
        f"  New clients ................... {plan.clients:g}",
        f"  New MRR ....................... ${plan.new_mrr:,.0f}",
        "",
        "TIMELINE",
        "  Week 0      buy domains, create inboxes, set SPF/DKIM/DMARC, start warmup",
        "  Weeks 1-2   warmup only (no cold sends)",
        "  Weeks 3-4   ramp each inbox 5 -> 30/day while warmup keeps running",
        f"  Week 5+     full volume: {plan.emails_per_day:,}/day",
    ]
    return "\n".join(lines)


def ramp_calendar(plan: Plan, warmup_only_days: int, ramp_start: int, ramp_step: int, days: int = 90):
    """Yield (day_index, per_inbox_cap, fleet_daily_capacity) for the first `days` calendar days.

    Weekends are ignored here for simplicity; the scheduler applies sending_days.
    """
    cap_max = plan.inputs.per_inbox_daily
    for d in range(days):
        if d < warmup_only_days:
            cap = 0
        else:
            cap = min(cap_max, ramp_start + ramp_step * (d - warmup_only_days))
        yield d, cap, cap * plan.active_inboxes
