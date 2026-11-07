/**
 * Price-guard + gallery + atomic-publish tests — offline, no network.
 * Covers the rules in src/lib/price.js, src/lib/normalize.js and
 * src/lib/store.js that the 2026-11-07 update added:
 *  - gallery image extraction (OpenCart thumbnails + Next.js /_next/image)
 *  - out-of-stock price exclusion from lowest-price
 *  - >80% savings rejection (price pair dropped, conflict logged)
 *  - 10x cross-retailer outlier flag
 *  - >50% day-over-day jump flag
 *  - atomic replace keeps old data on failure
 * Run: npm test   (node --test tests/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  savingsPct,
  reconcilePrices,
  isAbsurdPrice,
  eligibleForLowest,
  computeLowestHighest,
  applyCrossRetailerOutliers,
} from "../src/lib/price.js";
import { normalizeProduct, isPublishable } from "../src/lib/normalize.js";
import { extractGalleryImages } from "../src/lib/jsonld.js";
import {
  validateRetailerPayload,
  applyDayOverDayFlags,
  publishRetailerData,
} from "../src/lib/store.js";
import { parseProduct } from "../src/scrapers/opencart.js";
import { parseProduct as parsePcbProduct, config as pcbstore } from "../src/scrapers/pcbstore.js";
import { config as startech } from "../src/scrapers/startech.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const galleryHtml = readFileSync(join(FIX, "gallery-product.html"), "utf8");
const pcbHtml = readFileSync(join(FIX, "pcbstore-product.html"), "utf8");

function baseProduct(overrides = {}) {
  return normalizeProduct(
    { id: "startech", name: "Star Tech" },
    {
      name: "AMD Ryzen 7 5700G Processor with Radeon Graphics",
      url: "https://www.startech.com.bd/amd-ryzen-7-5700g-processor",
      image: "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg",
      images: ["https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg"],
      price: 20600,
      regular_price: 22500,
      stock: "in_stock",
      description: "8 cores, 16 threads.",
      specs: {},
      price_sources: ["visible:latest-price-sentence"],
      conflicts: [],
      ...overrides,
    }
  );
}

/** Minimal in-memory fake for the Netlify Blobs store interface. */
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    _data: data,
    async get(key) {
      return key in data ? structuredClone(data[key]) : null;
    },
    async setJSON(key, value) {
      data[key] = structuredClone(value);
    },
    async delete(key) {
      delete data[key];
    },
  };
}

