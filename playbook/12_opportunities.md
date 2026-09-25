# Revenue opportunities (researched September 2026)

Three opportunities with real evidence behind them, plus the ones I looked at and rejected. Sources are
listed under each. Many statistics come from vendors selling the fix; those are marked, so test before you
rely on them.

---

## 1. Local Services Ads missed-call billing: act now (starts October 1, 2026)

**What changed.** From October 1, Google charges Local Services Ads (LSA) advertisers for **missed calls
during business hours when the caller stays on the line 20+ seconds**. Voicemail doesn't stop the clock.
Qualifying follow-up calls can also be charged. Phone menus ("press 1 for service") delay the timer until a
key is pressed. Automatic credits exist (US and Canada) but there's no manual negotiation. At the same time,
LSA is moving into Google Ads as Performance Max pay-per-lead campaigns (rollout from August 2026 through
2027), and manual bidding is going away.

| Question | Answer |
|---|---|
| Who pays? | Owners of home service businesses on LSA: plumbing, HVAC, electrical, roofing, pest control, garage door, locksmith, cleaning, moving. Also pet care, wellness and education |
| Problem | They already lose jobs to missed calls. Now they also **pay ~$50-60 per missed call** (plumbing $57, HVAC $51, roofing $71-162 average LSA cost per lead) |
| Why now | The billing change is dated and brand new, and most owners haven't heard about it. There's a 3-6 month window before every agency sells the same thing |
| What we sell | Your existing **Missed-Call Rescue**, repositioned as "stop paying Google for calls you lose": missed-call text-back in seconds, after-hours answering (AI or answering service), a proper call-routing menu, and a monthly missed-call report from their LSA dashboard |
| How we acquire | Pull **every LSA advertiser for a city + category** from the public listings. Apify LSA scrapers return name, phone, rating, reviews and badge for about $0.009 per business, so 5,000 advertisers cost ~$45. Find owner emails, verify, run `leads enrich`, then send `campaigns/lsa-missed-calls.toml`. Each lead on the list really runs LSA, so the first line is true for everyone |
| How we deliver | Twilio or GoHighLevel missed-call text-back (you already have the SOP), plus an AI receptionist at $0.05-0.30 a minute or a human answering service. Setup takes 2-4 hours per client, then it's monitoring |
| What makes it hard | AI receptionist software sells direct for $30-400 a month, so sell the outcome (calls recovered, charges avoided) and not the software. Google may tweak the rule or be generous with credits. Owners may just put in a phone menu themselves. **Never test-call a prospect's LSA number**: it can bill them. Use their website number |
| Evidence | The change is reported by Search Engine Land, Search Engine Roundtable, PPC Land and many agencies. Home services miss ~27% of calls (vendor figure); ~35-40% of calls come after hours; ~80% of callers who reach voicemail don't leave a message (vendor figures) |

**Rough numbers for one prospect (assumptions, check against their dashboard):** 80 LSA calls a month ×
25% missed = 20 missed calls. If half are billable at $55, that's **$550 a month paid to Google for lost
leads**, plus the lost jobs (a plumbing or HVAC job is worth $275-1,200). A $297-497 a month fix pays for
itself if it catches 2-3 jobs.

**Built for this:** `campaigns/lsa-missed-calls.toml` (4-step sequence), and `leads enrich` now detects the
Google Guaranteed / Google Screened badge on websites and writes a matching opening line.

