# BD PC Price API — API Documentation

> **For: Mistral Large 4K (and any frontend developer wiring up the site).**
> This document is the complete, self-contained contract for the price API.
> Everything in it is implemented in `netlify/functions/api.mjs` — if a
> parameter or endpoint is documented here, the code supports it.
>
> **One rule above all others: this API serves STORED data, refreshed once
> a day. It never scrapes live.** Prices are at most one refresh old.
> Never call the API expecting live prices, and never trust a price
> without checking `stock`.

## 0. Quick facts

| Item | Value |
|---|---|
| Data source | Netlify Blobs store `products`, written once a day by the scraper (see §7) |
| Refresh time | **Daily — currently 00:20 Dhaka (18:20 UTC), test time.** Standing schedule: 00:00 midnight Dhaka (18:00 UTC). Bangladesh is UTC+6, no DST. |
| Refresh trigger | `netlify.toml` → `[functions."scrape-scheduled"] schedule = "20 18 * * *"` |
| Response format | JSON only, `Content-Type: application/json` |
| Auth | None for the public API. (The admin live-check function needs `SCRAPE_SECRET` — do not use it.) |
| Caching | Responses carry `Cache-Control: public, max-age=300` (5 minutes) |
| Currency | All prices are **Bangladeshi Taka (BDT, ৳)**, integer taka, no decimals |
| Retailers | 27 retailers across 4 tiers (see `GET /api/retailers`) |

## 1. Base URL

After deploying this project on Netlify, replace `YOUR-SITE` with your
real site name:

```
https://YOUR-SITE.netlify.app
```

Example (placeholder — fill in your own after deploy):

```
https://bd-pc-prices.netlify.app
```

All endpoints below are relative to that base URL. There is no API key
and no `/v1` prefix.

