/**
 * price.js — BDT price parsing + savings rules.
 *
 * RESEARCH RULES (do not weaken):
 * - Listing cards show the OFFER price FIRST, regular/old price SECOND.
 * - NEVER trust the site's "Save:" field (Techland's is wrong on some
 *   cards: 39,000 - 36,300 = 2,700, but the card said "Save: 1,000").
 *   Always compute savings from the two prices.
 * - Price 0 / 0৳ means no price / out of stock / call-for-price — never a
 *   ৳0 deal. Return null for a zero price.
 * - Savings above 80% are invalid (the ৳800-shown-as-৳1,00,000 / -94%
 *   bug class). Such products are flagged, never published as a deal.
 * - OUT-OF-STOCK RULE: an out-of-stock product's price is never a buyable
 *   price. It is stored as last_seen_price (see normalize.js) and must
 *   never appear as the cheapest/lowest-price option (see
 *   eligibleForLowest / computeLowestHighest below).
 * - ABSURD-PRICE GUARD: any price above 1,000,000 BDT for a component
 *   that is not a full-PC / GPU-flagship class is flagged, and any price
 *   more than 10x the same model_key's price at other retailers in the
 *   same scrape is flagged (applyCrossRetailerOutliers). Flagged prices
 *   are excluded from lowest/highest calculations until verified.
 * - DAY-OVER-DAY JUMP FLAG: a price move of more than 50% up or down
 *   versus yesterday's stored price is flagged in conflicts[] (see
 *   src/lib/store.js applyDayOverDayFlags) — never silently accepted.
 */

// Matches amounts like: 20,600৳ | ৳20,600 | Tk 20,600 | 20500.00 BDT | 20,600
const AMOUNT_RE = /(?:৳|Tk\.?|BDT)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:৳|BDT)?/;

/** Absolute ceiling for a single PC component that is not a flagship/full PC. */
export const MAX_PLAUSIBLE_COMPONENT_PRICE = 1_000_000;
/** Cross-retailer outlier factor: price > 10x the peer median is flagged. */
export const CROSS_RETAILER_OUTLIER_FACTOR = 10;
/** Day-over-day jump that must be flagged (in either direction). */
export const DAY_OVER_DAY_JUMP_PCT = 50;

/**
 * Parse one BDT amount from a string. Returns an integer number of taka,
 * or null when there is no usable amount (including 0).
 * @param {string|number|null|undefined} raw
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  const text = String(raw).replace(/\u00a0/g, " ").trim();
  if (!text) return null;
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Parse every BDT amount in a string, in order. Zero amounts are dropped. */
export function parseAmounts(text) {
  if (!text) return [];
  const out = [];
  const re = /(?:৳|Tk\.?|BDT)?\s*([\d,]{2,}(?:\.\d{1,2})?)\s*(?:৳|BDT)?/g;
  for (const m of String(text).matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n));
  }
  return out;
}

/**
 * Parse a listing-card price pair: [offer, regular]. A single price means
 * offer === that price and regular is null.
 * @param {number[]} amounts amounts in the order they appear on the card
 */
export function pricePair(amounts) {
  if (!amounts || amounts.length === 0) return { price: null, regularPrice: null };
  const price = amounts[0];
  let regularPrice = null;
  if (amounts.length > 1) {
    // The regular price must be >= the offer price; otherwise the pair is
    // reversed / garbage and we keep only the offer price.
    const candidate = Math.max(...amounts.slice(1));
    if (candidate > price) regularPrice = candidate;
  }
  return { price, regularPrice };
}

/** Savings % computed from the two prices. Returns 0 when there is no discount. */
export function savingsPct(price, regularPrice) {
  if (!price || !regularPrice || regularPrice <= price) return 0;
  const pct = ((regularPrice - price) / regularPrice) * 100;
  return Math.round(pct * 10) / 10;
}

/** A discount is only believable up to 80%. Above that, the price pair is bad data. */
export function isPlausibleDiscount(price, regularPrice) {
  if (!price || !regularPrice) return true;
  if (regularPrice <= price) return false;
  return savingsPct(price, regularPrice) <= 80;
}

/**
 * True when the product is a full PC / GPU-flagship class item, for which a
 * price above 1,000,000 BDT is at least conceivable (high-end gaming PC,
 * workstation, RTX 4090/5090-class GPU, Threadripper-class build). Anything
 * else above the ceiling is an absurd price (the ৳800-shown-as-৳1,00,000
 * bug class, or an out-of-stock placeholder price).
 */
export function isFlagshipClass(name, category) {
  const hay = `${name || ""} ${category || ""}`.toLowerCase();
  return (
    /rtx\s*(4090|5090)\b/.test(hay) ||
    /rx\s*7900\s*xtx\b/.test(hay) ||
    /\b(threadripper|xeon|epyc)\b/.test(hay) ||
    /\b(gaming pc|desktop pc|full pc|workstation|server)\b/.test(hay)
  );
}

/** True when the price is absurd for the product class — flag it, never trust it. */
export function isAbsurdPrice(price, name, category) {
  if (!price || !Number.isFinite(price) || price <= 0) return false;
  if (price <= MAX_PLAUSIBLE_COMPONENT_PRICE) return false;
  return !isFlagshipClass(name, category);
}

