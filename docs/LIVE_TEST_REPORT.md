# BD PC Price Scraper — Live Test Report

Updated: 2026-11-08 (quality loop: Phase 1–4). Method: every retailer live-tested
from this VM with the project's own code (`scripts/run-scrape.mjs` / adapter
`scrapeRetailer`), prices spot-checked against the retailer's own live product
page via `browser.open`. Full detail per phase: `live-test/phase1-report.md`,
`live-test/phase2-report.md`, `live-test/phase3-report.md`,
`live-test/phase4-report.md`.

Status legend: ✅ GREEN = live products scraped + at least one price verified
against the live site. ⚠️ BLOCKED = plain Node fetch is blocked (Cloudflare
TLS fingerprint); parser verified offline + price verified via browser.open,
adapter marked `degraded + browserRequired`, needs a browser-grade fetch or a
different egress (Netlify run) to prove live.

## Tier 1 (10)

| Retailer | Status | Live result | Sample product + price (verified) |
|---|---|---|---|
| Star Tech | ✅ GREEN | 10/10 publishable, 0 dropped | Deepcool CK-11509 CPU Cooler — ৳300 (reg ৳430) ✅ |
| Ryans | ⚠️ BLOCKED | 0 publishable (Cloudflare TLS fingerprint) | Ryzen 7 5700G — ৳21,900 (browser.open verified; offline parse matches) |
| Techland | ⚠️ BLOCKED | 0 publishable (Cloudflare TLS fingerprint) | Ocypus Delta P650 PSU — ৳4,999 (browser.open JSON-LD verified; offline parse matches) |
| PCB Store | ✅ GREEN | 5/5 publishable, 0 blocked | Ryzen 7 5700G — ৳23,400 ✅ |
| Ultra Technology | ✅ GREEN | 5/5 publishable, 0 blocked | Ryzen 5 5600GT — ৳18,000 (reg ৳18,500) ✅ |
| PC House | ✅ GREEN | 10/10 publishable, 0 dropped | 1STPLAYER NGDP 750W PSU — ৳11,700 (reg ৳12,900; offer from page HTML) ✅ |
| Sell Tech | ✅ GREEN | 15/15 publishable, 0 blocked | Ryzen 7 7800X3D — ৳34,000 (reg ৳41,790, −18.6%) ✅ |
| Speed Tech | ✅ GREEN | 5/5 publishable, 0 blocked | Logitech C920 webcam — ৳12,500 (reg ৳12,980) ✅ |
| Index IT | ✅ GREEN | 5/5 publishable, 0 blocked | HP P204v monitor — ৳11,800 (reg ৳12,700) ✅ |
| Onix BD | ✅ GREEN | 5/5 publishable, 0 blocked | Logitech C920 webcam — ৳12,400 ✅ |

## Tier 2 (10)

| Retailer | Status | Live result | Sample product + price (verified) |
|---|---|---|---|
| Computer Village | ⚠️ BLOCKED | 0 (Cloudflare, every path 403) | — |
| Skyland | ✅ GREEN | 3/3 priced in stock | 1STPLAYER PS-300FK PSU — ৳2,299 ✅ |
| Computer Mania | ⚠️ BLOCKED | 0 (Cloudflare, sitemap 403) | — |
| Nexus (CS-Cart) | ✅ GREEN | 3/3 priced in stock | MSI PRO B760M-A motherboard — ৳19,000 ✅ |
| Dolphin (Odoo) | ✅ GREEN | 3/3 priced in stock | ATX Casing + PSU-D-TECH — ৳2,707 ✅ |
| Creatus | ✅ GREEN | 10/10 (3 priced, 7 out of stock) | 1STPLAYER AR-7 case — ৳5,900 (reg ৳6,800) ✅ |
| Potaka IT | ✅ GREEN | 3/3 priced in stock | Thermalright Frozen Warframe 420 — ৳14,000 (reg ৳15,000) ✅ |
| Binary Logic (Laravel) | ✅ GREEN | 3/3 priced in stock | Ryzen 7 7700 — ৳22,500 (reg ৳25,000) ✅ |
| Computer Source | ✅ GREEN | 3/3 priced in stock | Acer AC-750 PSU — ৳7,080 (reg ৳7,700) ✅ |
| Flora (ASP.NET) | ✅ GREEN | 3/3, all out of stock (last_seen_price kept) | Ryzen 3 3100 — last seen ৳17,000, Sold Out ✅ |

## Tier 3 (4)

| Retailer | Status | Live result | Sample product + price (verified) |
|---|---|---|---|
| Global Brand | ✅ GREEN | 10/10 (5 priced, 5 out of stock) | A4Tech Bloody B135N — ৳2,350 ✅ |
| UCC | ✅ GREEN | 10/10 (3 priced, 7 out of stock) | ViewSonic VX3276 monitor — ৳39,500 ✅ |
| Smart Technologies (WooCommerce) | ✅ GREEN | 3/3 priced in stock | Realme Book Core i5 — ৳73,999 ✅ |
| IT Source | ✅ GREEN | 3/3 priced in stock | LDNIO 6-USB extension — ৳1,090 ✅ |

## Tier 4 — found beyond the original 24 (2026-11-08)

| Retailer | Status | Live result | Sample product + price (verified) |
|---|---|---|---|
| Dream Electronics BD (drm.com.bd) | ✅ GREEN | 5/5 publishable | Ryzen 5 5600 — ৳13,800 ✅ |
| Sys Computers Ltd (syscomputersltd.com) | ✅ GREEN | 5/5 publishable | Ryzen 7 5800X — ৳24,000 ✅ |
| AVA Technology BD (avatechnologybd.com) | ✅ GREEN | 5/5 publishable | Ryzen 7 5700G — ৳21,900 ✅ |

## Totals

- **27 retailers: 23 GREEN, 4 BLOCKED** (Ryans, Techland, Computer Village,
  Computer Mania — all Cloudflare TLS-fingerprint blocks on plain Node fetch;
  parsers verified offline and prices verified via browser.open where noted).
- Root causes fixed in this loop (see phase reports for evidence):
  1. Star Tech sitemap leads with ~4,000 category URLs — category-first discovery.
  2. Script-blob prices read as visible prices (Onix) — visible text now strips script/style.
  3. "Regular Price: X" label never extracted — regular_price + savings now populate.
  4. Related-product thumbnails in galleries / related prices poisoning parses (DRM).
  5. Stale "latest price" sentences (Sys Computers) — JSON-LD wins on disagreement.
  6. Potaka IT: OG price is the regular price + malformed JSON-LD block.
  7. Per-adapter `parseProduct` overrides were dead code — dispatch wired
     (`config.parseProduct`), incl. PCB Store gallery merge.
  8. Discovery diagnostics: every 0-product failure now names its cause
     (sitemap status/timeout, URLs found, gate drops); 60 s sitemap timeout;
     empty-blob guard in the API so fallbacks are never shadowed.

## Known limits (honest)

- The 4 BLOCKED sites need a browser-grade fetch (real browser TLS
  fingerprint) or a different egress to prove live on Netlify; plain `fetch`
  was exhausted for them (timeouts, headers, TLS variants, retries, manual
  curl-like transport — curl itself works, Node does not).
- Ultra's robots Crawl-Delay: 20 s means ~45 products per 15-min background
  run; its catalogue finishes over several daily runs by design.
- Per-run cap is 200 products per retailer (SCRAPE_LIMIT); catalogues build
  up over successive daily refreshes.
- Netlify egress is unproven for the VM-verified sites — the next scheduled
  refresh (daily 00:20 Dhaka test time in netlify.toml) is the real proof;
  check `/api/status` after it.
