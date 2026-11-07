/**
 * Computer Source — https://computersource.com.bd
 * Platform: OpenCart (verified: catalog/view/javascript/...,
 * catalog/view/theme/computer_source/..., robots disallows
 * /*?product_id=, /*?component_id=).
 * DOMAIN CORRECTION: the Phase-3 brief lists computersourcebd.com,
 * but that host does not resolve/connect from this VM (curl 000 on
 * robots/sitemap/homepage, 2026-11-08). The live store is
 * computersource.com.bd (200 on robots + homepage; every search result
 * points there). This adapter uses the live domain.
 * - Sitemap: sitemap_index.xml (200, 148 KB) — despite the name it is a
 *   FLAT urlset (not an index), mixing http:// and https:// locs.
 *   Product URLs are slug-only; brand/category pages share the same
 *   shape (/1stplayer-casing) and are dropped by the product-page gate.
 * - PRICE QUIRK (verified on the ADATA SU650 page): OG
 *   product:price:amount (7300.0000) is the REGULAR price; the visible
 *   offer is ৳7,100. So ogIsRegularPrice: true (same class as
 *   Star Tech / PC House).
 * Verified sample: ADATA SU650 256GB 2.5-inch SATAIII SSD — 7,100 BDT
 * (regular 7,300), In Stock
 *   https://computersource.com.bd/ADATA-SU650-256GB-2.5-inch-SATAIII-SSD
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "computersource",
  name: "Computer Source",
  baseUrl: "https://computersource.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://computersource.com.bd/sitemap_index.xml"],
  // DISCOVERY (Phase 3 fix, 2026-11-08): sitemap-first is WRONG here —
  // the flat sitemap leads with category/brand pages (/gaming-monitor,
  // /1stplayer-casing, …), so a limit-3 run burned its 153 attempts on
  // categories and published 0. Category-first instead (same pattern as
  // Star Tech, Phase 1): /pc-components holds 386 products over 20
  // pages, ?page=N pagination works (verified live: ADATA SU650 on page
  // 1, absent on page 2), and the product grid lives in .product-listing
  // (same class as Star Tech). The sitemap stays as the fallback if
  // category discovery yields nothing.
  discoveryMode: "category",
  listingSelector: ".product-listing",
  categoryPages: 20,
  categoryUrls: ["https://computersource.com.bd/pc-components"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: true,
  degraded: false,
  notes: "Live domain is computersource.com.bd (computersourcebd.com from the brief does not resolve). OG price is the REGULAR price — visible offer wins. Category-first discovery (sitemap leads with categories). Sitemap is a flat urlset despite the _index name; it mixes http/https locs.",
  isProductUrl: (u) => {
    if (!u.startsWith("https://computersource.com.bd/") && !u.startsWith("http://computersource.com.bd/")) return false;
    if (u.includes("?")) return false;
    const path = new URL(u).pathname;
    if (path === "/") return false;
    if (path.split("/").filter(Boolean).length !== 1) return false;
    return ![
      "pc-components",
      "deals",
      "complain",
      "account",
      "cart",
      "checkout",
    ].includes(path.replace(/\//g, ""));
  },
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * With ogIsRegularPrice: true the structured (OG) price is treated as
 * the regular price when it is higher than the visible offer.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
