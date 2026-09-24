"""coldflow command line. Run `python -m coldflow --help`."""
from __future__ import annotations

import argparse
import csv
import shutil
import sys
from datetime import date
from pathlib import Path

from . import alerts, auth, campaigns, db, inboxes, leads, planner, replies, report, scheduler, sender
from .config import load_settings
from .templates import lead_context, missing_fields, render

PKG_ROOT = Path(__file__).resolve().parent.parent


def _date(s: str | None) -> date:
    return date.fromisoformat(s) if s else date.today()


def _print_counter(title: str, c) -> None:
    print(title)
    for k, v in sorted(c.items()):
        print(f"  {k:32} {v:,}")


def cmd_init(args, settings, conn):
    cfg = Path(args.config)
    if not cfg.exists():
        shutil.copy(PKG_ROOT / "coldflow.example.toml", cfg)
        print(f"Created {cfg}. Fill in [company] before sending (CAN-SPAM needs a real postal address).")
    for folder in ("logs", "backups"):
        (settings.root / folder).mkdir(exist_ok=True)
    print(f"Database ready at {settings.path('db')}")


def cmd_plan(args, settings, conn):
    p = planner.PlanInputs(
        target_emails=args.target, period=args.period, per_inbox_daily=args.per_inbox,
        inboxes_per_domain=args.per_domain, sequence_steps=args.steps, stack=args.stack,
        inbox_cost_month=args.inbox_cost, warmup_cost_inbox_month=args.warmup_cost,
        lead_cost_each=args.lead_cost, reply_rate=args.reply_rate, deal_value_month=args.deal_value,
    )
    plan = planner.build_plan(p)
    print(planner.format_plan(plan))
    if args.ramp_csv:
        w = settings["warmup"]
        with open(args.ramp_csv, "w", newline="") as fh:
            out = csv.writer(fh)
            out.writerow(["day", "per_inbox_cap", "fleet_daily_capacity"])
            out.writerows(planner.ramp_calendar(plan, int(w["warmup_only_days"]), int(w["ramp_start"]), int(w["ramp_step"])))
        print(f"\n90-day ramp written to {args.ramp_csv}")


def cmd_leads(args, settings, conn):
    if args.action == "import":
        stats = leads.import_csv(conn, args.file, settings["leads"], source=args.source or "")
        _print_counter(f"Imported {args.file}", stats)
    elif args.action == "suppress":
        n = leads.import_suppression(conn, args.file, args.reason)
        print(f"Added {n:,} entries to the do-not-contact list.")
    elif args.action == "export":
        out = Path(args.file or settings.path("reports") / "clean_leads.csv")
        print(f"Exported {report.export_leads(conn, out, args.status):,} leads to {out}")
    else:
        _print_counter("Leads by status", report.lead_funnel(conn))


def cmd_inboxes(args, settings, conn):
    if args.action == "import":
        n = inboxes.import_csv(conn, args.file, int(settings["warmup"]["default_daily_cap"]))
        print(f"Imported/updated {n} inboxes.")
    elif args.action in ("pause", "resume", "retire"):
        status = {"pause": "paused", "resume": "active", "retire": "retired"}[args.action]
        n = conn.execute("UPDATE inboxes SET status=?, paused_reason=? WHERE email=?",
                         (status, "manual" if status != "active" else "", args.email.lower())).rowcount
        conn.commit()
        print(f"{args.email}: {status}" if n else f"No inbox {args.email}")
    elif args.action == "env":
        for r in conn.execute("SELECT email, password_env, auth FROM inboxes WHERE status<>'retired' ORDER BY email"):
            if r["auth"] == "oauth":
                print(f"# {r['email']}: OAuth, no password needed (python -m coldflow auth login --email {r['email']})")
            else:
                print(f"{r['password_env']}=''   # app password for {r['email']}")
    else:
        today = _date(args.date)
        for i in report.inbox_stats(conn, settings, today):
            print(f"{i['email']:40} {i['status']:8} cap today {i['cap_today']:>3}  sent {i['sent_total']:>6,}"
                  f"  bounce {i['bounce_rate']:>6}  {i['note']}")


