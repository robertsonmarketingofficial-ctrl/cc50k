# Lead sourcing: about 17,000 clean leads a month

At 3 emails per lead, 50k emails needs **~16,700 new leads a month (~800 per sending day)**.
Phase 2 needs ~72k a month. Lead quality decides your bounce rate, your reply rate and how long
your domains survive.

## 1. Define the ICP per campaign

For each campaign file, write down:
- **Niche:** e.g. residential roofing, med spas, Shopify skincare, IT managed services
- **Size:** revenue or employee band (e.g. 5-50 employees, $1M-$20M revenue)
- **Geo:** e.g. US only (see [Compliance](05_compliance.md) before adding Canada, UK or EU)
- **Buyer:** owner/founder/CEO for small businesses; head of marketing/growth for larger ones
- **Signals** (optional, raises reply rates): running ads, hiring marketers, new location,
  recent funding, poor reviews, slow site

## 2. Sources

| Source type | Good for | Notes |
|---|---|---|
| B2B contact databases (Apollo, ZoomInfo, Lusha, Seamless and similar) | Volume, filters by title, size, industry | Export in batches of a few thousand; always re-verify |
| Enrichment/waterfall tools (Clay and similar) | Personalization and signals | Pull company lists, then find and verify emails |
| Google Maps / local directories | Local service businesses | Scrape businesses → find the owner's email → verify |
| Shopify store lists (StoreLeads, BuiltWith and similar) | E-commerce | Filter by revenue band and tech stack |
| LinkedIn Sales Navigator + email finder | Senior B2B roles | Slower; best for higher-value niches |

Check each vendor's terms and data-protection stance. Use sources that document lawful collection.

## 3. Verify every email

- Run every list through an **email verifier** (NeverBounce, ZeroBounce, MillionVerifier,
  Bouncer and similar) right before import. Data older than about 30 days should be re-verified.
- Keep the verifier's status column. `coldflow leads import` recognizes it (`valid`,
  `deliverable`, `catch-all`, `invalid`, and so on) and by default imports only valid addresses.
- **Catch-all domains** accept everything, so bounces can't be predicted. Leave
  `allow_catch_all = false` until your inboxes are fully warm, then test catch-alls in small batches.

## 4. Import and hygiene (automatic)

```bash
python -m coldflow leads import apollo_roofers_oct.csv --source apollo-roofing-oct
```

The import automatically:
- recognizes common export headers (`Email`, `First Name`, `Company Name`, `Email Status` and so on)
- lowercases and de-duplicates across **all** past imports, so nobody is contacted twice
- skips role accounts (`info@`, `sales@` ...), free-mail addresses (gmail, yahoo ...), bad syntax,
  verifier failures, and anything on the do-not-contact list
- keeps any extra columns (e.g. `icebreaker`, `pain_point`) as template fields: `{{icebreaker|...}}`

## 5. The do-not-contact list

Load it **before your first send**:
- all current and past clients, and anyone in an active sales conversation
- competitors, partners and your own domains
- anyone who has opted out anywhere else

```bash
python -m coldflow leads suppress do_not_contact.csv --reason "clients & partners"
```

Entries can be full emails or bare domains (a domain blocks the whole company).

## 6. Personalization that scales

- Standard: `{{first_name}}`, `{{company}}`, `{{city}}`, `{{industry}}` with sensible fallbacks.
- Better: an `icebreaker` column with one specific, true line per lead (a new location, a recent
  review, what their site says). Generate it with an enrichment tool or AI, **spot-check 50** before
  a batch goes out, and keep it under 25 words.
- Never fake familiarity ("loved your post!") that isn't true. It hurts replies and trust.

## 7. Weekly lead workflow

| Day | Task |
|---|---|
| Mon | Pull next week's lists (~4,000-4,500 leads for Phase 1) |
| Tue | Verify and enrich; spot-check icebreakers |
| Wed | `leads import` → `campaign enroll <name> --limit N` |
| Fri | Check `status`: the "waiting" count should cover at least 5 sending days |
