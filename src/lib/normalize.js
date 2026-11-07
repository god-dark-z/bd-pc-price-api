/**
 * normalize.js — the one normalised product schema every adapter must return.
 *
 * Dedupe rule (research): dedupe by product URL, NEVER by name alone.
 * Duplicate SKUs exist for the same chip (boxed vs tray Ryzen 7 5700G),
 * so model_key is only a search/grouping aid, not an identity.
 *
 * MANDATORY FIELDS (every adapter returns all of these; null where a site
 * genuinely does not expose a value — never invent one):
 *   name, url, image, images[], description, specifications (specs),
 *   price, regular_price, stock, retailer, retailer_id, brand, category,
 *   model_key, last_checked, price_sources[], conflicts[]
 * plus the guard fields:
 *   savings_pct (computed from price vs regular_price only),
 *   last_seen_price (an out-of-stock product's price lives HERE, never in
 *     `price` — see the OUT-OF-STOCK RULE below),
 *   price_flagged (true when a guard flagged the price — absurd, 10x
 *     cross-retailer outlier; flagged prices are excluded from
 *     lowest/highest by src/lib/price.js eligibleForLowest),
 *   image_missing (true when the page exposed no image at all).
 *
 * OUT-OF-STOCK RULE: if stock is out_of_stock, the product must NEVER
 * appear as the cheapest/lowest-price option and its price must be stored
 * as last_seen_price with the flag `out_of_stock_price_unreliable`.
 * An out-of-stock product showing a huge price is flagged, not trusted.
 */
import { savingsPct, isAbsurdPrice } from "./price.js";

/**
 * Strip the SEO suffix retailers append to page titles — "Price in
 * Bangladesh", "Price in BD", optionally followed by a year or a site
 * name ("… Price in Bangladesh 2026 | Star Tech"). The live 5700G page
 * titles itself "AMD Ryzen 7 5700G Processor Price in Bangladesh", but
 * the product name is "AMD Ryzen 7 5700G Processor" (h1). A trailing
 * bare "in Bangladesh / in BD" is stripped the same way. Only trailing
 * suffixes are touched — "Bangladesh" elsewhere in a name is kept.
 */
export function cleanProductName(name) {
  if (!name) return name;
  let s = String(name).trim();
  s = s.replace(/\s*(?:\||-|–|—)?\s*price in (?:bangladesh|bd)\b.*$/i, "").trim();
  s = s.replace(/\s+in (?:bangladesh|bd)(?:\s+\d{4})?\s*$/i, "").trim();
  s = s.replace(/\s*\|\s*[^|]{1,40}$/, "").trim();
  return s;
}

/**
 * Build a search/grouping key from a product name: lowercase, strip
 * brand filler words and punctuation, collapse spaces. Example:
 * "AMD Ryzen 7 5700G Processor with Radeon Graphics" -> "ryzen 7 5700g"
 */
export function modelKey(name) {
  if (!name) return "";
  let s = cleanProductName(name).toLowerCase();
  s = s.replace(/processor|desktop|graphics card|motherboard|with radeon graphics|with radeon|gaming|am4|am5|lga\d+|ddr\d|\d+\s*cores?|\d+\s*threads?|\bcore\b|\bthread\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return s;
}

/** Brand is usually the first token of the name (AMD, GIGABYTE, ASUS, MSI…). */
export function guessBrand(name) {
  if (!name) return null;
  const first = String(name).trim().split(/\s+/)[0];
  return first ? first.replace(/[^A-Za-z0-9]/g, "") || null : null;
}

/** Dedupe image URLs, keep order, drop empties/non-strings. */
export function dedupeImages(images) {
  const out = [];
  const seen = new Set();
  for (const u of images || []) {
    if (typeof u !== "string") continue;
    const url = u.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Build a normalised product. `input` comes from an adapter's parseProduct.
 * Validation happens here so bad data can never reach the API.
 */
export function normalizeProduct(retailer, input) {
  const conflicts = [...(input.conflicts || [])];
  let price = input.price ?? null;
  let regularPrice = input.regular_price ?? null;
  const stock = ["in_stock", "out_of_stock", "unknown"].includes(input.stock) ? input.stock : "unknown";
  let lastSeenPrice = input.last_seen_price ?? null;
  let priceFlagged = !!input.price_flagged;

  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    conflicts.push(`invalid price ${price} — dropped`);
    price = null;
  }
  if (regularPrice !== null && (!Number.isFinite(regularPrice) || regularPrice <= 0)) {
    conflicts.push(`invalid regular price ${regularPrice} — dropped`);
    regularPrice = null;
  }
  if (!input.url || !/^https?:\/\//.test(input.url)) {
    conflicts.push(`invalid product URL: ${input.url}`);
  }

  // OUT-OF-STOCK RULE: the price is not buyable — move it to
  // last_seen_price, flag it, and leave `price` null so the product can
  // never win a lowest-price comparison.
  if (stock === "out_of_stock" && price !== null) {
    lastSeenPrice = price;
    price = null;
    const msg = `out-of-stock price ${lastSeenPrice} stored as last_seen_price (out_of_stock_price_unreliable) — not a buyable price`;
    if (!conflicts.includes(msg)) conflicts.push(msg);
  }

  // ABSURD-PRICE GUARD: > 1,000,000 BDT for a non-flagship component.
  // The price is kept (it may be a data error worth inspecting) but flagged
  // so lowest/highest calculations exclude it until verified.
  if (price !== null && isAbsurdPrice(price, input.name, input.category)) {
    priceFlagged = true;
    const msg = `absurd price: ${price} BDT exceeds 1,000,000 for a non-flagship component — flagged, excluded from lowest/highest until verified`;
    if (!conflicts.includes(msg)) conflicts.push(msg);
    console.warn(`[price-guard] ${msg} (${input.url})`);
  }

  const savings = savingsPct(price, regularPrice);

  // Gallery: every image the page exposed, deduplicated, absolute.
  // `image` is always images[0] (or the adapter's primary image); when
  // the page exposed none, image is null and image_missing records it.
  const images = dedupeImages([
    ...(input.images || []),
    ...(input.image ? [input.image] : []),
  ]);
  const image = images[0] || null;
  const imageMissing = images.length === 0;

  return {
    retailer: retailer.name,
    retailer_id: retailer.id,
    name: cleanProductName(input.name) || null,
    model_key: modelKey(input.name),
    brand: input.brand || guessBrand(input.name),
    category: input.category || null,
    url: input.url,
    image,
    images,
    image_missing: imageMissing,
    price,
    regular_price: regularPrice,
    last_seen_price: lastSeenPrice,
    price_flagged: priceFlagged,
    savings_pct: savings,
    stock,
    description: input.description || null,
    // `specs` is the grouped key-value specification object; the API
    // documentation calls this field `specifications`.
    specs: input.specs && typeof input.specs === "object" ? input.specs : {},
    specifications: input.specs && typeof input.specs === "object" ? input.specs : {},
    last_checked: input.last_checked || new Date().toISOString(),
    price_sources: input.price_sources || [],
    conflicts,
  };
}

/**
 * A product is publishable only when it has a name, a valid URL, and
 * (at least one price source with a price) OR an explicit out-of-stock
 * status. An in-stock / unknown-stock product with no price is a
 * call-for-price item — it is not published as a priced deal.
 */
export function isPublishable(product) {
  if (!product.name || !product.url) return false;
  if (product.price !== null && product.price !== undefined) return true;
  if (product.stock === "out_of_stock") return true;
  return false;
}