## 2. Endpoints at a glance

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/search` | Search products across retailers, with filters, sorting and pagination |
| GET | `/api/product` | One product, by its exact retailer product-page URL |
| GET | `/api/retailers` | All 27 retailers, with product counts and last scrape time |
| GET | `/api/stats` | Totals: products per retailer, in-stock / out-of-stock / flagged counts |
| GET | `/api/status` | **Data freshness**: `last_refresh`, per-retailer status, counts, failures |

There are no POST/PUT/DELETE endpoints. There is no live-price endpoint
in the public API — by design.

## 3. Product JSON schema

Every product object in every response has exactly these fields.
`null` always means "the retailer page did not expose this value" —
never guess a replacement, never display a fallback price.

| Field | Type | Required | Meaning / what `null` means |
|---|---|---|---|
| `retailer` | string | yes | Retailer display name, e.g. `"Star Tech"` |
| `retailer_id` | string | yes | Retailer slug: `startech`, `ryans`, `techland`, `pcbstore`, `ultra`, `pchouse`, `selltech`, `speedtech`, `indexit`, `onix` |
| `name` | string | yes | Product name exactly as the retailer lists it |
| `model_key` | string | yes | Normalised grouping key, e.g. `"amd ryzen 7 5700g"` — use this to group the same chip across retailers, never the name alone (boxed vs tray SKUs differ) |
| `brand` | string \| null | yes (nullable) | e.g. `"AMD"`; `null` when it cannot be determined |
| `category` | string \| null | yes (nullable) | Category guessed from the URL path; `null` when unknown |
| `url` | string | yes | **The retailer's own product-page URL — this is the "View" link.** Always link here, never to a search page |
| `image` | string \| null | yes (nullable) | Primary image URL (first entry of `images[]`); `null` when the page exposed no image |
| `images` | string[] | yes | **ALL gallery images** the product page exposed, deduplicated, absolute URLs. Empty array `[]` when the page exposed none |
| `image_missing` | boolean | yes | `true` when the page exposed no image at all (`image` is `null` and `images` is `[]`) — show a placeholder, do not invent a URL |
| `price` | integer \| null | yes (nullable) | **Current / offer / selling price in BDT.** `null` means no buyable price (out of stock, call-for-price, or price not found). Never display `null` as ৳0 |
| `regular_price` | integer \| null | yes (nullable) | Crossed-out original price in BDT. `null` means the retailer showed no discount / no regular price |
| `last_seen_price` | integer \| null | yes (nullable) | **Out-of-stock only:** the last price seen while the product was in stock. `null` for in-stock products. Never use this as a buyable price |
| `price_flagged` | boolean | yes | `true` when a price guard flagged this price (absurd price > 1,000,000 BDT, or >10× the peer median for the same `model_key`). Flagged prices are excluded from `lowest_price`/`highest_price` until verified — display them with a warning, never as the "lowest price" |
| `savings_pct` | number | yes | Discount %, computed as `(regular_price − price) / regular_price × 100`, rounded to 1 decimal. `0` when there is no discount. **Never computed from the site's "Save:" field** |
| `stock` | string | yes | `"in_stock"` \| `"out_of_stock"` \| `"unknown"` |
| `description` | string \| null | yes (nullable) | Full prose description; `null` when the page had none |
| `specifications` | object | yes | Grouped key-value specs, e.g. `{"Basic Information": {"Cores": "8"}}`. `{}` when the page had no spec table |
| `specs` | object | yes | Legacy alias of `specifications` — identical content, kept for backwards compatibility. Prefer `specifications` in new code |
| `last_checked` | string (ISO 8601) | yes | When this product was last scraped, e.g. `"2026-11-07T17:30:00Z"`. **Always show this date next to the price** |
| `price_sources` | string[] | yes | Which sources the price came from, e.g. `["visible:latest-price-sentence", "structured:opengraph"]`. Empty when no price was found |
| `conflicts` | string[] | yes | Every price disagreement / flag found for this product (JSON-LD vs visible price, >80% discount rejected, day-over-day jump, outlier flag, out-of-stock price note). Empty `[]` means no conflict was found. **Show these to the user when non-empty — do not hide them** |
| `day_over_day_flagged` | boolean | no (only when flagged) | Present and `true` when the price moved more than 50% up or down versus yesterday's stored price |

### 3.1 Example product (real data — AMD Ryzen 7 5700G at Star Tech)

From `data/sample-5700g.json` (verified 2026-11-07 research):

```json
{
  "brand": "AMD",
  "category": null,
  "conflicts": [],
  "description": "AMD Ryzen 7 5700G Processor with Radeon Graphics — 8 cores, 16 threads, Zen 3, Radeon Graphics.",
  "image": "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg",
  "images": [
    "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg"
  ],
  "image_missing": false,
  "last_checked": "2026-11-07T17:30:00Z",
  "last_seen_price": null,
  "model_key": "amd ryzen 7 5700g",
  "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
  "price": 20600,
  "price_flagged": false,
  "price_sources": ["visible:latest-price-sentence", "structured:opengraph"],
  "regular_price": 22500,
  "retailer": "Star Tech",
  "retailer_id": "startech",
  "savings_pct": 8.4,
  "specifications": {
    "Basic Information": { "Cores": "8", "Threads": "16" },
    "Warranty Information": { "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)" }
  },
  "specs": {
    "Basic Information": { "Cores": "8", "Threads": "16" },
    "Warranty Information": { "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)" }
  },
  "stock": "in_stock",
  "url": "https://www.startech.com.bd/amd-ryzen-7-5700g-processor"
}
```

### 3.2 Example product with a conflict and no image (real data — PC House)

```json
{
  "brand": "AMD",
  "category": null,
  "conflicts": [
    "listing price table 21,900 vs detail-page OG price 25,500 — the listing (offer) price is used; re-check live"
  ],
  "description": null,
  "image": null,
  "images": [],
  "image_missing": true,
  "last_checked": "2026-11-07T17:30:00Z",
  "last_seen_price": null,
  "model_key": "amd ryzen 7 5700g",
  "name": "AMD Ryzen 7 5700G Processor With Radeon Graphics",
  "price": 21900,
  "price_flagged": false,
  "price_sources": ["visible:price-label"],
  "regular_price": 25500,
  "retailer": "PC House BD",
  "retailer_id": "pchouse",
  "savings_pct": 14.1,
  "specifications": {},
  "specs": {},
  "stock": "in_stock",
  "url": "https://www.pchouse.com.bd/amd-ryzen-7-5700g-processor"
}
```

Note: `image` is `null` and `images` is `[]` here because no 5700G
image URL was verified for PC House in the research — the API reports
that honestly instead of inventing one.

## 4. Endpoint reference

### 4.1 `GET /api/search`

Search products across all retailers (or one retailer), with filters,
sorting and pagination.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | Search query. Every space-separated word must appear in the name, `model_key` or brand (case-insensitive). Example: `Ryzen 7 5700G` |
| `retailer` | string | all retailers | Filter to one retailer id, e.g. `startech`, `ryans`, `techland`, `pcbstore`, `ultra`, `pchouse`, `selltech`, `speedtech`, `indexit`, `onix` |
| `category` | string | all categories | Substring match on the product's `category` field (case-insensitive) |
| `in_stock` | `true` \| `false` | `false` | `in_stock=true` returns only products with `stock == "in_stock"` |
| `sort` | `lowest` \| `highest` | `lowest` | `lowest` = cheapest buyable price first; `highest` = most expensive first. Products with no buyable price sort last either way |
| `limit` | integer 1–100 | `50` | Results per page. Values above 100 are clamped to 100 |
| `page` | integer ≥ 1 | `1` | Page number (1-based) |

**Example request**

```
GET https://YOUR-SITE.netlify.app/api/search?q=Ryzen%207%205700G&sort=lowest&limit=20&page=1
```

**Example response (200)** — real 5700G sample data
(`data/sample-5700g.json`: Star Tech 20,600/22,500; Ryans 21,900;
Techland 20,600 with conflict; PCB Store 23,400; Speed Tech 20,000;
PC House 21,900/25,500 with conflict):

```json
{
  "query": "Ryzen 7 5700G",
  "count": 6,
  "page": 1,
  "limit": 20,
  "total_pages": 1,
  "sort": "lowest",
  "retailer": null,
  "category": null,
  "in_stock_only": false,
  "lowest_price": 20000,
  "highest_price": 23400,
  "savings_pct": 14.6,
  "last_updated": "2026-11-07T17:30:00Z",
  "results": [
    {
      "retailer": "Speed Tech",
      "retailer_id": "speedtech",
      "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
      "model_key": "amd ryzen 7 5700g",
      "brand": "AMD",
      "category": null,
      "url": "https://www.speedtech.com.bd/amd-ryzen-7-5700g-processor",
      "image": "https://www.speedtech.com.bd/image/catalog/component/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor.jpg",
      "images": [
        "https://www.speedtech.com.bd/image/catalog/component/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor.jpg"
      ],
      "image_missing": false,
      "price": 20000,
      "regular_price": null,
      "last_seen_price": null,
      "price_flagged": false,
      "savings_pct": 0,
      "stock": "in_stock",
      "description": null,
      "specifications": {},
      "specs": {},
      "last_checked": "2026-11-07T17:30:00Z",
      "price_sources": ["structured:opengraph"],
      "conflicts": []
    },
    {
      "retailer": "Star Tech",
      "retailer_id": "startech",
      "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
      "model_key": "amd ryzen 7 5700g",
      "brand": "AMD",
      "category": null,
      "url": "https://www.startech.com.bd/amd-ryzen-7-5700g-processor",
      "image": "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg",
      "images": [
        "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg"
      ],
      "image_missing": false,
      "price": 20600,
      "regular_price": 22500,
      "last_seen_price": null,
      "price_flagged": false,
      "savings_pct": 8.4,
      "stock": "in_stock",
      "description": "AMD Ryzen 7 5700G Processor with Radeon Graphics — 8 cores, 16 threads, Zen 3, Radeon Graphics.",
      "specifications": {
        "Basic Information": { "Cores": "8", "Threads": "16" },
        "Warranty Information": { "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)" }
      },
      "specs": {
        "Basic Information": { "Cores": "8", "Threads": "16" },
        "Warranty Information": { "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)" }
      },
      "last_checked": "2026-11-07T17:30:00Z",
      "price_sources": ["visible:latest-price-sentence", "structured:opengraph"],
      "conflicts": []
    }
  ]
}
```

(The response above is truncated to the first two results for readability;
the full response contains all 6 retailers, sorted by price ascending:
Speed Tech 20,000; Star Tech 20,600; Techland 20,600; Ryans 21,900;
PC House 21,900; PCB Store 23,400.)

**How `lowest_price` / `highest_price` / `savings_pct` are computed**

- Only **eligible** prices count: `price` is not `null`, `stock` is
  `"in_stock"`, and `price_flagged` is `false`. Out-of-stock products
  (price stored as `last_seen_price`) and flagged prices never win
  lowest/highest.
- `savings_pct` on the search response = `(highest − lowest) / highest × 100`,
  rounded to 1 decimal. It is the spread across retailers, not a discount
  on one product — do not show it as "you save 14.6%" on a single listing;
  the per-product discount is each product's own `savings_pct`.

**Error responses**

Missing `q` (400):

```json
{ "error": "missing ?q= — e.g. /api/search?q=Ryzen%207%205700G" }
```

No matches is NOT an error — it returns `200` with `"count": 0`,
`"results": []`, `"lowest_price": null`, `"highest_price": null`.

### 4.2 `GET /api/product`

One product, by its exact retailer product-page URL.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `url` | string (URL-encoded) | **Required.** The exact product URL, e.g. `https://www.startech.com.bd/amd-ryzen-7-5700g-processor` |

