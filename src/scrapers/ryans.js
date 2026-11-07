/**
 * Ryans Computers — canonical domain RYANS.COM (ryanscomputers.com is an alias).
 * Platform: unverified / custom cart. Cloudflare present.
 * DEGRADED — Cloudflare rate-limits this retailer (see below).
 * PHASE 1 (2026-11-08, verified live from this VM):
 * - Cloudflare blocks are TRANSIENT and rate-based: node fetch got 403 /
 *   "Just a moment" on the sitemap, then the identical request returned
 *   200 after a ~60-90 s pause. Discovery retries blocked fetches with a
 *   long back-off (see src/lib/http.js) instead of failing the retailer.
 * - Sitemap VERIFIED: index lists https://ryans.com/product-sitemap.xml
 *   (bare domain; 301s to www) — ~8.8 MB, first URLs are real products.
 * - Listing pages are NOT JS-rendered: the category page returns 200
 *   with 108 product links and Tk prices in plain HTML (the earlier
 *   text fetch just dropped them). Product pages parse from OG meta
 *   (price 21,900 / Regular Price Tk 23,550 on the 5700G page).
 * - Out-of-stock products show price 0 — treated as no-price, never a deal.
 * - Duplicate SKUs: boxed 5700G (21,900) vs tray/AM4 listing — dedupe by URL.
 * PHASE 1 VERDICT (2026-11-08): plain Node fetch is DETERMINISTICALLY
 * challenged from this VM — 6+ consecutive 403 / "Just a moment" on the
 * sitemap, category page AND product pages, while curl with identical
 * headers returns 200 every time. Root cause narrowed to the client
 * fingerprint (see src/lib/http.js): Node's TLS ClientHello carries
 * post-quantum groups/sigalgs and a 1,258-byte key_share vs curl's
 * 38-byte single X25519 share; undici also forces sec-fetch-mode: cors.
 * A manual node:https transport with curl-like TLS (ciphers +
 * ecdhCurve X25519) returned 200 3/3 via the proxy tunnel, proving the
 * site serves plain-HTTP clients — but its body reads proved unreliable
 * under this VM's rate-limited egress (truncated/empty bodies as probing
 * volume grew), so it was NOT shipped. Discovery now retries blocks
 * with a long back-off (best chance on Netlify's different egress) and
 * records every failure. Until a Netlify run proves otherwise, treat
 * this retailer as browser-required.
 * Verified sample: Ryzen 7 5700G 8 Core (OEM/Tray) — 21,900 BDT (regular
 *   23,550), In Stock — parsed live 2026-11-08 from the saved product page.
 *   https://www.ryans.com/amd-ryzen-7-5700g-8-core-desktop-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "ryans",
  name: "Ryans Computers",
  baseUrl: "https://www.ryans.com",
  platform: "Custom cart (unverified)",
  sitemapUrls: ["https://www.ryans.com/sitemap.xml"],
  categoryUrls: ["https://www.ryans.com/category/computer-desktop-component"],
  crawlDelayMs: 2000,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: true,
  notes:
    "DEGRADED: Cloudflare deterministically challenges plain Node fetch from this VM (403 / Just-a-moment on sitemap, category and product pages; curl with identical headers returns 200). Discovery retries blocks with a long back-off. Sitemap verified 2026-11-08 (index -> bare-domain product-sitemap.xml, 301 -> www, ~8.8 MB). Category + product pages are server-rendered (prices in plain HTML) and parse correctly offline — the blocker is the fetch fingerprint, not the parser. Browser-required until a Netlify run proves otherwise.",
  isProductUrl: (u) =>
    u.startsWith("https://www.ryans.com/") &&
    !u.includes("/category/") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /storage/products/small/*.webp images exposed on the page.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