// --- gallery extraction ---
test("gallery: OpenCart fixture yields og + JSON-LD + thumbnail images, deduped, no logo/banner", () => {
  const images = extractGalleryImages(galleryHtml, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.equal(images[0], "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg");
  assert.equal(images.length, 6);
  assert.equal(new Set(images).size, 6);
  assert.ok(images.every((u) => u.startsWith("https://www.startech.com.bd/")));
  assert.ok(images.every((u) => !/logo|banner/i.test(u)));
});

test("gallery: parseProduct returns images[] with the OG image first", () => {
  const p = parseProduct(startech, galleryHtml, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.equal(p.image, "https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700g/ryzen-7-5700g-processor-500x500.jpg");
  assert.equal(p.images.length, 6);
  assert.equal(p.image_missing, false);
  assert.equal(p.price, 20600);
});

test("gallery: PCB Store (Next.js) decodes /_next/image URLs and keeps /img proxy URLs", () => {
  const p = parsePcbProduct(pcbstore, pcbHtml, "https://pcbstore.com.bd/product/amd-ryzen-7-5700g-desktop-processor");
  assert.equal(p.price, 23400);
  assert.equal(p.retailer_id, "pcbstore");
  assert.ok(p.images.includes("https://pcbstore.com.bd/storage/products/ryzen-7-5700g-1.webp"), p.images.join(", "));
  assert.ok(p.images.includes("https://pcbstore.com.bd/storage/products/ryzen-7-5700g-2.webp"));
  assert.ok(p.images.includes("https://pcbstore.com.bd/img/w1080/q75/storage/products/ryzen-7-5700g-3.webp"));
  assert.ok(p.images.includes("https://pcbstore.com.bd/img/w1080/q75/storage/products/ryzen-7-5700g-cover.webp"));
  assert.ok(p.images.every((u) => !/_next\/image/.test(u)), "no raw /_next/image optimiser URL may leak into images[]");
  assert.ok(p.images.every((u) => !/logo/i.test(u)));
  assert.equal(p.image_missing, false);
});

test("gallery: a page with no image records image_missing, never invents a URL", () => {
  const p = baseProduct({ image: null, images: [] });
  assert.equal(p.image, null);
  assert.deepEqual(p.images, []);
  assert.equal(p.image_missing, true);
});

// --- out-of-stock rule ---
test("out-of-stock: price moves to last_seen_price, product never wins lowest", () => {
  const p = baseProduct({ stock: "out_of_stock", price: 15000 });
  assert.equal(p.price, null);
  assert.equal(p.last_seen_price, 15000);
  assert.ok(p.conflicts.some((c) => c.includes("out_of_stock_price_unreliable")));
  assert.equal(eligibleForLowest(p), false);
  assert.equal(isPublishable(p), true, "an out-of-stock product is still publishable (explicit stock status)");
});

test("out-of-stock: cheapest in-stock price wins, even when an out-of-stock listing is cheaper", () => {
  const cheapOos = baseProduct({ stock: "out_of_stock", price: 10000, url: "https://www.startech.com.bd/cheap-oos" });
  const mid = baseProduct({ price: 20600 });
  const expensive = baseProduct({ price: 23400, url: "https://www.startech.com.bd/expensive", retailer_id: "pcbstore" });
  const { lowest_price, highest_price } = computeLowestHighest([cheapOos, mid, expensive]);
  assert.equal(lowest_price, 20600);
  assert.equal(highest_price, 23400);
});

test("publishable: in-stock product with no price is NOT publishable (call-for-price)", () => {
  assert.equal(isPublishable(baseProduct({ price: null, stock: "in_stock" })), false);
  assert.equal(isPublishable(baseProduct({ price: null, stock: "unknown" })), false);
});

// --- >80% savings rejection ---
test("savings above 80%: reconciler drops the suspect regular price, conflict logged", () => {
  const r = reconcilePrices({ visiblePrice: 800, visibleRegular: 100000, structuredPrice: null });
  assert.equal(r.price, 800);
  assert.equal(r.regularPrice, null);
  assert.ok(r.conflicts.length > 0);
  // A product that somehow still carries a >80% pair is rejected at publish
  // time (see validateRetailerPayload test below), so no fake -94% deal
  // can ever reach the API.
});

test("absurd price: >1,000,000 BDT for a CPU is flagged; a flagship GPU is not", () => {
  assert.equal(isAbsurdPrice(100000, "AMD Ryzen 7 5700G Processor", null), false);
  assert.equal(isAbsurdPrice(1200000, "AMD Ryzen 7 5700G Processor", null), true);
  assert.equal(isAbsurdPrice(1200000, "ASUS ROG RTX 5090 Graphics Card", null), false);
  const p = baseProduct({ price: 1200000 });
  assert.equal(p.price_flagged, true);
  assert.ok(p.conflicts.some((c) => c.includes("absurd price")));
  assert.equal(eligibleForLowest(p), false);
});

// --- 10x cross-retailer outlier ---
test("cross-retailer outlier: price >10x the peer median is flagged and excluded from lowest/highest", () => {
  const mk = (retailer_id, price, url) =>
    normalizeProduct(
      { id: retailer_id, name: retailer_id },
      {
        name: "AMD Ryzen 7 5700G Processor",
        url,
        price,
        stock: "in_stock",
        price_sources: ["structured:jsonld"],
        conflicts: [],
      }
    );
  const items = [
    mk("startech", 20600, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor"),
    mk("ryans", 21900, "https://www.ryans.com/amd-ryzen-7-5700g-8-core-desktop-processor"),
    mk("techland", 20600, "https://www.techlandbd.com/amd-ryzen-7-5700g-processor"),
    mk("pcbstore", 250000, "https://pcbstore.com.bd/product/amd-ryzen-7-5700g-desktop-processor"),
  ];
  const { items: flagged, flagged: list } = applyCrossRetailerOutliers(items);
  assert.equal(list.length, 1);
  assert.equal(list[0].retailer_id, "pcbstore");
  const bad = flagged.find((p) => p.retailer_id === "pcbstore");
  assert.equal(bad.price_flagged, true);
  assert.ok(bad.conflicts.some((c) => c.includes("cross-retailer outlier")));
  const { lowest_price, highest_price } = computeLowestHighest(flagged);
  assert.equal(lowest_price, 20600);
  assert.equal(highest_price, 21900, "the 250,000 outlier must not become the highest price");
});

test("cross-retailer outlier: no flag when only one peer exists", () => {
  const mk = (retailer_id, price, url) =>
    normalizeProduct({ id: retailer_id, name: retailer_id }, { name: "X Y 1", url, price, stock: "in_stock", conflicts: [] });
  const { flagged } = applyCrossRetailerOutliers([
    mk("a", 1000, "https://a.example/1"),
    mk("b", 50000, "https://b.example/1"),
  ]);
  assert.equal(flagged.length, 0);
});

// --- >50% day-over-day jump ---
test("day-over-day: a >50% jump is flagged and kept in conflicts[]", () => {
  const oldItems = [baseProduct({ price: 20600 })];
  const newItems = [baseProduct({ price: 35000 })];
  const { items, flagged } = applyDayOverDayFlags(newItems, oldItems);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].change_pct, 69.9);
  assert.equal(items[0].day_over_day_flagged, true);
  assert.ok(items[0].conflicts.some((c) => c.includes("day-over-day price jump")));
});

test("day-over-day: a small move and a first-seen product are not flagged", () => {
  const oldItems = [baseProduct({ price: 20600 })];
  const { flagged: small } = applyDayOverDayFlags([baseProduct({ price: 21000 })], oldItems);
  assert.equal(small.length, 0);
  const { flagged: firstSeen } = applyDayOverDayFlags(
    [baseProduct({ price: 99999, url: "https://www.startech.com.bd/brand-new-product" })],
    oldItems
  );
  assert.equal(firstSeen.length, 0);
});

// --- atomic replace ---
test("atomic replace: valid payload replaces live data via a pending key", async () => {
  const store = fakeStore();
  const payload = { retailer_id: "startech", retailer: "Star Tech", finished: new Date().toISOString(), products: 1, items: [baseProduct()] };
  const res = await publishRetailerData(store, "startech", payload);
  assert.equal(res.ok, true);
  assert.equal(res.kept_old_data, false);
  assert.deepEqual(store._data["startech.json"].items[0].price, 20600);
  assert.ok(!("startech.pending.json" in store._data), "pending key is cleaned up after a successful swap");
});

test("atomic replace: invalid payload (0 products) keeps yesterday's data untouched", async () => {
  const yesterday = { retailer_id: "startech", retailer: "Star Tech", finished: "2026-11-06T18:00:00.000Z", products: 1, items: [baseProduct()] };
  const store = fakeStore({ "startech.json": yesterday });
  const res = await publishRetailerData(store, "startech", { retailer_id: "startech", items: [] });
  assert.equal(res.ok, false);
  assert.equal(res.kept_old_data, true);
  assert.deepEqual(store._data["startech.json"], yesterday);
  assert.ok(!("startech.pending.json" in store._data));
});

test("atomic replace: a payload with an unpublishable product is rejected, old data kept", async () => {
  const yesterday = { retailer_id: "startech", retailer: "Star Tech", finished: "2026-11-06T18:00:00.000Z", products: 1, items: [baseProduct()] };
  const store = fakeStore({ "startech.json": yesterday });
  const bad = normalizeProduct(
    { id: "startech", name: "Star Tech" },
    { name: null, url: "not-a-url", price: null, stock: "unknown", conflicts: [] }
  );
  const res = await publishRetailerData(store, "startech", { retailer_id: "startech", items: [bad] });
  assert.equal(res.ok, false);
  assert.equal(store._data["startech.json"].items[0].price, 20600);
});

test("validateRetailerPayload: rejects empty items and >80% savings payloads", () => {
  assert.equal(validateRetailerPayload({ items: [] }).ok, false);
  assert.equal(validateRetailerPayload({ items: [baseProduct()] }).ok, true);
  const bad = { ...baseProduct({ price: 800, regular_price: 100000 }), savings_pct: 99.2 };
  assert.equal(validateRetailerPayload({ items: [bad] }).ok, false);
});