**Example request**

```
GET https://YOUR-SITE.netlify.app/api/product?url=https%3A%2F%2Fwww.startech.com.bd%2Famd-ryzen-7-5700g-processor
```

**Example response (200)** — the full product object from §3.1.

**Error responses**

Missing `url` (400):

```json
{ "error": "missing ?url= — e.g. /api/product?url=https://www.startech.com.bd/amd-ryzen-7-5700g-processor" }
```

Product not in the current data (404) — it has not been scraped yet, or
the URL is mistyped:

```json
{
  "error": "product not found in current data — it may not have been scraped yet",
  "url": "https://www.example.com/no-such-product"
}
```

### 4.3 `GET /api/retailers`

All 27 retailers, with product counts and last scrape time. No parameters.

**Example request**

```
GET https://YOUR-SITE.netlify.app/api/retailers
```

**Example response (200)**

```json
{
  "retailers": [
    {
      "id": "startech",
      "name": "Star Tech",
      "base_url": "https://www.startech.com.bd",
      "degraded": false,
      "browser_required": false,
      "products": 1537,
      "last_scrape": "2026-11-07T18:00:00Z"
    },
    {
      "id": "ryans",
      "name": "Ryans Computers",
      "base_url": "https://www.ryans.com",
      "degraded": true,
      "browser_required": true,
      "products": 0,
      "last_scrape": null
    }
  ]
}
```