def cmd_campaign(args, settings, conn):
    if args.action == "add":
        camp = campaigns.register(conn, args.target)
        print(f"Campaign {camp.name!r}: {len(camp.steps)} steps, days {[s.day for s in camp.steps]}")
    elif args.action == "enroll":
        filters = dict(f.split("=", 1) for f in args.filter or [])
        n = campaigns.enroll(conn, args.target, args.limit, filters)
        print(f"Enrolled {n:,} leads into {args.target}")
    elif args.action in ("pause", "resume"):
        conn.execute("UPDATE campaigns SET status=? WHERE name=?",
                     ("paused" if args.action == "pause" else "active", args.target))
        conn.commit()
        print(f"{args.target}: {args.action}d")
    elif args.action == "preview":
        _, camp = campaigns.campaign_by_name(conn, args.target)
        q = "SELECT * FROM leads WHERE email=?" if args.lead else "SELECT * FROM leads ORDER BY RANDOM() LIMIT 1"
        lead = conn.execute(q, (args.lead.lower(),) if args.lead else ()).fetchone()
        inbox = conn.execute("SELECT * FROM inboxes LIMIT 1").fetchone()
        if not lead:
            sys.exit("No lead to preview with; import leads first.")
        ctx = lead_context(lead, inbox, settings["company"])
        markers = camp.edit_markers()
        if markers:
            print(f"!! Replace before going live: {', '.join(markers)}\n")
        for i, step in enumerate(camp.steps):
            for vi, v in enumerate(step.variants):
                print(f"=== step {i + 1} (day {step.day}) variant {chr(65 + vi)} ===")
                print("Subject:", render(v.subject, ctx) if v.subject else "(Re: thread)")
                print(render(v.body.strip(), ctx))
                miss = missing_fields(v.subject + v.body, ctx)
                if miss:
                    print(f"!! this lead is missing: {', '.join(sorted(set(miss)))} (email would be skipped)")
                print()
    else:
        for c in report.campaign_stats(conn):
            print(f"{c['name']:30} {c['status']:7} enrolled {c['enrolled']:>7,}  sent {c['sent']:>7,}  reply {c['reply_rate']}")


def cmd_schedule(args, settings, conn):
    stats = scheduler.build_queue(conn, _date(args.date), settings)
    _print_counter(f"Queue for {_date(args.date)}", stats)
    return stats


def cmd_send(args, settings, conn):
    if args.live and "Your Agency" in settings["company"]["name"]:
        sys.exit("Set your real company name and postal address in coldflow.toml before live sending.")
    if args.live:
        for row in conn.execute("SELECT name, file FROM campaigns WHERE status='active'"):
            markers = campaigns.load_campaign(row["file"]).edit_markers()
            if markers:
                sys.exit(f"Campaign {row['name']!r} still has placeholders to fill in: {', '.join(markers)}")
    stats = sender.run(conn, _date(args.date), settings, live=args.live, limit=args.limit,
                       ignore_window=args.ignore_window)
    _print_counter("Send run", stats)
    return stats


def cmd_replies(args, settings, conn):
    stats, problems = replies.poll(conn, settings, days=args.days, deep=getattr(args, "deep", False))
    _print_counter("Inbox sweep", stats)
    for p in problems:
        print(f"  ! {p}")
    paused = cmd_health(args, settings, conn)
    return stats, problems + [f"Auto-paused {e}: {why}" for e, why in paused]


def cmd_health(args, settings, conn):
    paused = inboxes.health_check(conn, settings["health"], date.today())
    for email, why in paused:
        print(f"AUTO-PAUSED {email}: {why}")
    if not paused:
        print("Health check: no inboxes over the bounce/unsubscribe limits.")
    return paused


def cmd_status(args, settings, conn):
    print(report.text_report(conn, settings, _date(args.date)))


def cmd_dashboard(args, settings, conn):
    out = Path(args.out) if args.out else settings.path("reports") / "dashboard.html"
    print(f"Dashboard written to {report.html_dashboard(conn, settings, date.today(), out)}")


def cmd_export(args, settings, conn):
    out = Path(args.out) if args.out else settings.path("reports") / "replies.csv"
    kinds = ("interested",) if args.interested_only else ("interested", "reply")
    print(f"Exported {report.export_replies(conn, out, kinds)} replies to {out}")