Sources: [Search Engine Land](https://searchengineland.com/google-local-services-ads-will-charge-for-some-missed-calls-starting-oct-1-485798) ·
[Search Engine Roundtable](https://www.seroundtable.com/google-lsa-missed-subsequent-calls-41940.html) ·
[PPC Land](https://ppc.land/google-charges-local-services-advertisers-for-missed-calls-over-20-seconds/) ·
[LSA to Google Ads migration](https://searchengineland.com/local-services-ads-come-to-google-ads-via-performance-max-482692) ·
[LSA cost per lead by trade](https://thevalleymarketinggroup.com/blog/google-local-service-ads-cost-per-lead-2026/) ·
[LSA scraper (Apify)](https://apify.com/searchapi/google-local-services-ads-scraper) ·
[Missed-call statistics](https://www.hicira.com/missed-call-statistics)

---

## 2. Showing up in AI answers for local businesses

| Question | Answer |
|---|---|
| Who pays? | Local businesses where customers ask "who's the best ___ near me": trades, dentists, med spas, lawyers, restaurants. Best fit: ones already ranking in Google's top 3 map results that want to protect it |
| Problem | **45% of consumers now use AI tools to find local businesses** (up from 6% a year earlier), but ChatGPT recommends only **1.2% of local business locations**, compared with 11% for Gemini, 7.4% for Perplexity and 35.9% showing in Google's top 3 map results. Only 45% of brands that do well on Google also show in AI answers. When Google shows an AI Overview, clicks to regular results roughly halve (8% vs 15%) |
| Why now | ChatGPT has licensed Yelp's reviews, photos and data (July 2026). Google AI Mode is growing. Most local agencies still sell only classic SEO |
| What we sell | An **AI Visibility Check** (free or $297): ask the same 10 buying questions in ChatGPT, Gemini, Perplexity and Google AI Mode, and show who gets named. Then a **$397-797 a month fix**: fix listing data everywhere (Google, Yelp, Bing, Apple, BBB, industry sites), a reviews program (ChatGPT-recommended locations average 4.3 stars), a Yelp profile, service and FAQ pages written the way AI answers questions, and structured data. Re-check the same questions monthly |
| How we acquire | The "I asked ChatGPT for the best roofer in {city}; you weren't named" opening line (already in your tests list). Check each one by hand. It also works as an add-on for Missed-Call Rescue clients |
| How we deliver | Mostly checklist work: listing management (BrightLocal/Whitespark about $30-60 a month), review requests through your existing text-back setup, templated page content. Tracking can be a spreadsheet of fixed questions checked monthly |
| What makes it hard | AI answers change from run to run, and you can't guarantee a mention, so sell the process and measured share, not rankings. The SOCi data is from multi-location brands, not single-location shops. Most statistics come from vendors. Plenty of agencies are starting to sell "GEO" |
| Evidence | BrightLocal 2026 consumer survey (45%), SOCi 2026 Local Visibility Index (350,000 locations), the Yelp-OpenAI deal, Pew (AI Overview clicks). Market pricing: $300-1,500 a month for small-business AI visibility work |

Sources: [BrightLocal survey coverage](https://www.billhartzer.com/local-search/ai-local-business-recommendations-45-percent/) ·
[SOCi LVI](https://soci.ai/insights/lvi/) · [SOCi ranking factors](https://www.soci.ai/blog/how-to-rank-in-chatgpt-perplexity-and-google-ai-overview/) ·
[Yelp in ChatGPT (Search Engine Land)](https://searchengineland.com/openai-yelp-deal-483326) ·
[AI Overviews CTR](https://almcorp.com/blog/google-ai-overviews-organic-ctr-2026/) ·
[GEO pricing](https://thedigitalelevator.com/blog/aeo-and-geo-pricing-guide/)

---

## 3. Website accessibility deadlines: refer, don't build (yet)

| Question | Answer |
|---|---|
| Who pays? | Healthcare providers that receive HHS funding, such as Medicaid (clinics, dentists, therapists): WCAG 2.1 AA by **May 11, 2027** with 15+ staff, **May 10, 2028** under 15. US cities, counties and school districts: **April 26, 2027** (population 50k+) or **2028**. Online stores: ~4,900 ADA website lawsuits in 2025, ~70% against e-commerce. The EU Accessibility Act has applied since June 2025, and a French court ordered Carrefour to fix its site (June 2026) |
| Problem | Legal risk plus a fixed deadline. The cheap "overlay" widgets don't work: the FTC fined accessiBe $1M, and 28% of lawsuits hit sites that use overlays |
| Why now | Both federal deadlines were just pushed back a year, which gives buyers a runway to budget in 2027 |
| What we sell | For now, an add-on: "accessible rebuild" for websites you already make, plus a referral fee from a specialist auditing firm |
| What makes it hard | Real compliance needs real expertise (manual audits, screen reader testing) and carries liability if you promise "compliant". Government buyers need procurement processes. Fear-based selling to small shops is legally sensitive |
| Evidence | Federal Register interim final rules (DOJ April 20, 2026; HHS May 11, 2026), the UsableNet lawsuit tracker, the FTC order |

Verdict: real, dated demand, but a poor fit for a cold-email agency without accessibility expertise.
Revisit in early 2027 or partner with a specialist.

Sources: [DOJ extension (Federal Register)](https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web) ·
[HHS extension (Federal Register)](https://www.federalregister.gov/documents/2026/05/11/2026-09266/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web) ·
[2025 lawsuit numbers](https://abc17news.com/stacker-money/2026/01/14/accessibility-lawsuits-rose-by-37-in-2025-why-small-businesses-can-no-longer-ignore-their-websites/) ·
[FTC accessiBe order](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million) ·
[EAA enforcement](https://www.deque.com/blog/early-signs-of-eaa-enforcement-across-europe/)

---

## Looked at and rejected (for now)

| Idea | Why not |
|---|---|
| Managing ChatGPT ads for clients | Self-serve since May 2026 ($25 a day minimum, CPC about $3-5), but results for small businesses are mixed (one $500 test got zero verifiable results). Test it with one willing client, don't build an offer on it |
| Ad creative production for Meta | Demand is real (Meta now rewards many different ad concepts), but it's crowded: UGC video packages sell for $2-10k a month and it needs a creative team |
| Selling to brand-new businesses | ~530,000 US business applications a month, but most never hire staff and have little budget. Poor lead quality for the cost |
| Reselling AI receptionist software | Prices are falling fast ($30-400 a month direct). It only works bundled inside an outcome offer (#1) |

## Next 30 days

1. **This week:** pull LSA advertisers for 2-3 trades in 5-10 cities (Apify, about $50). Find and verify owner
   emails, then `leads enrich --niche local`. Send `lsa-missed-calls` from **October 1**.
2. **Week 2:** run 10 AI Visibility Checks by hand on replies and existing prospects. Use them as a
   free extra in sales calls, and track which prospects care.
3. **Week 4:** compare reply and booked-call rates between the LSA campaign and `local-services`.
   Put the budget behind whichever wins.
