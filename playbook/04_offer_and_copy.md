# Offer and copy

Deliverability gets you into the inbox. The offer gets you replies. Most failing cold email
campaigns have an offer problem.

## 1. Build an offer they can say yes to quickly

A good agency offer for cold email is:
- **Specific to a niche.** "More booked roofing inspections", not "digital marketing services".
- **Backed by proof.** One real, numeric result from a similar client. This fills the
  `[[ONE-LINE PROOF]]` slots.
- **Low risk.** A free audit or video teardown, a pilot, performance terms, or no long contract.
- **Low effort to accept.** Ask a yes/no question, not "book 30 minutes on my calendar".

## 2. Rules the templates follow

1. **Plain text, 50-90 words.** Short paragraphs that read well on a phone.
2. **No links, images or attachments in email 1.** Offer to send the link when they reply.
3. **Subject lines: 2-5 words, lowercase-ish, like a colleague wrote them.** Avoid ALL CAPS,
   "free!!!", "$$$", "guarantee", "act now" and the like.
4. **Open with them, not you.** Icebreaker or observation first; one line about what you do; proof; question.
5. **One call to action**, ending in a question mark.
6. **Follow-ups reply in the same thread** and each adds something new (a free video, a one-page
   plan), then a polite close. `coldflow` sends 3 emails on day 0, 3 and 8.
7. **Every email has an easy out.** The footer says reply "no thanks" to stop, and the software honors it.

## 3. The three included campaigns

| File | Niche | Hook |
|---|---|---|
| `campaigns/local-services.toml` | HVAC, plumbing, roofing, dental, med spa, law | More booked jobs from Google/Facebook |
| `campaigns/ecommerce.toml` | Shopify/DTC brands | Lower ad costs + repeat purchases |
| `campaigns/b2b-services.toml` | 10-200 person B2B firms | Predictable pipeline |

Each first email has **two variants (A/B)**. Leads are split evenly and consistently. Edit the
files freely: `day`, `subject`, `body`, add `[[steps.variants]]`, or add `[filters]` to target
an industry. Then run:

```bash
python -m coldflow campaign add campaigns/local-services.toml   # re-run after every edit
python -m coldflow campaign preview local-services --lead jane@acmeroofing.com
```

### Template fields

- `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{title}}`, `{{city}}`, `{{industry}}`,
  `{{website}}`, plus **any extra CSV column** (e.g. `{{icebreaker}}`)
- `{{sender_first_name}}`, `{{sender_name}}`, `{{company_name}}`, `{{website_url}}`
- Fallbacks: `{{first_name|there}}`. Fallbacks can nest: `{{icebreaker|Saw {{company|you}} online.}}`
- A token **without** a fallback is required. Leads missing it are skipped instead of getting "Hi ,".

## 4. Testing

- Test **one thing at a time**, and give each variant **at least 300 leads** before judging it.
- Judge by **positive reply rate**, never opens.
- Test in this order, because each has a bigger effect than the next: **list/niche → offer →
  first line/icebreaker → CTA → subject line.**
- The winner becomes variant A; write a new challenger for B. Log each test in a sheet: date,
  campaign, change, leads per variant, replies, positives.

## 5. Replying to replies (where the money is)

- Answer **positive replies within 1 business hour**. Speed matters more than anything else here.
- Answer from the **same inbox** in the same thread. Keep it short and propose two specific times,
  plus your booking link as an alternative.
- Answer "who is this / how did you get my email" politely and honestly (you researched businesses
  in their industry), and offer to remove them.
- **Objection → reply:** "Already have an agency" → "Makes sense. If it'd be useful, I'm happy to
  do a free second-opinion audit; no need to switch anything." "Too expensive / no budget" → ask
  when budget planning happens and set a reminder.
- Log every positive reply in your CRM:
  `python -m coldflow export --interested-only` produces a CSV you can import.
