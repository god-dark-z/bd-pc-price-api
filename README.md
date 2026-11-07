# BD PC Price Scraper — Tier-1 Retailers (Netlify-ready)

Scraper + API for the Bangladesh PC-component price comparison site.
Covers the 10 Tier-1 retailers: **Star Tech, Ryans, Techland, PCB Store,
Ultra Technology, PC House BD, Sell Tech BD, Speed Tech, Index IT, Onix BD.**

No server. No GitHub Actions (the user's GitHub accounts cannot run them).
Everything runs on **Netlify**: Scheduled Function → Background Functions →
Netlify Blobs → API Functions. Full API contract for the frontend AI:
**[API_DOCUMENTATION.md](API_DOCUMENTATION.md)**.

```
Retailer sites ──sitemap-first──▶ Background scrape (15 min, 1 retailer/run)
                                        │  atomic replace in Blobs
                                        ▼
                              Netlify Blobs store "products"
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
          API function (/api/search …)            Live check (1 product)
          reads STORED data only,                 /.netlify/functions/scrape-live
          never scrapes live                      ADMIN ONLY — the website
                                                  must NEVER call it
```

## Daily refresh — the confirmed architecture

**One fixed time, once a day: 18:00 UTC = 00:00 midnight Dhaka.**
Change the hour in exactly one place — `netlify.toml`:

```toml
[functions."scrape-scheduled"]
  schedule = "0 18 * * *"   # 18:00 UTC = 00:00 Dhaka (UTC+6, no DST)
```

(Dhaka hour = UTC hour + 6, so e.g. 02:00 Dhaka would be `"0 20 * * *"`.)

What happens at that time:

1. **Scheduled function** (`netlify/functions/scrape-scheduled.mjs`, 30 s
   limit) fires once and triggers **one background job per retailer**
   (all 10). It scrapes nothing itself.
2. **Background function** (`scrape-background-background.mjs`, 15 min
   limit) scrapes ONE retailer, validates every product, applies the
   price guards (see below), then publishes.
3. **Atomic replace + keep-yesterday-on-failure** (`src/lib/store.js`):
   the new payload is written to `<retailer>.pending.json`, read back
   and re-validated, and only then swapped into the live
   `<retailer>.json`. If the scrape throws, returns 0 publishable
   products, or fails validation, the live data is **never touched** —
   yesterday's data stays in place, the failure is logged, and
   `GET /api/status` reports that retailer as `"failed"`. A half-written
   or empty dataset can never reach the API.
4. **Freshness is visible**: `GET /api/status` returns `last_refresh`,
   per-retailer status, product counts and failures. The API always
   reports how old its data is; the frontend must show `last_updated`
   to users.

The API serves **only stored scraped data — never a live per-request
scrape**. There is no live-scrape path in `api.mjs`. The only live fetch
in the project is `scrape-live.mjs`, a separate manual admin function
for spot-checking one product while debugging; it requires
`SCRAPE_SECRET` and the website must not call it.

## How it works

1. **Discovery is sitemap-first.** Every retailer has a `sitemap.xml` (or
   product sitemaps). Category `?page=N` is the fallback. Never crawls with
   `sort` / `limit` / search params — those are robots-disallowed.
2. **Price parsing is multi-source and suspicious by design** (the bugs that
   broke the first version are encoded as rules in `src/lib/price.js`):
   - Listing cards show the **offer price first, regular price second**.
   - JSON-LD `Product.offers` / Open Graph `product:price:amount` is the
     most reliable machine source — **but** on Star Tech and PC House it is
     the **regular** price, not the offer price. The visible offer price
     wins and disagreements are logged in `conflicts[]`, never silently picked.
   - The site's **"Save:" field is never trusted** (Techland's is wrong on
     some cards: 39,000 − 36,300 = 2,700, card said "Save: 1,000").
     Savings are always computed from the two prices.
   - **Price 0 / 0৳ = no price / out of stock / call-for-price**, never a ৳0 deal.
   - Savings **above 80% are rejected** (the ৳800-shown-as-৳1,00,000 / −94% bug).
     The suspect regular price is dropped, the conflict is logged, and a
     payload carrying a >80% saving is rejected at publish time.
