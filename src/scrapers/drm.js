/**
 * Dream Electronics BD (DRM) — https://www.drm.com.bd
 * Platform: OpenCart (strong evidence: /image/cache/catalog/..., "Ex Tax:"
 * lines, JSON-LD Product + Offer, og:type=product). Suvastu Arcade ICT
 * Bhaban, Elephant Road, Dhaka. General electronics store — the sitemap
 * (5,709 URLs) is mostly ACs, TVs, fridges and washing machines, so
 * discovery is sitemap-first WITH a slug keyword filter (see isProductUrl):
 * without it a 15-minute background run would spend its whole budget on
 * air conditioners. The component catalogue is the
 * /component-price-in-bangladesh category (244 products, 21 pages).
 * - Sitemap: flat urlset, 5,709 URLs, lastmod up to 2026-11-07 (fresh).
 * - Product page: "Price: X৳ / Regular Price: Y৳" pair + JSON-LD
 *   Product.offers.price. NO "latest price … is X" sentence — the shared
 *   parser falls back to the labelled-price regex, then structured data.
 * - robots.txt: User-agent * Allow / (only AI-training bots Disallow'ed).
 *   No Crawl-Delay, no challenge observed.
 * Verified sample: AMD Ryzen 5 5600 Processor — 13,800 BDT (regular
 *   14,500), In Stock
 *   https://www.drm.com.bd/amd-ryzen-5-5600-processor-price-in-bd
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";
import { extractJsonLd } from "../lib/jsonld.js";
import { savingsPct } from "../lib/price.js";

/**
 * Component tokens that must appear in a DRM slug for the URL to be a PC
 * component product. DRM slugs are hyphen-separated, so match whole tokens.
 * (A plain substring test would match e.g. "ram" inside "program".)
 */
const COMPONENT_TOKENS = new Set([
  "processor", "motherboard", "graphics", "gpu", "cpu", "ram", "ssd", "nvme",
  "hdd", "hard", "drive", "disk", "power", "supply", "psu", "casing",
  "cooler", "cooling", "monitor", "keyboard", "mouse", "ups", "webcam",
  "printer", "router", "speaker", "headphone", "microphone", "scanner",
  "projector", "ryzen", "geforce", "radeon", "ddr3", "ddr4", "ddr5",
]);

/** DRM-branded full-PC bundles — not components, and no stable model_key. */
const BUNDLE_MARKERS = ["custom-pc", "pc-build", "desktop-offer"];

export const config = {
  id: "drm",
  name: "Dream Electronics BD",
  baseUrl: "https://www.drm.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.drm.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.drm.com.bd/component-price-in-bangladesh"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes:
    "General electronics store — sitemap is mostly appliances. isProductUrl keyword-filters sitemap URLs to PC-component slugs (1,271 of 5,709); bare category pages are dropped by the product-page gate. No 'latest price' sentence on product pages.",
  isProductUrl: (u) => {
    if (!u.startsWith("https://www.drm.com.bd/")) return false;
    if (u.includes("?") || u.includes("/blog/")) return false;
    if (u === "https://www.drm.com.bd/component-price-in-bangladesh") return false;
    const slug = u.slice("https://www.drm.com.bd/".length).replace(/\/$/, "");
    if (!slug || BUNDLE_MARKERS.some((m) => slug.includes(m))) return false;
    // Bare category/brand pages are short slugs ending "-price-in-bd"
    // (e.g. processor-price-in-bd = 4 tokens); real products carry a model.
    const tokens = slug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (
      (slug.endsWith("-price-in-bd") || slug.endsWith("-price-in-bangladesh")) &&
      tokens.length <= 4
    ) {
      return false;
    }
    return tokens.some((t) => COMPONENT_TOKENS.has(t));
  },
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js) PLUS a
 * DRM-only price correction (see below).
 * Gallery: og:image + JSON-LD images + /image/cache/catalog/... images on
 * the page. Returns the full normalised schema including images[] (all
 * gallery images, deduplicated, absolute URLs; [] when the page exposes
 * none).
 *
 * DRM PRICE CORRECTION — verified 2026-11-08 on live pages. DRM's
 * product pages render a related-products carousel BEFORE the main
 * product's price in DOM order, so the shared parser's labelled-price
 * regex ("price … digits৳", first match in body text) picks up a related
 * product's price instead of the page's own price — twice demonstrated:
 * MacBook Pro 13" M2 page → AirPods Pro 16,000৳ instead of 175,000৳;
 * Ryzen 5 5600 page → 17,800৳ (a related product) instead of 13,800৳.
 * DRM has no "latest price … is X" sentence, so nothing outranks the
 * poisoned regex match, and the reconciler then demotes the correct
 * JSON-LD price to "regular" (or just logs a disagreement). The page's
 * own JSON-LD Offer price has matched the displayed price block on every
 * DRM page checked, so on DRM — unlike the Tier-1 sites — JSON-LD wins
 * whenever it disagrees with the visible price. The gap is logged in
 * conflicts[]; a fake-low price (the worst error for a comparison site)
 * is impossible this way, while the reverse error (publishing the JSON-LD
 * price when the visible offer was genuinely lower) is conservative.
 * Note: this also means regular_price stays null on DRM (the shared
 * parser never recovers the visible regular price on product pages) —
 * same known limitation as Speed Tech.
 */
export function parseProduct(config, html, url) {
  const product = parseProductShared(config, html, url);
  if (product === null) return null;
  const jsonLdPrice = extractJsonLd(html)?.price ?? null;
  if (!jsonLdPrice) return product;
  const effective =
    product.stock === "out_of_stock" ? product.last_seen_price : product.price;
  if (effective === null || effective === jsonLdPrice) return product;
  const gap = Math.abs(effective - jsonLdPrice) / jsonLdPrice;
  const corrected = {
    ...product,
    conflicts: [
      ...product.conflicts,
      `drm: visible price ${effective} is ${Math.round(gap * 100)}% away from this page's own JSON-LD Offer price ${jsonLdPrice} — the visible-price regex matched a related product's price, so JSON-LD wins`,
    ],
    price_sources: [...product.price_sources, "structured:jsonld (drm jsonld-wins)"],
  };
  if (product.stock === "out_of_stock") corrected.last_seen_price = jsonLdPrice;
  else corrected.price = jsonLdPrice;
  // The structured price was misassigned as the regular price by the
  // reconciler (or is lower than the corrected offer — inverted); drop it.
  if (
    corrected.regular_price !== null &&
    (corrected.regular_price === jsonLdPrice || corrected.regular_price < jsonLdPrice)
  ) {
    corrected.regular_price = null;
  }
  corrected.savings_pct = savingsPct(corrected.price, corrected.regular_price);
  return corrected;
}

// Dispatch hook: scrapeRetailer (src/scrapers/opencart.js) and the admin
// live-check call config.parseProduct when the adapter defines one, so this
// correction actually runs in production (it did not before the dispatch
// fix — see the comment in opencart.js).
config.parseProduct = parseProduct;
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