/**
 * Reconcile the two price sources a product page can give:
 *  - visible: the offer price seen in the page body / listing card
 *  - structured: JSON-LD offers.price or OG product:price:amount
 * On Star Tech and PC House the structured price is the REGULAR price, not
 * the offer price — so when they disagree, the visible offer wins and the
 * disagreement is recorded as a conflict (never silently picked).
 * Returns { price, regularPrice, conflicts[] }.
 */
export function reconcilePrices({ visiblePrice, visibleRegular, structuredPrice, source }) {
  const conflicts = [];
  let price = visiblePrice ?? null;
  let regularPrice = visibleRegular ?? null;

  if (structuredPrice && price && structuredPrice !== price) {
    if (!regularPrice) {
      // Structured price is higher: it is almost certainly the regular price.
      if (structuredPrice > price) {
        regularPrice = structuredPrice;
      } else {
        conflicts.push(
          `${source || "structured"} price ${structuredPrice} disagrees with visible price ${price}`
        );
      }
    } else if (structuredPrice !== regularPrice) {
      conflicts.push(
        `${source || "structured"} price ${structuredPrice} disagrees with visible prices ${price}/${regularPrice}`
      );
    }
  }
  if (!price && structuredPrice) price = structuredPrice;

  if (price && regularPrice && !isPlausibleDiscount(price, regularPrice)) {
    if (regularPrice <= price) {
      // No discount at all (e.g. a page that prints "Regular Price: X"
      // equal to the offer price) — not a data error, just drop it silently.
      regularPrice = null;
    } else {
      conflicts.push(
        `implausible discount: price ${price} vs regular ${regularPrice} = ${savingsPct(price, regularPrice)}% savings — possible MRP/offer inversion`
      );
      // Keep the offer price; drop the suspect regular price so no fake -94% deal is ever shown.
      regularPrice = null;
    }
  }
  return { price, regularPrice, conflicts };
}

/**
 * Day-over-day change: percentage move from oldPrice to newPrice, or null
 * when either side is missing. Used by src/lib/store.js — a move of more
 * than DAY_OVER_DAY_JUMP_PCT (50%) in either direction must be flagged.
 */
export function dayOverDayChangePct(oldPrice, newPrice) {
  if (!oldPrice || !newPrice || oldPrice <= 0 || newPrice <= 0) return null;
  return Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10;
}

/**
 * A price is eligible to be shown as the lowest/highest price only when it
 * is a real, buyable, in-stock price that has not been flagged. Out-of-stock
 * products carry their price as last_seen_price (price === null), so they
 * are excluded here even if a caller passes them in with a stale price.
 */
export function eligibleForLowest(product) {
  if (!product || product.price === null || product.price === undefined) return false;
  if (product.stock !== "in_stock") return false;
  if (product.price_flagged) return false;
  if (product.price <= 0) return false;
  return true;
}

/** Lowest/highest across the ELIGIBLE prices only. Returns nulls when none qualify. */
export function computeLowestHighest(products) {
  const eligible = (products || []).filter(eligibleForLowest).map((p) => p.price);
  if (!eligible.length) return { lowest_price: null, highest_price: null, eligible_count: 0 };
  return {
    lowest_price: Math.min(...eligible),
    highest_price: Math.max(...eligible),
    eligible_count: eligible.length,
  };
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Cross-retailer outlier check (run on a whole scrape, before publishing).
 * Groups products by model_key; for each product with a buyable price,
 * compares it against the median price of the SAME model_key at OTHER
 * retailers. A price more than CROSS_RETAILER_OUTLIER_FACTOR (10x) above
 * that peer median is flagged: price_flagged = true, a conflict is added,
 * and the price is logged to `flagged` for the caller to report. The price
 * itself is kept (it may be a genuine rare variant) but it is excluded
 * from lowest/highest by eligibleForLowest until verified.
 * Needs at least 2 peer prices to judge — a single peer is not enough
 * evidence to flag. Returns { items, flagged } where `items` are shallow
 * copies with flags applied and `flagged` is the list of flagged prices.
 */
export function applyCrossRetailerOutliers(products) {
  const items = (products || []).map((p) => ({ ...p, conflicts: [...(p.conflicts || [])] }));
  const byModel = new Map();
  for (const p of items) {
    if (!p.model_key || p.price === null || p.price === undefined || p.stock !== "in_stock") continue;
    if (!byModel.has(p.model_key)) byModel.set(p.model_key, []);
    byModel.get(p.model_key).push(p);
  }
  const flagged = [];
  for (const p of items) {
    if (!p.model_key || p.price === null || p.price === undefined || p.stock !== "in_stock") continue;
    const peers = (byModel.get(p.model_key) || [])
      .filter((q) => q.retailer_id !== p.retailer_id && q.price)
      .map((q) => q.price);
    if (peers.length < 2) continue;
    const peerMedian = median(peers);
    if (peerMedian > 0 && p.price > CROSS_RETAILER_OUTLIER_FACTOR * peerMedian) {
      p.price_flagged = true;
      const msg = `cross-retailer outlier: price ${p.price} is more than ${CROSS_RETAILER_OUTLIER_FACTOR}x the peer median ${peerMedian} for ${p.model_key} — excluded from lowest/highest until verified`;
      if (!p.conflicts.includes(msg)) p.conflicts.push(msg);
      flagged.push({ retailer_id: p.retailer_id, url: p.url, model_key: p.model_key, price: p.price, peer_median: peerMedian, reason: "cross_retailer_outlier_10x" });
      console.warn(`[price-guard] ${msg} (${p.retailer_id} ${p.url})`);
    }
  }
  return { items, flagged };
}