3. **Price guards** (`src/lib/price.js`, `src/lib/normalize.js`, `src/lib/store.js`):
   - **Out-of-stock rule:** an out-of-stock product's price is stored as
     `last_seen_price` with the flag `out_of_stock_price_unreliable`, and
     `price` is null — so it can NEVER appear as the cheapest/lowest price.
   - **Absurd-price guard:** any price above **1,000,000 BDT** for a
     component that is not a full-PC / GPU-flagship class (RTX 4090/5090,
     RX 7900 XTX, Threadripper, gaming PC, workstation…) is flagged
     (`price_flagged: true`) and excluded from lowest/highest until verified.
   - **Cross-retailer outlier check:** a price more than **10×** the median
     price of the same `model_key` at other retailers in the same scrape is
     flagged the same way. Flagged prices are logged, never silently trusted.
   - **Day-over-day jump flag:** when new data replaces old data, a price
     move of more than **50%** up or down versus yesterday's stored price is
     flagged in `conflicts[]` (`day_over_day_flagged: true`) — never silently
     accepted. The flag travels with the product into the API output.
   - **Lowest/highest** are computed from eligible prices only: in-stock,
     non-null, unflagged (`eligibleForLowest` / `computeLowestHighest`).
4. **Gallery images.** Every adapter returns `images[]` — ALL gallery
   images the product page exposes, deduplicated, absolute URLs
   (`src/lib/jsonld.js` `extractGalleryImages`): OG image, JSON-LD
   `Product.image` (array), OpenCart thumbnail-gallery links/`<img>`s,
   and for PCB Store (Next.js) the `/_next/image?url=…` optimiser URLs
   (decoded to the real image) and `/img/w…/q…/` proxy URLs. Logos,
   banners and icons are filtered out. When a page exposes no image,
   `image` is null, `images` is `[]` and `image_missing: true` — a URL
   is never invented.
5. **No CSS class selectors anywhere.** No selector was verified in the
   research (text fetches strip HTML), so adapters parse JSON-LD first,
   then OG meta, then generic price regexes, and spec tables by heading
   text ("Specification"). A site redesign that renames a class cannot
   break the price extraction.
6. **Polite crawling.** Browser UA, per-retailer delay, retries on 429/5xx.
   Ultra Technology declares `Crawl-Delay: 20` in robots.txt — 20 seconds
   between requests, respected in its config. Cloudflare challenge pages
   are detected and reported as blocked, never parsed as products.

## Normalised product schema

Every product returned by every adapter (full field table:
[API_DOCUMENTATION.md](API_DOCUMENTATION.md)):

```json
{
  "retailer": "Star Tech", "retailer_id": "startech",
  "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
  "model_key": "amd ryzen 7 5700g", "brand": "AMD", "category": null,
  "url": "https://www.startech.com.bd/amd-ryzen-7-5700g-processor",
  "image": "https://…/ryzen-7-5700g-processor-500x500.jpg",
  "images": ["https://…/ryzen-7-5700g-processor-500x500.jpg"],
  "image_missing": false,
  "price": 20600, "regular_price": 22500, "savings_pct": 8.4,
  "last_seen_price": null, "price_flagged": false,
  "stock": "in_stock",
  "description": "…",
  "specifications": { "Basic Information": { "Cores": "8" } },
  "specs": { "Basic Information": { "Cores": "8" } },
  "last_checked": "2026-11-07T…", "price_sources": ["visible:latest-price-sentence", "structured:opengraph"],
  "conflicts": []
}
```

`price` is always the **offer/selling price**. `savings_pct` is computed.
`specs` is a legacy alias of `specifications` (identical content).
`conflicts[]` lists every price disagreement found (e.g. Techland 5700G:
JSON-LD 20,600 vs page text 22,500; PC House 5700G: listing 21,900 vs OG 25,500).
A product is publishable only if it has name + URL + (a price OR an
explicit out-of-stock status) — an in-stock product with no price is a
call-for-price item and is not published.

## Project layout