def cmd_dns(args, settings, conn):
    from .dnscheck import check_domain

    targets = args.domains or [
        (r["domain"], r["provider"]) for r in conn.execute("SELECT DISTINCT domain, provider FROM inboxes")]
    targets = [(t, "google") if isinstance(t, str) else t for t in targets]
    bad = 0
    for domain, provider in targets:
        r = check_domain(domain, provider)
        print(f"{'OK ' if r['ok'] else 'FIX'} {domain}: " + ("; ".join(r["problems"]) or "MX, SPF, DKIM, DMARC present"))
        bad += not r["ok"]
    sys.exit(1 if bad else 0)


def cmd_daily(args, settings, conn):
    """What cron runs each sending morning: sweep replies, build the queue, send, refresh the
    dashboard, then push the summary to the alert channels."""
    run: dict = {}
    problems: list[str] = []
    try:
        run["replies"], problems = cmd_replies(args, settings, conn)
        run["schedule"] = cmd_schedule(args, settings, conn)
        run["send"] = cmd_send(args, settings, conn)
        cmd_dashboard(args, settings, conn)
    except BaseException as exc:  # crash or sys.exit: still tell someone
        problems.append(f"daily run stopped early: {exc!r}")
        raise
    finally:
        _alert(settings, conn, _date(args.date), run, problems)


def _alert(settings, conn, on, run, problems) -> None:
    subject, text, warn = alerts.build_summary(conn, settings, on, run, problems)
    print(f"\n{subject}\n{text}")
    if settings["alerts"].get("only_on_warnings") and not warn:
        return
    try:
        used = alerts.notify(settings, subject, text)
        if used:
            print(f"Summary sent via {', '.join(used)}")
    except Exception as exc:
        print(f"Could not send alert: {exc}")


def cmd_alert_test(args, settings, conn):
    subject, text, _ = alerts.build_summary(conn, settings, date.today())
    used = alerts.notify(settings, "[test] " + subject, text)
    print(f"Sent via {', '.join(used)}" if used else "No alert channel configured: set [alerts] webhook_url or email_to")


