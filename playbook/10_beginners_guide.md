# The complete beginner's guide: 50,000 cold emails a month, as cheaply as possible

This guide assumes you know **nothing** about email systems. Every term is explained the first
time it appears, and there's a full glossary at the end. Follow the parts in order.

**The short version:** you'll rent 93 email accounts on about 31 new website names, let them
"warm up" for two weeks, then have a small program send about 30 emails a day from each one. Total
cost is **about $550-700 a month**, plus **about $370 once** for the website names. Setup takes
about **3-4 days of work** spread over 5 weeks, because most of that time is waiting for warmup.

Prices were checked in September 2026. Confirm them before you buy.

---

## Contents

1. [What you're building, in plain English](#part-1-what-youre-building-in-plain-english)
2. [Why it has to be done this way](#part-2-why-it-has-to-be-done-this-way)
3. [The exact shopping list and costs](#part-3-the-exact-shopping-list-and-costs)
4. [Step-by-step setup](#part-4-step-by-step-setup)
5. [Your daily and weekly routine](#part-5-your-daily-and-weekly-routine)
6. [What can go wrong, and what to do](#part-6-what-can-go-wrong-and-what-to-do)
7. [Where to save money, and where never to](#part-7-where-to-save-money-and-where-never-to)
8. [The legal basics](#part-8-the-legal-basics)
9. [Glossary: every term in plain English](#part-9-glossary)
10. [The one-page checklist](#part-10-the-one-page-checklist)

---

## Part 1: What you're building, in plain English

**Cold email** means emailing businesses that don't know you yet, to offer your agency's services.
It's legal in the US for business-to-business outreach if you follow some rules (Part 8).

Think of the system as a **call center with 93 phone lines**:

- Each **phone line** is an **email account** (also called an **inbox** or **mailbox**), like
  `alex@getrobertsonmedia.com`.
- Each line makes a small number of calls per day, **30 emails**, so no single line looks
  suspicious.
- The lines sit under about **31 different company names** (**domains**, the part after the @),
  3 lines per name. If one name gets a bad reputation, only 3 lines are affected, and your real
  business email is never touched.
- A **dialer program** (**coldflow**, the software in this package) decides who gets emailed
  from which line and when. It also sends the follow-up emails and stops as soon as someone replies.
- A **warmup service** (Instantly) makes the new lines look like normal, active email accounts
  before you start, which keeps your emails out of spam folders.
- A **list of businesses to contact** (your **leads**) comes from a data provider. It's checked
  by a **verification service** so you don't email addresses that don't exist.

The math: 93 accounts, minus about 13 kept as spares, leaves 80 sending × 30 emails × about 21
weekdays ≈ **50,000 emails a month**. Each business gets 3 emails (a first email and 2
follow-ups), so you need about **16,700 new businesses to contact each month**.

---

## Part 2: Why it has to be done this way

**Why not just use Mailchimp or Gmail?**
Newsletter services (Mailchimp, SendGrid, Amazon SES and similar) **ban cold email** in their
rules and will close your account. A single normal Gmail account can't send 50,000 emails either:
it would be flagged as spam within days.

**Why so many email accounts?**
Gmail, Outlook and the other big email providers watch how many emails each account sends. A
real person sends a few dozen a day. An account that suddenly sends 2,000 a day gets its emails
sent to spam. Spreading 2,400 daily emails over 80 accounts keeps each one looking normal.

**Why new website names (domains) instead of my own?**
Every domain builds a reputation with email providers. Cold email always generates some spam
complaints. If that happens on your real domain, your invoices and client emails start going to
spam too. Separate domains protect your real one. If a cold domain goes bad, you stop using it
and buy another for about $11.

**Why wait two weeks before sending (warmup)?**
A brand-new email account that immediately sends lots of email looks like a spammer. Warmup is a
service that makes your accounts send and receive friendly emails with thousands of other accounts
for a couple of weeks. It also takes any of those emails that landed in spam and marks them "not
spam". Email providers see an account with a normal history, so your real emails land in the inbox.

**Why is this setup the cheapest?**
Three things drive the cost:
1. **The email accounts** are the biggest cost. Microsoft's cheapest business email plan is $4
   per account, and cold-email "resellers" (companies that buy Google accounts in bulk and rent
   them out) charge about $3-3.90. Google directly costs $7.
2. **Warmup** is expensive if you pay per account ($9-29 each = $840+/month for 93). Instantly's
   cheapest plan ($47/month) warms **unlimited** accounts. You use Instantly **only** for
   warmup, not for sending.
3. **Sending software** usually costs $97+/month at this volume. coldflow is yours and free to
   run. It needs a small rented computer at about $6/month.

---

## Part 3: The exact shopping list and costs

| # | What | Where (examples) | How many | Price | Monthly |
|---|---|---|---|---|---|
| 1 | Domains (website names) | Porkbun, Namecheap or Cloudflare | 31 | ~$11-12 each per year | ~$31 (paid ~$370 up front) |
| 2 | Microsoft email accounts ("Exchange Online Plan 1") | Microsoft, direct | 48 on 16 domains (in 2 separate Microsoft accounts of 24) | $4 each (1-year commitment) | $192 |
| 3 | Google email accounts via a cold-email reseller | e.g. Zapmail, MailDeck and others (compare) | 45 on 15 domains | ~$3-3.90 each | ~$135-175 |
| 4 | Warmup | Instantly, "Growth" plan | 1 plan | $47 (or $37.60/mo paid yearly) | $38-47 |
| 5 | Rented computer to run coldflow (a "VPS") | Hetzner, DigitalOcean, Vultr and others | 1 | ~$5-6 | ~$6 |
| 6 | Business contact data | One Apollo seat and/or a Google Maps scraping tool | - | ~$50-150 | ~$50-150 |
| 7 | Email verification | MillionVerifier | ~25,000 checks | ~$37 per 10,000 | ~$60-90 |
| | **Total** | | | | **~$510-690/month** |

**Up-front and first-month cash:**
- Domains for a year: ~$370
- First month of email accounts, warmup and server: ~$400
- First batch of about 20,000 leads (data plus verification): ~$150-250
- **Total before you've sent much: ~$900-1,000**

**Optional extras:**
- A **virtual mailbox** (a street address that receives mail for you) if you don't want your home
  address in every email's footer: ~$10-20/month. The law requires a real postal address in every
  email (Part 8).

**Cost per result**, at 2% of businesses replying (a typical planning figure, not a promise):
- Cost per email: about **$0.012-0.014**
- About 330 replies, about 58 sales calls and about 11 new clients a month
- About **$10-12 per sales call** booked

---

## Part 4: Step-by-step setup

Rough timing:
- **Week 0 (days 1-5):** buying and setup (Steps 1-8), about 3 days of work
- **Weeks 1-2:** warmup runs on its own; you prepare leads and emails (Steps 9-11)
- **Weeks 3-4:** sending starts slowly and ramps up automatically (Step 12)
- **Week 5 onward:** full volume

Software screens change over time. If a button has moved, search the provider's help pages for
the task (for example, "Porkbun add DNS record").

---

### Step 1: Decide who you're emailing and what you're offering (free, 1-2 hours)

1. **Pick 1-2 types of business** (a **niche**), for example "roofing companies in the US" or
   "dental practices". The package has 3 ready email sequences: local services, online stores
   (e-commerce) and B2B companies.
2. **Write one real result** you got for a client, with numbers. For example: "A roofer in Tampa
   went from 9 to 31 inspections a month in 60 days." The email templates have
   `[[ONE-LINE PROOF]]` gaps for this. The software **refuses to send** until you fill them.
3. **Decide what you're offering** that's easy to say yes to, like a free 5-minute video audit of
   their ads.

---

### Step 2: Buy your 31 domains (~$370, about 1 hour)

A **domain** is a website name like `getrobertsonmedia.com`. You rent it yearly from a
**registrar** (a company that sells domains).

1. Create an account at a registrar. Porkbun, Namecheap and Cloudflare are all fine; Porkbun is
   simple and cheap.
2. **Choose names that look like your brand.** If your agency is "Robertson Marketing", try:
   - `getrobertsonmarketing.com`, `tryrobertsonmarketing.com`, `robertsonmarketinghq.com`
   - `robertson-marketing.com`, `robertsonmarketingco.com`, `robertsongrowth.com`
   - Stick to **`.com`**. Unusual endings (`.xyz`, `.top`, `.info`) look spammy to email filters.
3. Buy **31**. Log each one in `templates/domain_tracker.csv` (a spreadsheet file; open it with
   Excel or Google Sheets).
4. **Forward each domain to your real website.** In the registrar, find "URL forwarding" or
   "redirect" for each domain and point it to your real site (e.g. `https://robertsonmarketing.com`).
   Anyone who types the cold domain into a browser then lands on your real business.
5. **Keep all domains in YOUR registrar account**, even if someone else later sets up the email.
   Whoever controls the domains controls everything.

---

### Step 3: Set up your 48 Microsoft email accounts ($192/month, about half a day)

Microsoft's cheapest business email is called **Exchange Online (Plan 1)**, $4 per account per
month with a 1-year commitment.

You'll create **2 separate Microsoft business accounts** (Microsoft calls each one a **tenant**,
basically "a company's Microsoft account"). Put **8 domains and 24 email accounts in each**. The reason: if
Microsoft decides one tenant is sending spam, it can block every account inside it. Two tenants
means a block only stops half your Microsoft accounts.

**For each of the 2 tenants:**
1. Go to Microsoft's **Exchange Online (Plan 1)** product page and choose **Buy now**. You create a
   new Microsoft business account with a temporary address like `robertson1.onmicrosoft.com`.
   Choose annual billing for the $4 price.
2. Open the **Microsoft 365 admin center** (`admin.microsoft.com`).
3. **Add your domains** (8 per tenant; your 31 domains split 16 Microsoft / 15 Google):
   - Go to **Settings → Domains → Add domain**.
   - Microsoft shows you records to copy into your registrar. That's **DNS**, explained in Step 5;
     do Steps 3 and 5 together.
4. **Create the email accounts:** **Users → Active users → Add a user**.
   - 3 per domain, named like a real person: `alex@`, `alex.r@`, `a.robertson@`.
   - Use real team members' names, or a consistent persona you'll actually reply as.
5. **Assign each user an Exchange Online (Plan 1) license.** Buy extra licenses under **Billing →
   Your products**.
6. **Add a profile photo** to each account. It makes you look real when people reply.

---

### Step 4: Get your 45 Google email accounts from a reseller (~$135-175/month, about 1 hour)

A **reseller** is a company that buys Google Workspace (Google's business email) in bulk and rents
accounts to cold emailers for less than Google charges ($7). Several exist; compare two or three.

**Before paying, ask the reseller these 4 questions by email or chat:**
1. "Is cold outreach allowed on your accounts?" You need **yes**.
2. "Can I connect with **IMAP/SMTP using an app password**?" You need **yes**. coldflow connects
   this way. Some resellers only allow connecting through their partner tools.
3. "Will the accounts use **my own domains**, and do you set up the DNS records?"
4. "If I leave, can I take the accounts or domains with me?"

If a reseller says no to 1 or 2, pick another. If none fit, buy Google Workspace directly
("Business Starter", $7 per account). It costs about $150/month more but carries no reseller risk.

Put 3 accounts on each of your remaining 15 domains. Use the same naming style as the Microsoft ones.

**App passwords for Google accounts:** an **app password** is a special 16-letter password that
lets a program like coldflow log in without your normal password. To create one:
1. Sign in as the account and go to `myaccount.google.com` → **Security**.
2. Turn on **2-Step Verification** (Google requires it first).
3. Search the settings for **App passwords**, create one named "coldflow", and copy the 16 letters.

The reseller may generate these for you. You'll need one per Google account in Step 8.

---

### Step 5: Set up DNS for every domain (free, about 2-4 hours in total)

**DNS** is the internet's phone book: public settings attached to each domain that tell the world
where its email lives and prove your emails are genuine. Without these, your emails go straight to
spam. You add them in your **registrar** (Porkbun etc.) under "DNS records" for each domain.

Each **record** has a **type**, a **host** (sometimes called "name"), and a **value** (sometimes
"answer" or "content"). You'll add 4 kinds:

| Record | What it does, plainly | Where the exact value comes from |
|---|---|---|
| **MX** | "Deliver email for this domain to Microsoft/Google." Without it, replies can't arrive | Microsoft's domain wizard (Step 3), or your reseller/Google |
| **SPF** (a TXT record) | "Only Microsoft/Google may send email for this domain." It stops others faking you | Microsoft: `v=spf1 include:spf.protection.outlook.com ~all` · Google: `v=spf1 include:_spf.google.com ~all` |
| **DKIM** | A digital signature on every email proving it really came from you and wasn't changed | Microsoft: Defender portal (`security.microsoft.com`) → Email & collaboration → Policies → Email authentication → DKIM → your domain → create keys (2 records) → then **Enable**. Google: Admin console → Apps → Gmail → Authenticate email |
| **DMARC** (a TXT record, host `_dmarc`) | Tells email providers what to do with emails that fail the checks above, and sends you reports | `v=DMARC1; p=none; rua=mailto:dmarc@yourrealdomain.com` (use an address on your real domain) |

**Rules:**
- Only **one SPF record** per domain.
- Changes can take from a few minutes to a few hours to take effect.

**Check your work.** Once coldflow is installed (Step 8), run `python3 -m coldflow dns-check`. It
checks every domain and prints **OK** or **FIX** with the problem. Also send one test email from
each new domain to `mail-tester.com`; it scores your setup out of 10, and you want 9 or more.

---

### Step 6: Start warmup in Instantly ($47/month, about 2 hours)

1. Sign up at Instantly and choose the **Growth** plan ($47/month, or $37.60/month paid yearly).
2. **Connect every one of your 93 email accounts:**
   - Microsoft accounts: choose Microsoft and sign in as each account.
   - Google accounts: use the IMAP/SMTP option with the app password from Step 4.
   Instantly's help pages show the exact screens.
3. **Turn warmup ON** for every account. Use the default settings, or start at about 5-10 warmup
   emails a day rising to 20-40.
4. **Do NOT create campaigns in Instantly.** The Growth plan only allows 5,000 campaign emails a
   month. You're using it **only** for warmup, which is unlimited on this plan and doesn't count
   toward that limit.
5. **Write down today's date.** It's each account's `warmup_start` date in Step 8.
6. **Leave warmup running forever**, even after you start sending. It keeps the accounts healthy.

---

### Step 7: Rent a small server ($5-6/month, about 30 minutes)

A **server** (or **VPS**, "virtual private server") is a computer you rent in a data center. It's
always on, which coldflow needs because it runs every morning on a schedule. You control it from
your own computer by typing commands.

1. Sign up with a server provider (Hetzner, DigitalOcean, Vultr and others) and create the
   **smallest server**. Choose **Ubuntu 24.04** as the operating system (the software the server
   runs; Ubuntu is free and common).
2. The provider gives you an **IP address** (the server's number on the internet, like
   `203.0.113.10`) and a **root password** or login key. "Root" is the main admin account.
3. **Open a terminal on your own computer.** A **terminal** is a text window where you type
   commands.
   - Mac: open the app called **Terminal**.
   - Windows: open **PowerShell**.
4. **Connect to the server** by typing this and pressing Enter (use your IP):
   ```
   ssh root@203.0.113.10
   ```
   **SSH** is a secure way to control another computer by typing. Say "yes" to the first-time
   question and enter the password. Your prompt now belongs to the server.
5. **Check that the server can send email.** Some providers block email sending on new accounts
   to stop spammers. Paste this on the server:
   ```
   python3 -c "import smtplib; smtplib.SMTP('smtp.office365.com',587,timeout=10).quit(); print('OK: email port open')"
   ```
   If it prints **OK**, you're fine. If it hangs or errors, open a support ticket with the provider
   asking them to "allow outbound SMTP on port 587", or try another provider.
6. **Set the server's clock to your time zone** (so "7:30am" means your 7:30am):
   ```
   timedatectl set-timezone America/New_York
   ```

---

### Step 8: Install coldflow and connect your accounts (about 2-3 hours)

**Put the software on the server.**

1. From your **own computer's** terminal (not the server; open a second window), upload the zip:
   ```
   scp cc50k-email-system.zip root@203.0.113.10:/opt/
   ```
   `scp` copies a file to the server. Run it from the folder where the zip is saved, e.g. your
   Downloads folder: type `cd Downloads` first.
2. **Back on the server**, install the few tools needed and unpack the package:
   ```
   apt update && apt install -y unzip sqlite3 python3-dnspython
   cd /opt && unzip cc50k-email-system.zip && cd cc50k
   python3 -m coldflow init
   ```
   `init` creates the settings file `coldflow.toml`, the database (a file that stores all your
   leads, emails and replies) and the log folders.

**Fill in your settings.** Open the settings file in `nano`, a simple text editor inside the
terminal:
```
nano coldflow.toml
```
Move with the arrow keys and change these lines:
- `name`: your real business name (legally required in every email)
- `physical_address`: your real postal address (legally required)
- `website`: your real website
- `timezone`: e.g. `America/New_York`, `America/Chicago`, `America/Los_Angeles`
- Under `[alerts]`: `webhook_url` for Slack/Discord messages (Step 12); leave it empty for now

Save with **Ctrl+O** then **Enter**, and exit with **Ctrl+X**.

**List your email accounts.** On your own computer, open `templates/inboxes_template.csv` in
Excel or Google Sheets and make one row per account:
- `email`: the address
- `from_name`: the name people see, e.g. "Alex Robertson"
- `provider`: `microsoft` or `google`
- `auth`: `oauth` for Microsoft, `password` for Google
- `daily_cap`: 30
- `warmup_start`: the date from Step 6, in the form 2026-10-01

Save it as a CSV file named `my_inboxes.csv`, upload it with `scp` like the zip, then on the server:
```
python3 -m coldflow inboxes import /opt/my_inboxes.csv
```

**Add the Google app passwords.** coldflow keeps passwords in a private file called `.env`, not
in its database.
```
python3 -m coldflow inboxes env > .env
chmod 600 .env
nano .env
```
- The first command writes one line per Google account, e.g. `CF_PW_ALEX_AT_GETROBERTSON_COM=''`.
- `chmod 600` makes the file readable only by you.
- In nano, paste each account's app password between the quotes. Save and exit.

Load the passwords into your current session. You need to repeat this each time you log in and
run commands by hand; the automatic schedule loads them by itself:
```
set -a; source .env; set +a
```

**Connect the Microsoft accounts (one-time, about 30 minutes).** Microsoft no longer accepts
passwords from programs like coldflow. It uses **OAuth** instead: a secure "sign in once in your
browser and grant permission" system, like "Sign in with Google" buttons on websites. First you
register coldflow with Microsoft as an **app**. This just tells Microsoft "this program may send
email for accounts that approve it".

1. Go to `entra.microsoft.com` and sign in as the admin of your **first** tenant. **Entra** is
   Microsoft's user and security settings site.
2. Go to **App registrations → New registration**.
   - Name: `coldflow`
   - Who can use it: **Accounts in any organizational directory** (so both tenants can use it)
   - Click **Register**.
3. On the app's page, copy the **Application (client) ID**, a long code like `1a2b3c4d-...`.
4. Go to **Authentication** → turn **Allow public client flows** to **Yes** → Save.
5. Go to **API permissions → Add a permission → APIs my organization uses**:
   - Search **Office 365 Exchange Online** → **Delegated permissions**.
   - Tick **SMTP.Send** and **IMAP.AccessAsUser.All** → **Add**.
   - Then click **Grant admin consent**.
6. **Allow sending for each Microsoft account.** In the Microsoft 365 admin center: **Users →
   Active users** → click an account → **Mail** → **Manage email apps** → tick **Authenticated
   SMTP** and **IMAP** → Save. Repeat for all 48; it's tedious but one-time.
7. On the server, open `coldflow.toml` again with nano and put the code from step 3 under
   `[oauth_microsoft]`:
   ```
   client_id = "1a2b3c4d-..."
   ```
8. Run the sign-in:
   ```
   python3 -m coldflow auth login
   ```
   For each Microsoft account it prints a short code and the address
   `microsoft.com/devicelogin`. On your own computer:
   - open a **private/incognito browser window** (so you're not signed in as someone else)
   - go to that address and enter the code
   - sign in **as that email account** and approve
   - the server says "signed in" and moves to the next account
   For the **second tenant**, the first sign-in must be done by that tenant's admin account, who
   ticks **"Consent on behalf of your organization"**.
9. Check that every account works:
   ```
   python3 -m coldflow auth status
   ```
   Every line should say **ok**. Microsoft's permission lasts as long as the account keeps being
   used. If an account sits unused for about 90 days, run `auth login --email that@address.com` again.

**Check your DNS** (from Step 5):
```
python3 -m coldflow dns-check
```

---

### Step 9: Get and clean your leads (~$110-240/month, a few hours each week)

A **lead** is one person at one business you'll email: their email address, name, company and
so on. You need about **16,700 new leads a month**, about **4,200 a week**.

**Where to get them cheaply:**
- **Local businesses** (roofers, dentists, etc.): a **Google Maps scraping tool** collects
  businesses from Google Maps, then finds owners' emails. Compare a couple; they charge per
  thousand results.
- **B2B companies by job title** (e.g. "CEO at 10-50 person IT companies"): a **B2B contact
  database** such as Apollo. One seat is about $49-99/month. **Check how many emails a month the
  plan lets you export** before buying; those "export credits" are the real limit.

**Always verify** before importing. A **verification service** (MillionVerifier: ~$37 per 10,000
checks) tests whether each address really exists without sending an email. Emailing addresses that
don't exist causes **bounces** (emails returned as undeliverable). Too many bounces and email
providers treat you as a spammer. Upload your list, download the results, and keep the verifier's
status column in the file; coldflow reads it and only keeps **valid** addresses.

**Import on the server:**
```
python3 -m coldflow leads import /opt/roofers_week1.csv --source roofers-week1
```
coldflow automatically throws out:
- duplicates (anyone you already have, even from months ago)
- generic addresses like `info@` and `sales@`
- personal Gmail/Yahoo addresses (this is business outreach)
- invalid addresses
- anyone on your **do-not-contact list**

**Build your do-not-contact list** (called a **suppression list**) before sending: your
clients, competitors, partners, and anyone who has asked not to be contacted. Put one email or
whole domain per line in a CSV and run:
```
python3 -m coldflow leads suppress /opt/do_not_contact.csv --reason "clients and partners"
```

---

### Step 10: Write your emails (free, 1-2 hours)

A **sequence** (also called a **campaign**) is the set of emails each lead gets. Here that's 3:
- day 0: the first email
- day 3: follow-up 1
- day 8: follow-up 2

Follow-ups are sent as replies in the same email conversation (a **thread**). The sequence
**stops automatically** when someone replies.

1. On your own computer, open `campaigns/local-services.toml` in any text editor (Notepad or
   TextEdit is fine).
2. Replace every `[[ONE-LINE PROOF]]` with your real result from Step 1.
3. Things like `{{first_name|there}}` fill in automatically: the lead's first name, or "there" if
   it's missing.
4. Keep the rules: plain text, short, no links in the first email, one simple question at the end.
5. Put the edited file back on the server. From your own computer's terminal:
   ```
   scp local-services.toml root@203.0.113.10:/opt/cc50k/campaigns/
   ```
   (Or edit it directly on the server: `nano campaigns/local-services.toml`.) Then register it and
   preview how it reads for a real lead:
   ```
   python3 -m coldflow campaign add campaigns/local-services.toml
   python3 -m coldflow campaign preview local-services
   ```
6. Put your leads into the campaign:
   ```
   python3 -m coldflow campaign enroll local-services
   ```

---

### Step 11: Test safely before going live (about 1 hour)

1. **Practice run.** Nothing is sent: a **dry run** writes the emails as files so you can read them.
   ```
   python3 -m coldflow schedule
   python3 -m coldflow send
   ```
   Read a few of the files in `data/outbox/`. Check names, company names and the footer with your
   address and opt-out line.
2. **Tiny live test**, only after warmup has run 14 days. coldflow won't send earlier anyway:
   ```
   python3 -m coldflow send --live --limit 10
   ```
   Then log into two or three of the sending accounts and look in their **Sent** folders to
   confirm the emails look right.

---

### Step 12: Put it on autopilot (about 30 minutes)

**Daily summary messages.** Get a message every morning with what happened and any problems:
- **Slack:** create an app at `api.slack.com/apps` → **Incoming Webhooks** → On → **Add New
  Webhook** → pick a channel → copy the web address it gives you.
- **Discord:** channel **Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**.

Paste that address into `webhook_url` under `[alerts]` in `coldflow.toml`, then test it:
```
python3 -m coldflow alert-test
```

**The automatic schedule** (called **cron**, the server's built-in alarm clock that runs commands
at set times). Type:
```
crontab -e
```
Pick `nano` if asked, and paste the lines from `scripts/crontab.example`. They run:
- **7:30am weekdays:** read replies → build today's send list → send → update the dashboard →
  send you the summary
- **12:00 and 16:00:** check replies again, so anyone who replies or opts out is stopped quickly
- **Monday 6am:** a deeper check for late bounces
- **Every night:** a backup of the database

Save and exit.

**What happens next, automatically:**
- **Days 1-14 after warmup started:** nothing is sent.
- **Day 15:** each account sends 5 emails, then 7, 9, 11… up to 30 by about day 27.
- **From about week 5:** about 2,400 emails a day, about 50,000 a month.

---

## Part 5: Your daily and weekly routine

**Every weekday (about 1-2 hours, mostly replies):**
1. **8:00: read the summary** in Slack or Discord. Anything under **WARNINGS** comes first (see Part 6).
2. **All day: answer interested replies within an hour.**
   - The summary and the dashboard (`reports/dashboard.html`) list who replied and what they said.
   - Reply from the **same email account** they replied to (log into it in the browser), so the
     conversation stays in one thread.
   - Keep it short: offer two specific times for a call, plus your booking link.
3. **17:00:** record interested leads and booked calls in your CRM (customer tracking tool) or a
   spreadsheet. `python3 -m coldflow export --interested-only` gives you a spreadsheet file.

**Every Monday (about 1 hour):**
1. **Look at the numbers:** emails sent, reply rate, interested replies, calls booked, bounce rate.
2. **Paused accounts:** replace any paused account with a spare (Part 6).
3. **Emails:** if one version of your first email clearly gets more replies after 300+ leads each,
   keep it and write a new challenger.
4. **Leads:** make sure next week's ~4,200 leads are bought, verified, imported and enrolled.
   The summary warns you when you're about to run out.

**Healthy numbers:**

| Measure | Good | Worry | Stop and fix |
|---|---|---|---|
| **Bounce rate** (emails returned as undeliverable) | under 1.5% | 1.5-3% | over 3% (account auto-pauses) |
| **Reply rate** (share of businesses that reply) | over 2% | 1-2% | under 0.5% for 2 weeks |
| **Opt-out rate** (people saying "stop") | under 0.5% | 0.5-2% | over 2% (account auto-pauses) |

---

## Part 6: What can go wrong, and what to do

| The summary says / you notice | What it means | What to do |
|---|---|---|
| **"Inbox paused: … bounce rate …"** | That account's emails hit too many dead addresses, so coldflow stopped it to protect it | Your lead list is the problem. Re-verify it. Leave the account warming (not sending) for 2 weeks, then `inboxes resume --email …`. Meanwhile a spare covers |
| **"Inbox paused: … unsubscribe rate …"** | Too many people said "stop" | Your targeting or message is off. Rewrite the first email or narrow the niche |
| **"… No OAuth token" / "Token refresh failed"** | A Microsoft account's permission expired | `python3 -m coldflow auth login --email that@address.com` |
| **"env var … is not set" / SMTP auth failures** | A Google app password is missing or was revoked | Make a new app password (Step 4), update `.env` |
| **"Lead supply low"** | You'll run out of leads to email within ~3 days | Buy, verify, import and enroll more (Step 9) |
| **"… follow-ups deferred: inboxes at capacity"** | Accounts are full with follow-ups | Normal early on; it evens out. If it persists, add accounts |
| **Replies suddenly drop, same emails** | Emails are probably landing in spam | Send test emails to Gmail and Outlook addresses you own and see where they land. Run `dns-check`. Lower `daily_cap` to 15 for a week. Remove any links |
| **A domain appears on a "blocklist"** | A public spam list flagged it (check free blocklist lookup sites weekly) | Stop using that domain's 3 accounts (`inboxes retire`), buy a new domain, and set up 3 new accounts with warmup |
| **Server was off or crashed** | Nothing sent that morning | Nothing to do: unsent emails roll to the next day, and the system never double-sends |

Expect to replace about **3-6 domains per quarter**. That's normal wear, and the ~12 spare
accounts cover you while replacements warm up.

---

## Part 7: Where to save money, and where never to

**Good savings (already in this plan):**
- $4 Microsoft and ~$3-3.90 reseller Google accounts instead of $7
- Instantly's $47 plan for warmup only, instead of $9-29 per account
- Running coldflow yourself instead of paying $97+/month for sending software
- Paying yearly where you're sure (Instantly: $37.60 instead of $47)

**Savings that cost you more in the end, so don't:**
- **Skipping verification.** Bounces burn domains, and replacing a domain and its 3 accounts
  costs more than months of verification.
- **Sending more than 30 a day per account.** At 40 you'd need 23 fewer accounts (~$90/month
  saved), but accounts get flagged much faster.
- **Skipping warmup** or turning it off after launch.
- **Super-cheap email hosts** (about $1 per account). Their rules usually forbid bulk email, and
  their emails land in spam more often.
- **Sending from your real business domain.** Never.

**If you want it even simpler (costs a bit more):** go all-Microsoft with 4 tenants of about 24
accounts (all at $4, no reseller). That's roughly the same price, one supplier, but all your eggs
are with Microsoft. Or pay about $320/month more to let Instantly do the sending (the "hybrid"
option in `playbook/09_cheapest_setup.md`) so you don't run a server at all.

---

## Part 8: The legal basics (US)

This is a summary, not legal advice. For B2B cold email in the US, the law (**CAN-SPAM**)
requires:
1. **Honest sender details.** Real name and real email account (done).
2. **Honest subject lines.** No fake "Re:" on a first email (coldflow only uses "Re:" on real
   follow-ups).
3. **Your real postal address** in every email (set in `coldflow.toml`; added automatically).
4. **A clear way to opt out** (every email ends with "Reply 'no thanks' and I won't reach out
   again", plus a hidden unsubscribe link that email apps show as a button).
5. **Honor opt-outs within 10 business days, forever.** coldflow adds opt-outs to the
   do-not-contact list as soon as it reads the reply.

**Stick to US businesses at first.** Canada (CASL), the UK and the EU (GDPR) have stricter rules;
see `playbook/05_compliance.md` before emailing outside the US.

---

## Part 9: Glossary

| Term | Plain meaning |
|---|---|
| **App password** | A special password that lets a program log into an email account without your normal password (Google) |
| **Blocklist / blacklist** | A public list of domains or servers reported for spam. Being on one hurts delivery |
| **Bounce** | An email returned as undeliverable. A **hard bounce** means the address doesn't exist |
| **B2B** | Business-to-business: selling to companies, not consumers |
| **CAN-SPAM** | The US law for commercial email (Part 8) |
| **Campaign / sequence** | The set of emails each lead receives (first email plus follow-ups) |
| **Catch-all** | A company email setup that accepts mail for any address, so a verifier can't tell whether a person exists there. Treat as risky |
| **coldflow** | The software in this package that sends, follows up, reads replies and reports |
| **Cold email** | Emailing a business that doesn't know you yet |
| **Cron** | The server's built-in scheduler; runs commands at set times |
| **CRM** | Customer relationship management: a tool or spreadsheet where you track prospects and deals |
| **CSV** | A simple spreadsheet file format; opens in Excel or Google Sheets |
| **Dashboard** | The web page coldflow generates with your numbers (`reports/dashboard.html`) |
| **Deliverability** | How reliably your emails land in the inbox rather than spam |
| **DKIM** | A digital signature on your emails proving they're genuine (a DNS record) |
| **DMARC** | A DNS record telling email providers what to do with emails that fail SPF/DKIM checks |
| **DNS** | Public settings attached to a domain: the internet's phone book |
| **DNS record** | One entry in those settings (types: MX, TXT, CNAME…) |
| **Domain** | A website name, like `example.com`: the part of an email address after the @ |
| **Dry run** | A practice run that shows what would happen without actually sending |
| **Enroll** | Put leads into a campaign so they'll start receiving it |
| **Entra** | Microsoft's site for business account and app settings |
| **Exchange Online (Plan 1)** | Microsoft's cheapest business email product ($4/account) |
| **Follow-up** | A later email in the sequence, sent only if the person hasn't replied |
| **Google Workspace** | Google's business email (Gmail on your own domain) |
| **IMAP** | The standard way a program **reads** an email account (coldflow uses it to read replies) |
| **Inbox / mailbox / email account** | One email address you can send from and receive at |
| **IP address** | A computer's number on the internet |
| **Lead** | One person at one business you plan to email |
| **Microsoft 365 admin center** | The website where you manage your Microsoft business accounts |
| **MX record** | The DNS record saying which company handles email for a domain |
| **Niche** | The type of business you target, e.g. roofers |
| **OAuth** | "Sign in once in the browser and grant permission" instead of giving a program your password |
| **Opt-out / unsubscribe** | Someone asking not to be emailed again. You must honor it |
| **Registrar** | A company you rent domains from (Porkbun, Namecheap, Cloudflare…) |
| **Reply rate** | The percentage of leads who reply |
| **Reseller** | A company that buys email accounts in bulk and rents them out cheaper |
| **Root** | The main administrator account on a server |
| **Sending window** | The hours emails are allowed to go out (8am-5pm weekdays) |
| **Server / VPS** | A rented, always-on computer in a data center |
| **SMTP** | The standard way a program **sends** email through an account |
| **SPF** | A DNS record listing who is allowed to send email for your domain |
| **SSH** | A secure way to control a server by typing commands |
| **Suppression / do-not-contact list** | Addresses and domains that must never be emailed |
| **Tenant** | One Microsoft business account (a company's container of users, domains and settings) |
| **Terminal** | A text window for typing commands (Terminal on Mac, PowerShell on Windows) |
| **Thread** | An email conversation: an original email and its replies |
| **Ubuntu** | A free operating system commonly used on servers |
| **Verification** | Checking that an email address exists before you email it |
| **Warmup** | Automated friendly email activity that builds a new account's good reputation |
| **Webhook** | A web address that accepts messages, used here to post your daily summary into Slack or Discord |

---

## Part 10: The one-page checklist

**Week 0: buy and build**
- [ ] Niche chosen, proof line written, offer decided
- [ ] 31 `.com` domains bought, all forwarding to your real website
- [ ] 2 Microsoft tenants, 48 Exchange Online accounts (3 per domain, 16 domains), photos added
- [ ] 45 Google accounts (15 domains) from a reseller that answered yes to the 4 questions
- [ ] DNS: MX, SPF, DKIM, DMARC on every domain
- [ ] All 93 accounts connected to Instantly Growth, warmup ON, date written down
- [ ] Server rented (Ubuntu 24.04), port 587 test says OK, time zone set
- [ ] coldflow installed; `coldflow.toml` has real name, address, website and time zone
- [ ] Accounts imported; Google app passwords in `.env`; Microsoft app registered and `auth login` done
- [ ] `auth status` all **ok**; `dns-check` all **OK**; mail-tester 9+/10
- [ ] Slack/Discord summary set up and `alert-test` received
- [ ] Cron schedule installed

**Weeks 1-2: prepare while warmup runs**
- [ ] Do-not-contact list imported
- [ ] First ~20,000 leads bought, verified, imported and enrolled
- [ ] `[[ONE-LINE PROOF]]` filled in; `campaign preview` reads well
- [ ] Dry run done and emails read

**Week 3: go live**
- [ ] `send --live --limit 10` checked in Sent folders
- [ ] Automatic schedule running; summary arriving every morning
- [ ] You answer interested replies within an hour

**Every week after**
- [ ] ~4,200 new verified leads enrolled
- [ ] Paused accounts replaced
- [ ] Numbers reviewed; the best email kept, a new version tested