```
package.json                  cheerio, @netlify/blobs; Node >= 20
netlify.toml                  functions = "netlify/functions"
                              + [functions."scrape-scheduled"] schedule = "0 18 * * *"
API_DOCUMENTATION.md          full API contract for the frontend (Mistral)
README.md                     this file
src/lib/
  price.js                    BDT parsing, savings, reconcilePrices, >80% guard,
                              absurd-price guard, 10x outlier check, lowest/highest
  normalize.js                product schema, model_key, publishable check,
                              out-of-stock rule, images[] handling
  http.js                     polite fetch, retries, challenge detection, sitemap parsing
  jsonld.js                   JSON-LD + OG extraction, gallery images, spec table, description
  store.js                    atomic publish, keep-yesterday-on-failure,
                              day-over-day jump flags, status blob
src/scrapers/
  opencart.js                 generic OpenCart adapter (sitemap-first + parseProduct + gallery)
  startech.js ryans.js techland.js pcbstore.js ultra.js
  pchouse.js selltech.js speedtech.js indexit.js onix.js
                              (each adapter's parseProduct is gallery-aware;
                               pcbstore additionally merges Next.js gallery images)
  index.js                    registry (10 retailers, scrape order)
scripts/run-scrape.mjs        CLI: --retailer <id|all> --limit N --dry-run
                              (same guards as the background function; writes
                               data/<retailer>.json + data/index.json + data/status.json)
netlify/functions/
  api.mjs                     GET /api/search /api/product /api/retailers /api/stats /api/status
                              (stored data only — NEVER a live scrape)
  scrape-scheduled.mjs        fires 18:00 UTC daily — triggers 1 background job per retailer
  scrape-background-background.mjs   background (15 min) — scrapes 1 retailer -> Blobs (atomic)
  scrape-live.mjs             ADMIN ONLY single-product live check — the website must NOT call it
data/sample-5700g.json        aggregated 5700G sample (verified prices only)
tests/                        offline fixture tests (no network)
  scraper.test.mjs            price parsing, normalisation, fixtures, registry
  price-guards.test.mjs       gallery, out-of-stock, >80%, 10x outlier, >50% jump, atomic replace
```

## Deploy on Netlify

