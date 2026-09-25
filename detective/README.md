# Internet Detective

A local web app that researches a **company, public figure, domain or username** from public sources
and builds an investigation dashboard. Every fact links to its source, and every fact shows how sure it is.

## Run it

Needs Python 3.10+ and nothing else (standard library only).

```
python -m detective            # opens http://127.0.0.1:8787
python -m detective --demo     # offline, fictional sample data, to see how it works
python -m detective --json stripe.com   # one case as JSON, no browser
```

Run the commands from the folder that contains `detective/`.

## What it checks

| Search | Sources |
|---|---|
| Domain | Registry record (RDAP), DNS (A, MX, NS, TXT, DMARC via Google Public DNS), certificate logs (crt.sh), Internet Archive, the homepage itself, Wikidata entry that lists the domain, Hacker News |
| Company / name | Wikidata, Wikipedia, GLEIF legal-entity registry, Hacker News, then everything above for its official website |
| Person | Only public figures with a Wikipedia article: Wikidata, Wikipedia, Hacker News, their official website |
| Username | Public profiles on GitHub, GitLab, Hacker News, DEV and Keybase |

## How to read it

Each claim has numbered footnotes to the source list, plus a confidence level:

- **Official record**: registry or protocol data (RDAP, DNS, certificate logs, GLEIF).
- **Owner-published**: what the site or account says about itself. Not independently checked.
- **Crowd-sourced**: Wikidata or Wikipedia.
- **Inferred**: our reading of a record (e.g. MX points at Google, so they likely use Google Workspace).
- **Unconfirmed match**: same name or username only. May be a different entity.

"✓ N sources agree" means two or more *different publishers* state the same thing. A red **Conflict**
tag means the sources disagree (e.g. two founding years), and the case lists both. Sources that failed
to respond are listed as incomplete. Missing results are not evidence of absence.

Click **Investigate →** on any domain, subdomain, related company or person to pivot. The breadcrumb
trail keeps your path. Export a case as a Markdown report or JSON.

## Privacy rules (enforced in code)

- Refuses email addresses, phone numbers and street addresses.
- Person searches stop unless the person is a public figure with a Wikipedia article. Names that don't
  resolve to an organisation or public figure only get a company-registry check.
- Never copies personal contact details or locations from profiles (e.g. GitHub location/email).
- Same username on two sites is always marked "Unconfirmed match". Accounts are only linked when the
  owner linked them (profile links, Keybase signed proofs).
- Public, unauthenticated APIs only: no logins, scraping behind walls, or paid people-search data.
- Binds to 127.0.0.1 by default.

## Tests

`python -m unittest tests.test_detective` (offline, uses the demo data).
