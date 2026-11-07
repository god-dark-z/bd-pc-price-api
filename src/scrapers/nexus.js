/**
 * Nexus — https://www.nexus.com.bd
 * Platform: CS-Cart (verified: ty-menu__submenu classes,
 * /images/detailed/<id>/... image paths, breadcrumb
 * Home/Component/Graphics Card/Manli). No wp-content, no catalog/.
 * CUSTOM PARSE PATH — JSON-LD uses full-URL types:
 *   "@type":"http:\/\/schema.org\/Product" (and Offer), with offers as
 *   an ARRAY and availability as the plain string "InStock".
 * The shared extractJsonLd only matches @type === "Product", so this
 * adapter normalises the schema.org-URL types to bare Product/Offer
 * before running the shared parser. og:type is "website" (not
 * "product"), so the product-page gate relies on the normalised JSON-LD.
 * - Sitemap: single flat file, 19,877 URLs (categories + products
 *   mixed, all trailing-slash). Category pages are dropped by the gate.
 * - Price/stock: JSON-LD offers price = offer price (26,200 on the
 *   B760M sample). Watch out: many legacy products are OutOfStock and
 *   some carry price 0 (e.g. Asus Vivobook X415MA, 0 BDT) — price 0 =
 *   no price, never a deal.
 * Verified sample: ASUS TUF GAMING B760M PLUS WIFI D4 13th & 12th Gen
 * DDR4 mATX Motherboard — 26,200 BDT, InStock
 *   https://www.nexus.com.bd/asus-tuf-gaming-b760m-plus-wifi-d4-ddr4-motherboard/
 */
import { listProductUrls as listProductUrlsShared, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";
import { fetchText } from "../lib/http.js";
import { absUrl } from "../lib/jsonld.js";
import * as cheerio from "cheerio";

export const config = {
  id: "nexus",
  name: "Nexus",
  baseUrl: "https://www.nexus.com.bd",
  platform: "CS-Cart",
  sitemapUrls: ["https://www.nexus.com.bd/sitemap.xml"],
  // DISCOVERY (Phase 3 fix, 2026-11-08): sitemap-first is WRONG here —
  // the sitemap's first ~150+ URLs are all category pages (laptop,
  // asus-laptop, brand-pc, desktop-components, …), so a limit-3 run
  // burned its 153 attempts on categories and published 0. Category-first
  // instead (same pattern as Star Tech, Phase 1): the .grid-list product
  // grid holds 32 product links per page, and ?page=N pagination works
  // (verified live: page 1 vs page 2 share 0 links). robots.txt is
  // `Allow: /` with no ?page= disallow. The sitemap stays as the
  // fallback if category discovery yields nothing.
  discoveryMode: "category",
  listingSelector: ".grid-list",
  categoryPages: 5,
  categoryUrls: [
    "https://www.nexus.com.bd/desktop-components/",
    "https://www.nexus.com.bd/processor/",
    "https://www.nexus.com.bd/computer-motherboard/",
    "https://www.nexus.com.bd/graphics-card/",
  ],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "CS-Cart: JSON-LD @type values are full schema.org URLs — normalised to bare Product/Offer before the shared parser runs. Category-first discovery with a contact-for-price filter (the first grid pages are dominated by unpriced listings). Sitemap mixes categories + products (19,877 URLs); the gate drops categories.",
  isProductUrl: (u) =>
    u.startsWith("https://www.nexus.com.bd/") &&
    u.endsWith("/") &&
    u !== "https://www.nexus.com.bd/" &&
    !u.includes("?"),
};

export { listProductUrlsShared as listProductUrlsFallback };

/**
 * Custom discovery: crawl the component category grids and collect ONLY
 * priced product URLs. Nexus lists its newest products first and the
 * first grid pages are dominated by "Contact us for a price" listings —
 * products with no price anywhere (no JSON-LD price, no visible price),
 * which parse to price null and are unpublishable. A plain category
 * crawl returned 32 URLs from page 1 of /desktop-components/ and all 32
 * were contact-for-price (live, 2026-11-08), so a limit-3 run published
 * 0 even though priced products exist deeper (page 2 has priced items;
 * the B760M board parses at 26,200). Skipping contact-for-price cards
 * at discovery keeps every attempt productive. Pagination is ?page=N
 * (verified live: page 1 vs page 2 share 0 links). Falls back to the
 * shared sitemap discovery if the grids yield nothing.
 */
export async function listProductUrls(config, { maxPages = 5, minUrls = 0 } = {}) {
  const found = new Set();
  const discoveryErrors = [];
  const pages = config.categoryPages ?? maxPages;
  for (const cat of config.categoryUrls || []) {
    for (let page = 1; page <= pages; page++) {
      if (minUrls > 0 && found.size >= minUrls) break;
      const url = page === 1 ? cat : `${cat}${cat.includes("?") ? "&" : "?"}page=${page}`;
      const res = await fetchText(url, {
        delayMs: config.crawlDelayMs,
        blockedRetries: 1,
        blockedBackoffMs: [30000],
      });
      if (!res.ok) {
        discoveryErrors.push({ url, error: res.error || `HTTP ${res.status}`, status: res.status ?? null, blocked: !!res.blocked });
        break;
      }
      const $ = cheerio.load(res.html);
      const items = $(".ut2-gl__item");
      if (items.length === 0) break; // end of pagination (no grid at all)
      items.each((_, item) => {
        if (/Contact us for a price/i.test($(item).text())) return;
        $(item)
          .find("a[href]")
          .each((_, a) => {
            const u = absUrl(config.baseUrl, $(a).attr("href"));
            if (u && config.isProductUrl(u) && !found.has(u)) found.add(u);
          });
      });
      // NOTE: no early break when a page adds 0 priced links — a page of
      // all contact-for-price cards is not the end of pagination.
    }
    if (minUrls > 0 && found.size >= minUrls) break;
  }
  if (found.size > 0) return { urls: [...found], discovery_errors: discoveryErrors };
  // Fallback: sitemap-first (shared), without the category-first flag so
  // it does not redo the unfiltered category crawl.
  const fb = await listProductUrlsShared({ ...config, discoveryMode: undefined }, { maxPages, minUrls });
  return { urls: fb.urls, discovery_errors: [...discoveryErrors, ...fb.discovery_errors] };
}

/** Rewrite schema.org-URL @type values to the bare type names the shared JSON-LD extractor matches. */
export function normaliseSchemaOrgTypes(html) {
  return String(html || "").replace(
    /"@type"\s*:\s*"https?:\\?\/\\?\/schema\.org\\?\/(Product|Offer)"/g,
    '"@type":"$1"'
  );
}

/**
 * parseProduct — normalise CS-Cart JSON-LD types, then the shared
 * OpenCart parser. Specs come from the real <table> rows
 * (Brand/Model/Chipset/…); gallery from og:image + JSON-LD images
 * (/images/detailed/<id>/...).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, normaliseSchemaOrgTypes(html), url);
}

// Attach the overrides to the config so the engine dispatch in
// scrapeRetailer (and scrape-live) actually uses them.
config.listProductUrls = listProductUrls;
config.parseProduct = parseProduct;

export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