def cmd_auth(args, settings, conn):
    store = auth.TokenStore(settings.path("tokens"))
    ms_cfg = settings["oauth_microsoft"]
    if args.action == "login":
        targets = [args.email.lower()] if args.email else [r["email"] for r in conn.execute(
            "SELECT email FROM inboxes WHERE auth='oauth' AND status<>'retired' ORDER BY email")]
        pending = [e for e in targets if args.email or not store.get(e)]
        if not pending:
            print("Every OAuth inbox already has a token.")
        for email in pending:
            auth.device_login(email, ms_cfg, store)
    else:
        for r in conn.execute("SELECT * FROM inboxes WHERE status<>'retired' ORDER BY email"):
            try:
                auth.secret_for(r, settings)
                state = "ok"
            except Exception as exc:
                state = f"PROBLEM: {exc}"
            print(f"{r['email']:40} {r['auth']:8} {state}")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="coldflow", description="Cold email operating system (50k/month scale).")
    ap.add_argument("--config", default="coldflow.toml", help="settings file (default: coldflow.toml)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create coldflow.toml and the database").set_defaults(fn=cmd_init)

    p = sub.add_parser("plan", help="inboxes, domains, leads and budget for a volume target")
    p.add_argument("--target", type=int, default=50_000)
    p.add_argument("--period", choices=["week", "month"], default="month")
    p.add_argument("--per-inbox", type=int, default=30)
    p.add_argument("--per-domain", type=int, default=3)
    p.add_argument("--steps", type=float, default=3.0)
    p.add_argument("--stack", choices=sorted(planner.STACKS), default="lean",
                   help="lean (cheapest), hybrid (Instantly sends) or diy (per-inbox warmup)")
    p.add_argument("--inbox-cost", type=float, help="override the stack's $/inbox/month")
    p.add_argument("--warmup-cost", type=float, help="override the stack's warmup $/inbox/month")
    p.add_argument("--lead-cost", type=float, default=0.015)
    p.add_argument("--reply-rate", type=float, default=0.02)
    p.add_argument("--deal-value", type=float, default=1500.0)
    p.add_argument("--ramp-csv", help="write a 90-day ramp calendar CSV")
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser("leads", help="import leads / manage the do-not-contact list")
    p.add_argument("action", choices=["import", "suppress", "export", "count"])
    p.add_argument("file", nargs="?", help="CSV to import, or output path for export")
    p.add_argument("--source")
    p.add_argument("--status", default="new", help="lead status to export (default: new)")
    p.add_argument("--reason", default="manual")
    p.set_defaults(fn=cmd_leads)

    p = sub.add_parser("inboxes", help="import / list / pause sending inboxes")
    p.add_argument("action", choices=["import", "list", "pause", "resume", "retire", "env"])
    p.add_argument("file", nargs="?", help="CSV for import")
    p.add_argument("--email")
    p.add_argument("--date")
    p.set_defaults(fn=cmd_inboxes)

    p = sub.add_parser("campaign", help="add / enroll / preview / pause campaigns")
    p.add_argument("action", choices=["add", "enroll", "preview", "pause", "resume", "list"])
    p.add_argument("target", nargs="?", help="campaign TOML file (add) or campaign name")
    p.add_argument("--limit", type=int)
    p.add_argument("--filter", action="append", help="column=value, e.g. industry=dentists")
    p.add_argument("--lead", help="lead email to preview with")
    p.set_defaults(fn=cmd_campaign)

    p = sub.add_parser("schedule", help="build the send queue for a day")
    p.add_argument("--date")
    p.set_defaults(fn=cmd_schedule)

    p = sub.add_parser("send", help="send the queue (dry run writes .eml files unless --live)")
    p.add_argument("--date")
    p.add_argument("--live", action="store_true")
    p.add_argument("--limit", type=int)
    p.add_argument("--ignore-window", action="store_true")
    p.set_defaults(fn=cmd_send)

    p = sub.add_parser("replies", help="sweep inboxes for replies, bounces and opt-outs")
    p.add_argument("--days", type=int, default=3, help="look-back for first/deep sweeps")
    p.add_argument("--deep", action="store_true", help="re-read the last --days days (weekly, for late bounces)")
    p.set_defaults(fn=cmd_replies)

    p = sub.add_parser("auth", help="OAuth sign-in for Microsoft inboxes")
    p.add_argument("action", choices=["login", "status"])
    p.add_argument("--email", help="one inbox (default for login: every OAuth inbox without a token)")
    p.set_defaults(fn=cmd_auth)

    sub.add_parser("alert-test", help="send today's summary to the alert channels").set_defaults(fn=cmd_alert_test)

    sub.add_parser("health", help="auto-pause inboxes over bounce/unsubscribe limits").set_defaults(fn=cmd_health)

    p = sub.add_parser("status", help="one-screen summary")
    p.add_argument("--date")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("dashboard", help="write the HTML dashboard")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_dashboard)

    p = sub.add_parser("export", help="export replies to CSV for your CRM")
    p.add_argument("--out")
    p.add_argument("--interested-only", action="store_true")
    p.set_defaults(fn=cmd_export)

    p = sub.add_parser("dns-check", help="check SPF/DKIM/DMARC/MX (needs dnspython)")
    p.add_argument("domains", nargs="*")
    p.set_defaults(fn=cmd_dns)

    p = sub.add_parser("daily", help="replies + schedule + send + dashboard in one go (for cron)")
    p.add_argument("--date")
    p.add_argument("--days", type=int, default=3)
    p.add_argument("--live", action="store_true")
    p.add_argument("--limit", type=int)
    p.add_argument("--ignore-window", action="store_true")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_daily)
    return ap


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    settings = load_settings(args.config)
    if args.cmd == "plan":
        return args.fn(args, settings, None)
    conn = db.connect(settings.path("db"))
    try:
        needs_file = {"leads": ("import", "suppress"), "inboxes": ("import",)}
        if args.cmd in needs_file and args.action in needs_file[args.cmd] and not args.file:
            sys.exit(f"{args.cmd} {args.action} needs a file")
        if args.cmd == "inboxes" and args.action in ("pause", "resume", "retire") and not args.email:
            sys.exit("--email is required")
        if args.cmd == "campaign" and args.action != "list" and not args.target:
            sys.exit("campaign needs a file (add) or a campaign name")
        args.fn(args, settings, conn)
    finally:
        conn.close()
