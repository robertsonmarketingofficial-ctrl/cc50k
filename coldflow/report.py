"""Stats in the terminal and a self-contained HTML dashboard."""
from __future__ import annotations

import csv
import html
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path


def _pct(a: int, b: int) -> str:
    return f"{a / b:.1%}" if b else "-"


def campaign_stats(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT c.name, c.status,
             (SELECT COUNT(*) FROM enrollments e WHERE e.campaign_id=c.id) enrolled,
             (SELECT COUNT(*) FROM enrollments e WHERE e.campaign_id=c.id AND e.status='pending') waiting,
             (SELECT COUNT(DISTINCT s.lead_id) FROM sends s JOIN enrollments e ON e.id=s.enrollment_id
                WHERE e.campaign_id=c.id AND s.status='sent') contacted,
             (SELECT COUNT(*) FROM sends s JOIN enrollments e ON e.id=s.enrollment_id
                WHERE e.campaign_id=c.id AND s.status='sent') sent
           FROM campaigns c ORDER BY c.id"""
    ).fetchall()
    out = []
    for r in rows:
        ev = {k: n for k, n in conn.execute(
            """SELECT ev.kind, COUNT(DISTINCT ev.lead_id) FROM events ev
               JOIN enrollments e ON e.lead_id=ev.lead_id JOIN campaigns c ON c.id=e.campaign_id
               WHERE c.name=? GROUP BY ev.kind""", (r["name"],))}
        replies = ev.get("reply", 0) + ev.get("interested", 0) + ev.get("not_interested", 0)
        d = dict(r)
        d.update(
            replies=replies, interested=ev.get("interested", 0), bounces=ev.get("bounce", 0),
            unsubscribes=ev.get("unsubscribe", 0),
            reply_rate=_pct(replies, r["contacted"]), bounce_rate=_pct(ev.get("bounce", 0), r["contacted"]),
        )
        out.append(d)
    return out


def inbox_stats(conn: sqlite3.Connection, settings, on: date) -> list[dict]:
    from .inboxes import cap_for

    out = []
    for r in conn.execute("SELECT * FROM inboxes ORDER BY domain, email"):
        sent = conn.execute("SELECT COUNT(*) FROM sends WHERE inbox_id=? AND status='sent'", (r["id"],)).fetchone()[0]
        today = conn.execute(
            "SELECT COUNT(*) FROM sends WHERE inbox_id=? AND status='sent' AND scheduled_for=?",
            (r["id"], on.isoformat())).fetchone()[0]
        ev = dict(conn.execute(
            "SELECT kind, COUNT(*) FROM events WHERE inbox_id=? GROUP BY kind", (r["id"],)).fetchall())
        out.append(dict(
            email=r["email"], status=r["status"], note=r["paused_reason"], cap_today=cap_for(r, on, settings["warmup"]),
            sent_today=today, sent_total=sent, bounces=ev.get("bounce", 0),
            bounce_rate=_pct(ev.get("bounce", 0), sent),
            replies=ev.get("reply", 0) + ev.get("interested", 0) + ev.get("not_interested", 0),
        ))
    return out


def daily_volume(conn: sqlite3.Connection, days: int = 30) -> list[tuple[str, int]]:
    return [(r[0], r[1]) for r in conn.execute(
        """SELECT scheduled_for, COUNT(*) FROM sends WHERE status='sent'
           GROUP BY scheduled_for ORDER BY scheduled_for DESC LIMIT ?""", (days,))][::-1]


def lead_funnel(conn: sqlite3.Connection) -> dict:
    return dict(conn.execute("SELECT status, COUNT(*) FROM leads GROUP BY status").fetchall())


def text_report(conn: sqlite3.Connection, settings, on: date) -> str:
    lines = [f"COLDFLOW STATUS  {on.isoformat()}", ""]
    funnel = lead_funnel(conn)
    lines.append("Leads: " + ", ".join(f"{k}={v:,}" for k, v in sorted(funnel.items())) if funnel else "Leads: none")
    queued = conn.execute("SELECT COUNT(*) FROM sends WHERE status='queued'").fetchone()[0]
    lines.append(f"Queued sends: {queued:,}")
    lines += ["", f"{'CAMPAIGN':28} {'ENROLLED':>9} {'WAITING':>8} {'CONTACTED':>9} {'SENT':>7} {'REPLY%':>7} {'INTEREST':>8} {'BOUNCE%':>8}"]
    for c in campaign_stats(conn):
        lines.append(f"{c['name'][:28]:28} {c['enrolled']:>9,} {c['waiting']:>8,} {c['contacted']:>9,} {c['sent']:>7,}"
                     f" {c['reply_rate']:>7} {c['interested']:>8,} {c['bounce_rate']:>8}")
    inboxes = inbox_stats(conn, settings, on)
    active = [i for i in inboxes if i["status"] == "active"]
    lines += ["", f"Inboxes: {len(active)} active / {len(inboxes)} total, fleet cap today "
                  f"{sum(i['cap_today'] for i in active):,}"]
    for i in inboxes:
        if i["status"] != "active":
            lines.append(f"  PAUSED {i['email']}: {i['note']}")
    return "\n".join(lines)


def html_dashboard(conn: sqlite3.Connection, settings, on: date, out_path: Path) -> Path:
    e = html.escape
    camps = campaign_stats(conn)
    inboxes = inbox_stats(conn, settings, on)
    vol = daily_volume(conn)
    funnel = lead_funnel(conn)
    peak = max((n for _, n in vol), default=1) or 1
    bars = "".join(
        f'<div class="bar" title="{d}: {n:,}"><span style="height:{max(2, 100 * n / peak):.0f}%"></span><i>{d[5:]}</i></div>'
        for d, n in vol
    ) or "<p class='muted'>No sends yet.</p>"
    replies = conn.execute(
        """SELECT ev.created_at, ev.kind, ev.from_addr, ev.subject, ev.snippet, l.company
           FROM events ev LEFT JOIN leads l ON l.id=ev.lead_id
           WHERE ev.kind IN ('interested','reply') ORDER BY ev.id DESC LIMIT 50""").fetchall()

    def table(rows: list[dict], cols: list[str]) -> str:
        if not rows:
            return "<p class='muted'>Nothing yet.</p>"
        head = "".join(f"<th>{e(c.replace('_', ' '))}</th>" for c in cols)
        body = "".join("<tr>" + "".join(f"<td>{e(str(r.get(c, '')))}</td>" for c in cols) + "</tr>" for r in rows)
        return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"

    total_sent = sum(c["sent"] for c in camps)
    total_contacted = sum(c["contacted"] for c in camps)
    total_replies = sum(c["replies"] for c in camps)
    total_interested = sum(c["interested"] for c in camps)
    kpis = [
        ("Emails sent", f"{total_sent:,}"), ("Leads contacted", f"{total_contacted:,}"),
        ("Reply rate", _pct(total_replies, total_contacted)), ("Interested", f"{total_interested:,}"),
        ("Active inboxes", f"{sum(1 for i in inboxes if i['status'] == 'active'):,}"),
        ("Leads waiting", f"{funnel.get('new', 0) + sum(c['waiting'] for c in camps):,}"),
    ]
    kpi_html = "".join(f"<div class='kpi'><b>{e(v)}</b><span>{e(k)}</span></div>" for k, v in kpis)
    reply_rows = [dict(when=r["created_at"], kind=r["kind"], who=r["from_addr"], company=r["company"] or "",
                       subject=r["subject"], says=(r["snippet"] or "")[:160]) for r in replies]

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Coldflow Dashboard</title>
<style>
:root{{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e4df;--accent:#2f6f4f}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151514;--card:#1f1f1d;--ink:#ecece8;--muted:#9a9a93;--line:#33332f;--accent:#6fbf94}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:24px 16px}} h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:16px;margin:28px 0 10px}}
.muted{{color:var(--muted)}} .kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}}
.kpi{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}} .kpi b{{display:block;font-size:22px}}
.kpi span{{color:var(--muted);font-size:12px}} .wrap{{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}}
table{{border-collapse:collapse;width:100%}} th,td{{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}}
th{{font-size:12px;color:var(--muted);font-weight:600;text-transform:capitalize}} td:last-child{{white-space:normal}}
.chart{{display:flex;gap:3px;align-items:flex-end;height:160px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 12px 26px;overflow-x:auto}}
.bar{{flex:1;min-width:14px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;position:relative}}
.bar span{{display:block;background:var(--accent);border-radius:3px 3px 0 0}} .bar i{{position:absolute;bottom:-20px;font-size:10px;color:var(--muted);font-style:normal}}
</style></head><body><main>
<h1>Cold email dashboard</h1><p class="muted">{e(settings['company']['name'])} · generated {datetime.now():%Y-%m-%d %H:%M}</p>
<div class="kpis">{kpi_html}</div>
<h2>Emails sent per day</h2><div class="chart">{bars}</div>
<h2>Campaigns</h2><div class="wrap">{table(camps, ['name','status','enrolled','waiting','contacted','sent','replies','reply_rate','interested','bounce_rate','unsubscribes'])}</div>
<h2>Replies to handle</h2><div class="wrap">{table(reply_rows, ['when','kind','who','company','subject','says'])}</div>
<h2>Inboxes</h2><div class="wrap">{table(inboxes, ['email','status','cap_today','sent_today','sent_total','replies','bounces','bounce_rate','note'])}</div>
</main></body></html>"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page, encoding="utf-8")
    return out_path


def export_replies(conn: sqlite3.Connection, out_path: Path, kinds=("interested", "reply")) -> int:
    rows = conn.execute(
        f"""SELECT ev.created_at, ev.kind, l.email, l.first_name, l.last_name, l.company, l.title, l.website,
                  i.email AS inbox, ev.subject, ev.snippet
           FROM events ev JOIN leads l ON l.id=ev.lead_id LEFT JOIN inboxes i ON i.id=ev.inbox_id
           WHERE ev.kind IN ({','.join('?' * len(kinds))}) ORDER BY ev.id DESC""", kinds).fetchall()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(rows[0].keys() if rows else ["created_at", "kind", "email"])
        w.writerows([tuple(r) for r in rows])
    return len(rows)


def export_leads(conn: sqlite3.Connection, out_path: Path, status: str = "new") -> int:
    """Clean, deduped, unsuppressed leads in a CSV that Instantly/Smartlead/etc. can import."""
    rows = conn.execute(
        """SELECT email, first_name, last_name, company AS company_name, title, website, industry, city,
                  country, custom FROM leads l
           WHERE status=? AND NOT EXISTS (SELECT 1 FROM suppression s
                 WHERE (s.kind='email' AND s.value=l.email) OR (s.kind='domain' AND s.value=l.domain))
           ORDER BY id""", (status,)).fetchall()
    custom_keys: list[str] = []
    parsed = []
    for r in rows:
        extra = json.loads(r["custom"] or "{}")
        custom_keys += [k for k in extra if k not in custom_keys]
        parsed.append((r, extra))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    base = ["email", "first_name", "last_name", "company_name", "title", "website", "industry", "city", "country"]
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(base + custom_keys)
        for r, extra in parsed:
            w.writerow([r[k] for k in base] + [extra.get(k, "") for k in custom_keys])
    return len(parsed)
