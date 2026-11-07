/**
 * Binary Logic — https://www.binarylogic.com.bd
 * Platform: custom Laravel cart (verified: csrf-token/_token fields,
 * /images/product_image/... assets, /tools/pc_builder, JSON-LD WebSite
 * search action /search/{product_name}). NOT OpenCart.
 * - Sitemap: single flat file, 2,067 URLs (homepage, categories,
 *   products). Robots.txt disallows /*?page= and /*?limit=, so
 *   discovery is SITEMAP-ONLY — never crawl category pagination.
 * - Product page: JSON-LD Product.offers (flat price, BDT,
 *   availability https://schema.org/InStock) + OG product:price:amount
 *   both give the OFFER price; the regular price appears only in prose
 *   ("Regular Price: ৳345,500 / Offer Price: ৳340,000").
 * - Catalogue is workstation / gaming-PC heavy (full PCs ৳48,000–
 *   ৳437,500) with some tray CPUs (e.g. i5-14400 Tray ৳32,000, out of
 *   stock). Full PCs are flagship-class for the absurd-price guard.
 * Verified sample: GAMING TITAN270K PC — 235,000 BDT
 * (regular 243,500), In Stock
 *   https://www.binarylogic.com.bd/gaming-titan270k-pc
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "binarylogic",
  name: "Binary Logic",
  baseUrl: "https://www.binarylogic.com.bd",
  platform: "Laravel (custom cart)",
  sitemapUrls: ["https://www.binarylogic.com.bd/sitemap.xml"],
  // DISCOVERY (Phase 3 fix, 2026-11-08): sitemap-first is WRONG here —
  // the sitemap leads with category/tool pages (/processor, /software,
  // /network-zone, /pc-components, …), so a limit-3 run burned its 153
  // attempts on categories and published 0. Category-first instead (same
  // pattern as Star Tech, Phase 1): /processor page 1 alone carries 77
  // product-like links inside the .shop_wrapper grid (verified live).
  // categoryPages: 1 — robots.txt disallows /*?page=, so only page 1 of
  // each category is fetched (never a ?page= URL); several categories
  // together yield far more than the run needs. The sitemap stays as the
  // fallback if category discovery yields nothing. NOTE: the site is
  // intermittently Cloudflare-challenged (curl got a challenge page on
  // /processor and on a product page, 2026-11-08) while fetchText usually
  // succeeds — a run may still come back 0 on a bad day; that is a
  // transient block, not a broken adapter.
  discoveryMode: "category",
  listingSelector: ".shop_wrapper",
  categoryPages: 1,
  categoryUrls: [
    "https://www.binarylogic.com.bd/processor",
    "https://www.binarylogic.com.bd/gaming-pc",
    "https://www.binarylogic.com.bd/binary-pc",
    "https://www.binarylogic.com.bd/momentum-server",
    "https://www.binarylogic.com.bd/desktop-pc",
    "https://www.binarylogic.com.bd/pc-components",
  ],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Category-first discovery (sitemap leads with categories); page 1 only per category — robots.txt disallows ?page=. Intermittent Cloudflare challenges observed 2026-11-08 (fetchText usually succeeds).",
  isProductUrl: (u) =>
    u.startsWith("https://www.binarylogic.com.bd/") &&
    !u.includes("/tools/") &&
    !u.includes("/workstation/") &&
    !u.includes("/admin") &&
    !u.includes("/search") &&
    !u.includes("/cart") &&
    !u.includes("/checkout") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Its JSON-LD/OG path is platform-agnostic: JSON-LD offers price +
 * stock, spec tables, gallery from og:image + JSON-LD images.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