(`products` is the count in the currently stored data; `last_scrape` is
`null` when a retailer has never been scraped successfully. The response
above is truncated to two retailers; the real response lists all 10.
`degraded: true` means plain-fetch scraping is unreliable for that
retailer — expect partial data, not an error.)

### 4.4 `GET /api/stats`

Totals across all stored data. No parameters.

**Example request**

```
GET https://YOUR-SITE.netlify.app/api/stats
```

**Example response (200)**

```json
{
  "generated_at": "2026-11-07T18:05:00Z",
  "last_updated": "2026-11-07T18:00:00Z",
  "total_products": 18432,
  "in_stock_products": 16210,
  "out_of_stock_products": 1987,
  "flagged_products": 12,
  "per_retailer": [
    { "retailer_id": "startech", "products": 1537, "finished": "2026-11-07T18:00:00Z" },
    { "retailer_id": "ryans", "products": 0, "finished": null }
  ]
}
```

(`per_retailer` lists all 27 retailers; truncated here. `flagged_products`
counts products with `price_flagged: true`.)

### 4.5 `GET /api/status` — data freshness

Use this on every page load (or at least on the homepage) to tell users
how fresh the prices are. No parameters.

**Example request**

```
GET https://YOUR-SITE.netlify.app/api/status
```

**Example response (200)** — after a successful daily refresh:

