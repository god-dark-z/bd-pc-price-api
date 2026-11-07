/**
 * PCB Store — https://pcbstore.com.bd
 * Platform: Next.js frontend (confirmed: /_next/image, /*_rsc= in robots).
 * Backend unverified. Likely Cloudflare in front (robots disallows /cdn-cgi/).
 * DEGRADED — listing grid URL + pagination param NOT verified:
 * - /pc-components/* URLs fetched so far are SEO guide pages, NOT product grids.
 * - Product URLs are /product/<slug> (verified).
 * - Product page: description prose + Key Features bullets; NO spec table
 *   was visible in text fetch — specs live in prose/bullets. Price/stock
 *   only via JSON-LD Product.offers. No old/regular price seen on detail pages.
 * - Sitemap index: product-sitemap.xml (contents unverified — 429 once).
 * Discovery therefore relies on the product sitemap, not category crawling.
 * GALLERY (Next.js): product images are served through the Next.js image
 * optimiser (/_next/image?url=<encoded original>&w=...&q=...) and the
 * /img/w<width>/q<quality>/storage/...webp proxy (verified patterns in the
 * research). parseProduct below runs the shared OpenCart parser first,
 * then merges every Next.js gallery image the page exposes via
 * extractNextJsImages (src/lib/jsonld.js) — og:image, JSON-LD images,
 * /_next/image URLs (decoded to the real image URL) and /img/... proxy
 * URLs, deduplicated, absolute. No image URL is ever invented.
 * Verified sample: Ryzen 7 5700G Desktop Processor — 23,400 BDT, InStock
 *   https://pcbstore.com.bd/product/amd-ryzen-7-5700g-desktop-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";
import { extractNextJsImages } from "../lib/jsonld.js";
import { dedupeImages } from "../lib/normalize.js";

export const config = {
  id: "pcbstore",
  name: "PCB Store",
  baseUrl: "https://pcbstore.com.bd",
  platform: "Next.js frontend",
  sitemapUrls: ["https://pcbstore.com.bd/sitemap.xml"],
  categoryUrls: [],
  crawlDelayMs: 2000,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: false,
  notes:
    "DEGRADED: real product-listing grid URL + pagination unverified; discovery is sitemap-only. Likely Cloudflare. Specs are in prose/bullets, not a table. LIVE 2026-11-08 (VM): sitemap discovery works (6,004 URLs), 5/5 products parsed, 0 blocked; 5700G verified live at 23,400 BDT InStock via JSON-LD. No Cloudflare challenge seen from this VM — but Netlify egress is unproven, keep the degraded flag until a Netlify run confirms.",
  isProductUrl: (u) => u.startsWith("https://pcbstore.com.bd/product/"),
};

export { listProductUrls };

/**
 * parseProduct — shared parser + Next.js gallery merge.
 * The shared parser already collects og/JSON-LD/<img>/link images; this
 * wrapper adds the Next.js-specific sources (/_next/image?url=... decoded,
 * /img/w.../q.../ proxy URLs, image URLs embedded in __NEXT_DATA__/RSC
 * payloads) and re-derives image (primary) from the merged gallery.
 */
export function parseProduct(config, html, url) {
  const product = parseProductShared(config, html, url);
  if (product === null) return null; // not a product page (gate) — drop it
  const nextImages = extractNextJsImages(html, url);
  const images = dedupeImages([...(product.images || []), ...nextImages]);
  return { ...product, images, image: images[0] || null, image_missing: images.length === 0 };
}

// Wire the override into the config so scrapeRetailer / scrape-live use it
// (dispatch added Phase 4: config.parseProduct wins over the shared parser).
config.parseProduct = parseProduct;

export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
