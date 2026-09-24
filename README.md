# CC50K: a cold email system for 50,000 B2B emails

A complete setup for sending **50,000 cold emails a month (or a week)** to prospect for your agency.
It has two parts:

1. **`coldflow/`**: runnable Python software that imports and cleans leads, rotates sending
   across many inboxes, ramps new inboxes up slowly, runs multi-step sequences, reads replies and
   bounces, stops sequences when someone answers, pauses unhealthy inboxes, and produces a dashboard.
2. **`playbook/`**: the operating plan. Infrastructure math, domain and DNS setup, lead sourcing,
   copy, compliance, and the daily and weekly routine.

Start with **[playbook/00_START_HERE.md](playbook/00_START_HERE.md)**.

## The recommendation in one paragraph

Don't send cold email from your main domain or through a newsletter platform (Mailchimp,
SendGrid, SES and similar ban cold email in their terms). Buy lookalike **secondary domains**,
put **3 Google Workspace or Microsoft 365 inboxes on each**, warm them for two weeks, and cap each
inbox at **about 30 cold emails a day**. 50k/month needs about **92 inboxes on 31 domains**.
50k/week needs about **385 inboxes on 129 domains**. `coldflow` handles the rotation, caps,
sequences and reply handling. If you'd rather use a hosted sender (Instantly, Smartlead), use
`coldflow` for lead cleaning and planning, then run `leads export`.

## Quick start

Requires Python 3.11+. There are no required dependencies. `pip install dnspython` enables the DNS checker.

```bash
python -m coldflow init                      # creates coldflow.toml and the database
python -m coldflow plan --period month       # infrastructure and budget for 50k/month
python -m coldflow inboxes import templates/inboxes_template.csv
python -m coldflow leads import templates/leads_template.csv
python -m coldflow leads suppress templates/suppression_template.csv --reason "client/competitor"
python -m coldflow campaign add campaigns/local-services.toml
python -m coldflow campaign enroll local-services
python -m coldflow campaign preview local-services
python -m coldflow schedule                  # build today's queue
python -m coldflow send                      # DRY RUN: writes .eml files to data/outbox/
python -m coldflow send --live               # really sends (see the go-live checklist)
python -m coldflow replies                   # read replies, bounces and opt-outs; health check
python -m coldflow status
python -m coldflow dashboard                 # reports/dashboard.html
```

After setup, one command runs each sending morning (see `scripts/`):

```bash
python -m coldflow daily --live
```

## Safety rails built in

- Dry run is the default. `--live` refuses to run until your real company name and postal address
  are set and every `[[PLACEHOLDER]]` in the campaign copy has been replaced.
- Every email includes an opt-out line and your postal address, plus a `List-Unsubscribe` header.
- New inboxes send nothing for 14 days, then ramp from 5 to 30 a day.
- A reply, opt-out or bounce stops the sequence immediately. A reply also pauses outreach to that
  person's colleagues.
- Hard bounces and opt-outs are added to a permanent do-not-contact list.
- An inbox is paused automatically when its bounce rate goes over 3% or its opt-out rate over 2%.
- No more than 2 first-touch emails go to the same company domain per day.
- Passwords are never stored. Each inbox reads its app password from an environment variable.

## Layout

```
coldflow/            the software (stdlib Python, SQLite)
campaigns/           3 ready-to-edit sequences (local services, e-commerce, B2B)
templates/           CSV templates: leads, inboxes, suppression list, domain tracker
playbook/            the plan and SOPs
scripts/             cron and env examples
tests/               python -m unittest discover -s tests
```