```json
{
  "last_refresh": "2026-11-07T18:00:00Z",
  "last_attempt": "2026-11-07T18:00:00Z",
  "refresh_schedule": "0 18 * * *",
  "refresh_schedule_human": "daily at 18:00 UTC (= 00:00 Dhaka)",
  "total_products": 18432,
  "per_retailer": {
    "startech": {
      "status": "ok",
      "products": 1537,
      "last_scrape": "2026-11-07T18:00:00Z",
      "error": null
    },
    "ryans": {
      "status": "failed",
      "products": 1204,
      "last_scrape": "2026-11-06T18:00:00Z",
      "error": "scrape returned 0 publishable products (0 parsed, 3 blocked, 12 errors) — keeping yesterday's data"
    }
  },
  "failures": [
    {
      "retailer_id": "ryans",
      "error": "scrape returned 0 publishable products (0 parsed, 3 blocked, 12 errors) — keeping yesterday's data",
      "last_scrape": "2026-11-06T18:00:00Z"
    }
  ],
  "generated_at": "2026-11-07T18:05:00Z"
}
```

**Field meanings**

| Field | Meaning |
|---|---|
| `last_refresh` | ISO timestamp of the last **successful** refresh (any retailer). `null` before the first successful refresh |
| `last_attempt` | ISO timestamp of the last refresh attempt (including failed ones) |
| `refresh_schedule` | Cron expression from `netlify.toml` (`"20 18 * * *"`) |
| `refresh_schedule_human` | Human-readable schedule |
| `total_products` | Products across all retailers in the currently stored data |
| `per_retailer.<id>.status` | `"ok"` \| `"failed"` \| `"queued"` (queued = refresh started, retailer not finished yet) |
| `per_retailer.<id>.products` | Products stored for that retailer (yesterday's count when `status` is `"failed"`) |
| `per_retailer.<id>.last_scrape` | When that retailer was last scraped successfully |
| `per_retailer.<id>.error` | Failure reason, or `null` |
| `failures` | Flat list of the retailers whose last refresh failed (empty `[]` when all are fresh) |

Before the first scheduled refresh ever runs, `/api/status` still
answers: it derives freshness from the retailer files and adds a
`"note"` field saying no status blob exists yet.

### 4.6 Error responses (all endpoints)

| Status | When | Body |
|---|---|---|
| 400 | Missing required parameter (`q` on search, `url` on product) | `{ "error": "<what is missing and an example>" }` |
| 404 | Product URL not in the data, or unknown `/api/*` path | `{ "error": "<reason>" }` (product errors also include `"url"`) |
| 500 | Unexpected server error (blob read failure, etc.) | `{ "error": "internal error — please try again later" }` |

All error bodies are JSON with an `error` string. Never render a raw
error body to users — show a friendly message and, for 404 on a product,
offer the search page instead.

## 5. How the frontend should use it

### 5.1 Search flow (homepage / browse page)

1. User types a query (e.g. `Ryzen 7 5700G`).
2. Call `GET /api/search?q=<encoded query>&sort=lowest&limit=20&page=1`.
3. Render one card per result: `image` (fall back to a placeholder when
   `image_missing` is `true`), `name`, `retailer`, `price`, `regular_price`
   (crossed out when present), `savings_pct`, `stock` badge, and the
   **View** button linking to `url` (the retailer's own product page —
   open in a new tab).
4. Above the results show the summary the API already computed:
   `lowest_price`, `highest_price`, and `last_updated`
   ("Prices last updated 7 Nov 2026, 18:00 UTC").
5. Paginate with `page` + `limit`; `total_pages` tells you how many pages
   exist. Do not fetch all pages up front.

### 5.2 Product page flow (one model across retailers)

1. You already have a product URL (from a search result, or a shared link).
2. Call `GET /api/product?url=<encoded URL>` for the full object
   (description, `specifications`, `images[]` gallery).
3. To show **all retailers for the same model**, call
   `GET /api/search?q=<model_key or name>&sort=lowest` and group the
   results by `model_key` — the search response's `lowest_price` /
   `highest_price` already exclude out-of-stock and flagged prices.

### 5.3 Lowest / highest / savings display rules

These rules are enforced server-side, but the frontend must not undo them:

- **Lowest price** = the `lowest_price` from the search response.
  Never compute your own minimum from `results[].price` — that would
  include out-of-stock and flagged prices the API deliberately excluded.
- **Savings** = `(regular_price − price) / regular_price × 100` per
  product (the API's `savings_pct`). Never use a site's "Save:" field —
  the API never returns one.
- **Out-of-stock products:** show the stock badge clearly
  ("Out of stock"), show `last_seen_price` only labelled as
  "Last seen at ৳X" — never as the current price — and never list them
  under "lowest price".
- **Flagged prices** (`price_flagged: true`): show a warning
  ("Price flagged — please verify on the retailer's site") and never
  present them as the best deal. Check `conflicts[]` for the reason.
- **Conflicts:** when `conflicts` is non-empty, show a small note
  (e.g. "Price conflict — see details") with the conflict text. Do not
  hide it.
- **Always show `last_updated` / `last_checked`** next to any price.
  Prices are a daily snapshot, not live.

### 5.4 Caching guidance

- Data refreshes **once a day (currently 00:20 Dhaka test time; standing schedule 00:00 Dhaka)**. There is no
  benefit in polling more often than every few minutes, and no new data
  will appear between refreshes.
- The API sends `Cache-Control: public, max-age=300` — browsers and CDNs
  may cache a search response for 5 minutes. That is fine: the underlying
  data only changes daily.
- Frontend rule of thumb: cache search results in memory for the session,
  re-fetch on a new query or page change, and always re-fetch
  `/api/status` on page load so the freshness banner is current.
- **Show `last_updated` to users on every page that shows a price.**
  Example banner: "Prices updated 7 Nov 2026, 18:00 UTC — next update
  tonight at 18:00 UTC."

## 6. What NOT to do

- **Never call the API expecting live prices.** The API returns the last
  daily scrape. If a price looks wrong, check `conflicts[]` and
  `last_checked`, and link the user to the retailer's own page (`url`).
- **Never trust a price without checking `stock`.** A `price` of `null`
  means "no buyable price" — display "Price not available", never ৳0.
- **Never use `last_seen_price` as a price.** It is a historical note
  for out-of-stock products only.
- **Never compute lowest/highest yourself from raw `results`.** Use the
  response's `lowest_price` / `highest_price` (they exclude out-of-stock
  and flagged prices).
- **Never call `/.netlify/functions/scrape-live`.** That is a manual admin
  function for debugging one product; it fetches live from the retailer
  on every call and requires `SCRAPE_SECRET`. The website must use
  `/api/search` and `/api/product` only.
- **Never invent an image URL.** When `image` is `null` / `images` is
  `[]`, show a placeholder.
- **Never display a price without its date** (`last_checked` /
  `last_updated`).

## 7. How the data gets here (for context, not for the frontend to call)

1. Once a day at **18:00 UTC**, the Netlify scheduled function fires and
   triggers one background job per retailer (all 10).
2. Each background job scrapes its retailer (sitemap-first, polite crawl)
   and publishes the result **atomically**: new data is written to a
   pending blob, validated, then swapped into the live blob. If a
   retailer's scrape fails, **yesterday's data is kept** for that retailer
   and the failure is recorded in `/api/status`.
3. Price guards run before publishing: >80% savings rejected, out-of-stock
   prices moved to `last_seen_price`, absurd prices (>1,000,000 BDT for a
   non-flagship component) flagged, >10× cross-retailer outliers flagged,
   >50% day-over-day jumps flagged in `conflicts[]`.
4. The API reads only the stored blobs. Full details: `README.md`.

## 8. Wiring it into the existing site (for Mistral)

The existing site (homepage, browse/search pages, Google Studio AI build
assistant) currently gets its data from wherever it gets it today. Point
it at this API instead:

1. **Set one constant** — the deployed base URL (fill in after deploy):
   ```js
   const API_BASE = "https://YOUR-SITE.netlify.app";
   ```
2. **Search page** — replace the current search data call with:
   ```js
   async function searchProducts(query, { retailer, inStockOnly, sort = "lowest", limit = 20, page = 1 } = {}) {
     const params = new URLSearchParams({ q: query, sort, limit: String(limit), page: String(page) });
     if (retailer) params.set("retailer", retailer);
     if (inStockOnly) params.set("in_stock", "true");
     const res = await fetch(`${API_BASE}/api/search?${params}`);
     if (!res.ok) {
       const err = await res.json().catch(() => ({}));
       throw new Error(err.error || `Search failed (HTTP ${res.status})`);
     }
     return res.json(); // { query, count, page, total_pages, lowest_price, highest_price, savings_pct, last_updated, results[] }
   }

   // Example: render the summary + cards
   const data = await searchProducts("Ryzen 7 5700G");
   console.log(`Lowest ৳${data.lowest_price} — Highest ৳${data.highest_price} (updated ${data.last_updated})`);
   for (const p of data.results) {
     console.log(`${p.retailer}: ৳${p.price ?? "N/A"} [${p.stock}] -> ${p.url}`);
   }
   ```
3. **Product page** — replace the current product fetch with:
   ```js
   async function getProduct(productUrl) {
     const res = await fetch(`${API_BASE}/api/product?url=${encodeURIComponent(productUrl)}`);
     if (res.status === 404) return null; // not scraped yet — offer search instead
     if (!res.ok) throw new Error(`Product lookup failed (HTTP ${res.status})`);
     return res.json(); // full product object, §3
   }

   // Gallery: product.images[] (all gallery images); product.image is the primary.
   // "View" button: <a href={product.url} target="_blank" rel="noopener">View on {product.retailer}</a>
   ```
4. **Freshness banner (every page that shows prices)** — call once per load:
   ```js
   async function getStatus() {
     const res = await fetch(`${API_BASE}/api/status`);
     if (!res.ok) return null;
     return res.json(); // { last_refresh, per_retailer, failures[], ... }
   }

   const status = await getStatus();
   if (status?.last_refresh) {
     // e.g. "Prices last updated 7 Nov 2026, 18:00 UTC"
     showBanner(`Prices last updated ${new Date(status.last_refresh).toLocaleString()} — next update daily at 18:00 UTC`);
   }
   if (status?.failures?.length) {
     // e.g. "Ryans data is from yesterday — today's refresh failed"
     showWarning(`${status.failures.length} retailer(s) showing yesterday's data (refresh failed).`);
   }
   ```
5. **Retailer list / stats** (browse filters, homepage counters):
   ```js
   const { retailers } = await (await fetch(`${API_BASE}/api/retailers`)).json();
   const stats = await (await fetch(`${API_BASE}/api/stats`)).json();
   ```
6. **Do not change:** the retailer's own product URL is the View link
   (`product.url`). Do not link to a search page or rebuild the URL from
   the name — use the exact `url` the API returns.
7. **Do not call:** `/.netlify/functions/scrape-live` or
   `/.netlify/functions/scrape-background-background` from the frontend.
   Those are admin/scraper endpoints, not the public API.

## 9. Retailer ids

| id | Name | Base URL |
|---|---|---|
| `startech` | Star Tech | https://www.startech.com.bd |
| `ryans` | Ryans Computers | https://www.ryans.com |
| `techland` | Techland BD | https://www.techlandbd.com |
| `pcbstore` | PCB Store | https://pcbstore.com.bd |
| `ultra` | Ultra Technology | https://www.ultratech.com.bd |
| `pchouse` | PC House BD | https://www.pchouse.com.bd |
| `selltech` | Sell Tech BD | https://www.selltech.com.bd |
| `speedtech` | Speed Tech | https://www.speedtech.com.bd |
| `indexit` | Index IT | https://www.indexit.com.bd |
| `onix` | Onix BD | https://www.onixbd.com |

## 10. Version / changelog

- **2026-11-07 (v1.1)** — Daily-refresh architecture confirmed: one
  scheduled run at 18:00 UTC, one background job per retailer, atomic
  replace with keep-yesterday-on-failure, `GET /api/status`, gallery
  `images[]` on every product, out-of-stock / absurd-price / 10× outlier
  / >50% day-over-day guards, search filters (`retailer`, `category`,
  `in_stock`), sorting (`lowest`/`highest`), pagination (`limit`, `page`).
  `scrape-live` is admin-only and secret-gated.
- **2026-11-08 (v1.1)** — 27 retailers (Tier 1-4), seed data as a JS module
  (`src/lib/seed-data.js`) + `included_files`, discovery diagnostics, 60 s
  sitemap timeout, premium README with banner. Project name confirmed:
  **BD PC Price API**.
- **2026-11-07 (v1.0)** — Initial Netlify-ready scraper + API (search,
  product, retailers, stats) for the 10 Tier-1 retailers.
