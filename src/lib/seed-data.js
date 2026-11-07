/**
 * seed-data.js — DEMO SEED ONLY (generated from data/sample-5700g.json).
 *
 * Why this file exists as a JS module instead of JSON: Netlify Functions
 * bundle ONLY imported code — a function that reads data/*.json with
 * fs.readFile works locally but throws ENOENT in production (the JSON
 * files are not in the deployed bundle). Importing the seed as a module
 * guarantees it ships. The nightly refresh writes real data to Blobs and
 * replaces this seed atomically; the API prefers Blobs, then bundled
 * JSON, then this seed — so this seed is only ever used before the first
 * refresh has run.
 */
export const SEED_BY_RETAILER = {
  "startech": {
    "retailer_id": "startech",
    "retailer": "Star Tech",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [],
        "description": "AMD Ryzen 7 5700G Processor with Radeon Graphics — 8 cores, 16 threads, Zen 3, Radeon Graphics.",
        "image": "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg",
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
        "price": 20600,
        "price_sources": [
          "visible:latest-price-sentence",
          "structured:opengraph"
        ],
        "regular_price": 22500,
        "retailer": "Star Tech",
        "retailer_id": "startech",
        "savings_pct": 8.4,
        "specs": {
          "Basic Information": {
            "Cores": "8",
            "Threads": "16"
          },
          "Warranty Information": {
            "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)"
          }
        },
        "stock": "in_stock",
        "url": "https://www.startech.com.bd/amd-ryzen-7-5700g-processor",
        "images": [
          "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg"
        ],
        "image_missing": false,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {
          "Basic Information": {
            "Cores": "8",
            "Threads": "16"
          },
          "Warranty Information": {
            "Manufacturing Warranty": "03 Years (No Warranty for Fan or Cooler)"
          }
        }
      }
    ]
  },
  "ryans": {
    "retailer_id": "ryans",
    "retailer": "Ryans Computers",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [],
        "description": null,
        "image": null,
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G 8 Core Processor",
        "price": 21900,
        "price_sources": [
          "structured:opengraph"
        ],
        "regular_price": null,
        "retailer": "Ryans Computers",
        "retailer_id": "ryans",
        "savings_pct": 0,
        "specs": {},
        "stock": "in_stock",
        "url": "https://www.ryans.com/amd-ryzen-7-5700g-8-core-desktop-processor",
        "images": [],
        "image_missing": true,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {}
      }
    ]
  },
  "techland": {
    "retailer_id": "techland",
    "retailer": "Techland BD",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [
          "JSON-LD price 20,600 disagrees with page text 22,500 (discounted from 23,500) — unresolved, re-check the live page before trusting either figure"
        ],
        "description": null,
        "image": null,
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G Processor",
        "price": 20600,
        "price_sources": [
          "structured:jsonld"
        ],
        "regular_price": null,
        "retailer": "Techland BD",
        "retailer_id": "techland",
        "savings_pct": 0,
        "specs": {},
        "stock": "unknown",
        "url": "https://www.techlandbd.com/amd-ryzen-7-5700g-processor",
        "images": [],
        "image_missing": true,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {}
      }
    ]
  },
  "pcbstore": {
    "retailer_id": "pcbstore",
    "retailer": "PCB Store",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [],
        "description": null,
        "image": null,
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G Desktop Processor with Radeon Graphics",
        "price": 23400,
        "price_sources": [
          "structured:jsonld"
        ],
        "regular_price": null,
        "retailer": "PCB Store",
        "retailer_id": "pcbstore",
        "savings_pct": 0,
        "specs": {},
        "stock": "in_stock",
        "url": "https://pcbstore.com.bd/product/amd-ryzen-7-5700g-desktop-processor",
        "images": [],
        "image_missing": true,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {}
      }
    ]
  },
  "speedtech": {
    "retailer_id": "speedtech",
    "retailer": "Speed Tech",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [],
        "description": null,
        "image": "https://www.speedtech.com.bd/image/catalog/component/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor.jpg",
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G Processor with Radeon Graphics",
        "price": 20000,
        "price_sources": [
          "structured:opengraph"
        ],
        "regular_price": null,
        "retailer": "Speed Tech",
        "retailer_id": "speedtech",
        "savings_pct": 0,
        "specs": {},
        "stock": "in_stock",
        "url": "https://www.speedtech.com.bd/amd-ryzen-7-5700g-processor",
        "images": [
          "https://www.speedtech.com.bd/image/catalog/component/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor.jpg"
        ],
        "image_missing": false,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {}
      }
    ]
  },
  "pchouse": {
    "retailer_id": "pchouse",
    "retailer": "PC House BD",
    "started": "2026-11-07T18:11:01.004Z",
    "finished": "2026-11-07T18:11:01.004Z",
    "urls_found": 1,
    "products": 1,
    "blocked": 0,
    "errors": [],
    "seed_data": true,
    "seed_note": "DEMO SEED ONLY — verified Ryzen 7 5700G sample. Replaced atomically by the nightly refresh.",
    "items": [
      {
        "brand": "AMD",
        "category": null,
        "conflicts": [
          "listing price table 21,900 vs detail-page OG price 25,500 — the listing (offer) price is used; re-check live"
        ],
        "description": null,
        "image": null,
        "last_checked": "2026-11-07T17:30:00Z",
        "model_key": "amd ryzen 7 5700g",
        "name": "AMD Ryzen 7 5700G Processor With Radeon Graphics",
        "price": 21900,
        "price_sources": [
          "visible:price-label"
        ],
        "regular_price": 25500,
        "retailer": "PC House BD",
        "retailer_id": "pchouse",
        "savings_pct": 14.1,
        "specs": {},
        "stock": "in_stock",
        "url": "https://www.pchouse.com.bd/amd-ryzen-7-5700g-processor",
        "images": [],
        "image_missing": true,
        "last_seen_price": null,
        "price_flagged": false,
        "specifications": {}
      }
    ]
  }
};
