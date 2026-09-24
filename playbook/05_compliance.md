# Compliance

> This is a practical summary, not legal advice. Rules differ by country and change. Have a
> lawyer review your setup before sending at scale, especially outside the US.

## United States: CAN-SPAM (B2B cold email is allowed if you follow it)

Every commercial email must:
1. **Have accurate header information.** Real "From" name and address; `coldflow` sends from real inboxes you control.
2. **Have a subject line that isn't deceptive.** No fake "Re:" on a first email. `coldflow` only
   adds "Re:" to real follow-ups in an existing thread.
3. **Say it's an ad if it is one.** For one-to-one style sales outreach this is usually satisfied
   by the message being clearly a business pitch; ask your lawyer if unsure.
4. **Include a valid physical postal address.** Set in `coldflow.toml`, added to every email.
5. **Explain how to opt out.** The footer line plus a `List-Unsubscribe` header.
6. **Honor opt-outs within 10 business days, and never sell or transfer the address.**
   `coldflow` suppresses opt-outs as soon as it reads them (run `replies` at least daily).
7. **Take responsibility for anyone sending on your behalf**, including VAs and tools.

## Mailbox provider rules (Google, Yahoo, Microsoft)

Not law, but they decide where your mail lands:
- SPF, DKIM and DMARC on every sending domain
- Spam complaint rate under 0.3% (aim for under 0.1%)
- Easy opt-out, honored promptly
- Google Postmaster Tools on your domains to watch complaint rates

## Canada: CASL (strict)

CASL generally requires **consent** before sending commercial email. Implied consent can apply
when a business **publicly publishes** its email address, without a statement refusing
solicitations, **and** your message is relevant to their role. That test is narrow.
**Default: exclude Canadian leads** (`country = CA`) unless you have documented consent or have
confirmed the implied-consent basis with counsel.

## UK: PECR + UK GDPR

- Cold emailing **corporate subscribers** (limited companies, LLPs, government) is generally
  allowed under PECR with a clear opt-out. **Sole traders and partnerships** are treated like
  individuals and need consent.
- UK GDPR still applies to a named person's work email. You need a legitimate-interests basis
  (document a short legitimate interests assessment), must tell people where you got their data
  when asked, and must honor objections.

## EU: GDPR + national ePrivacy laws

Varies a lot by country. Germany, for example, is very restrictive for B2B cold email. **Keep EU
leads out** of Phase 1 unless you have local legal advice for each target country.

## Australia: Spam Act

Needs consent (inferred consent can apply to conspicuously published business addresses in narrow
cases), accurate sender identification and a working unsubscribe. Get advice before including AU.

## How to set the default geo (recommended: US only for Phase 1)

In each campaign file:

```toml
[filters]
country = ["us", "united states", "usa"]
```

## Data handling

- Keep lead data in the SQLite file on an encrypted disk, and back it up. Don't email CSVs around.
- Keep the do-not-contact list **forever**, including through domain changes and tool changes.
  `leads export` and every import already respect it.
- Answer "where did you get my data?" truthfully and promptly.
- Delete a person's data on request, but keep their address on the suppression list so they're
  never contacted again. That's allowed and expected.