### Option A — drag & drop (fastest)
1. Zip this folder and drop it on [app.netlify.com/drop](https://app.netlify.com/drop),
   or push it to any Git repo and connect it in Netlify (no build command needed).
2. In **Site settings → Environment variables** set:
   - `SCRAPE_SECRET` — any long random string (protects the scrape trigger
     and the admin live-check function).
   - `SCRAPE_LIMIT` — optional, products per background run (default 200).
3. Deploy. The scheduled function only runs on the **published** deploy.
   The first refresh happens at the next 18:00 UTC; before that, the API
   serves the bundled `data/sample-5700g.json`-era fallback (see below).

### Option B — Netlify CLI
```bash
npm install
netlify link        # or: netlify sites:create
netlify env:set SCRAPE_SECRET "a-long-random-string"
netlify deploy --prod
```

### API (after deploy)
```
GET https://<your-site>.netlify.app/api/search?q=Ryzen%207%205700G
GET https://<your-site>.netlify.app/api/search?q=Ryzen%207%205700G&retailer=startech&in_stock=true&sort=lowest&limit=20&page=1
GET https://<your-site>.netlify.app/api/product?url=https://www.startech.com.bd/amd-ryzen-7-5700g-processor
GET https://<your-site>.netlify.app/api/retailers
GET https://<your-site>.netlify.app/api/stats
GET https://<your-site>.netlify.app/api/status
```
Full contract, example responses and frontend wiring code:
**[API_DOCUMENTATION.md](API_DOCUMENTATION.md)**.

### Manual scrape trigger (for testing)
```bash
curl -X POST https://<your-site>.netlify.app/.netlify/functions/scrape-background-background \
  -H "x-scrape-secret: <redacted>" \
  -d '{"retailer":"startech"}'
# Returns 202 immediately; the scrape continues in the background (up to 15 min).
# Check results: GET /api/status  (per-retailer status, counts, failures)
```

### Manual admin live check (debugging only — NOT for the website)
```bash
curl "https://<your-site>.netlify.app/.netlify/functions/scrape-live?retailer=startech&url=https://www.startech.com.bd/amd-ryzen-7-5700g-processor" \
  -H "x-scrape-secret: <redacted>"
```

## How the refresh works (and its limits)

| Piece | Limit |
|---|---|
| Scheduled function | **30 s** — triggers only, never scrapes; fires once a day at 18:00 UTC |
| Background function | **15 min** — scrapes ONE retailer per invocation |
| Sync API function | **60 s** — reads Blobs, never scrapes |
| Blobs | key-value JSON store, no provisioning needed |

All 10 retailers refresh every day at 18:00 UTC (10 background jobs, one
per retailer). Ultra Technology is the slowest retailer by design (20 s
crawl delay) — a full Ultra crawl spans several background invocations;
the queue advances instead of timing out. If a retailer's scrape fails on
a given day, yesterday's data for that retailer stays live and
`GET /api/status` says so — the site never goes empty because of one bad day.

### cron-job.org fallback (no GitHub, no Netlify schedule)
If the Netlify schedule ever misbehaves, create a free job at
[cron-job.org](https://cron-job.org) that POSTs once a day (00:00 Dhaka)
to `https://<your-site>.netlify.app/.netlify/functions/scrape-background-background`
with header `x-scrape-secret: <redacted>` and body `{"retailer":"startech"}`
— one job per retailer, or one job that rotates the retailer in the body.
cron-job.org is free, fires down to once a minute, and needs nothing installed.

## Local use

```bash
npm install
npm test                          # offline fixture tests, no network
node scripts/run-scrape.mjs --retailer startech --dry-run --limit 3
node scripts/run-scrape.mjs --retailer startech --limit 20   # live, polite
```

## Adding a retailer
1. Copy `src/scrapers/startech.js`, fill in `baseUrl`, `sitemapUrls`,
   `categoryUrls`, `crawlDelayMs`, and the `isProductUrl` filter.
2. Add it to `src/scrapers/index.js`.
3. Set `ogIsRegularPrice: true` if its OG/JSON-LD price turns out to be the
   regular price (test with a discounted product first).
4. If it shows Cloudflare challenges, set `degraded: true` and
   `browserRequired: true` — and say so in the adapter notes.

## HONEST LIMITS — read before trusting output

- **No CSS selector was verified for any site.** Adapters use structured
  data + generic parsing, but a live run on Netlify is still required
  before trusting counts/prices. Run Star Tech first (easiest), compare
  20 products against the live site, then expand.
- **Sitemap URLs include category/guide pages.** Star Tech's sitemap lists
  the homepage and category pages (e.g. /lifestyle,
  /blood-pressure-monitor) alongside products. The parser drops any page
  without structured product evidence (JSON-LD Product offers,
  og:type=product, or og product price) — it is logged as `[drop]` and
  counted, never published.
- **images[] is scoped to the product itself** (og/JSON-LD images, the
  product gallery container, or the primary image's folder). Related-
  products thumbnails are excluded — verified live on the 5700G page.
- **Degraded retailers (expect partial results with plain fetch):**
  - **Sell Tech** — intermittent Cloudflare challenge (highest risk).
  - **Ryans** — Cloudflare + likely JS-rendered listing prices; sitemap
    and pagination unverified. Product pages parse, listings may not.
  - **PCB Store** — likely Cloudflare; real listing-grid URL unverified
    (sitemap-only discovery); specs are in prose, not a table.
- **Known price conflicts in the research** (the reconciler logs them,
  it does not resolve them): Techland 5700G (JSON-LD 20,600 vs text
  22,500); PC House 5700G (listing 21,900 vs OG 25,500).
- Prices change daily; every product carries `last_checked`. Never show a
  price without its date. Data refreshes once a day at 18:00 UTC — the
  API is a daily snapshot, not a live price feed.
- Scraping public prices for comparison, with attribution and a link back
  to the retailer, is the standard price-comparison pattern — but respect
  robots.txt, keep the crawl polite, and stop if a retailer asks you to.
