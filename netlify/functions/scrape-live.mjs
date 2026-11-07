/**
 * scrape-live.mjs — MANUAL ADMIN FUNCTION ONLY. NOT PART OF THE PUBLIC API.
 * ==========================================================================
 * ⚠️  THE WEBSITE MUST NEVER CALL THIS FUNCTION. ⚠️
 * The public API (netlify/functions/api.mjs) serves ONLY stored scraped
 * data, refreshed once a day at 18:00 UTC. This function fetches ONE
 * product page LIVE from a retailer on every call. It exists solely so a
 * human admin can spot-check a single product while debugging a scraper.
 * Calling it from the website would hammer retailers on every page view,
 * bypass every price guard, and get the site rate-limited/blocked.
 * If you are Mistral / the frontend: DO NOT use this endpoint. Use
 * GET /api/search and GET /api/product (see API_DOCUMENTATION.md).
 * ==========================================================================
 *
 * GET /.netlify/functions/scrape-live?url=<product-url>&retailer=<id>
 * Fetches ONE product page, parses it with the retailer's adapter, and
 * returns the normalised product. Guarded by a 25s internal timeout so
 * the 60s synchronous-function limit is never hit, and by SCRAPE_SECRET
 * (when set, the x-scrape-secret header is required — same secret as the
 * background scrape function).
 *
 * It is NOT a catalogue scrape — use the scheduled/background flow for that.
 */
import { fetchText } from "../../src/lib/http.js";
import { getRetailer } from "../../src/scrapers/index.js";
import { parseProduct } from "../../src/scrapers/opencart.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req) => {
  if (process.env.SCRAPE_SECRET) {
    const secret = req.headers.get("x-scrape-secret");
    if (secret !== process.env.SCRAPE_SECRET) {
      return json(
        { error: "admin function — requires the x-scrape-secret header (see README). The website must use /api/search and /api/product instead." },
        401
      );
    }
  }
  const url = new URL(req.url);
  const productUrl = url.searchParams.get("url");
  const retailerId = url.searchParams.get("retailer");
  if (!productUrl || !retailerId) {
    return json({ error: "usage: ?url=<product-url>&retailer=<id>" }, 400);
  }
  let config;
  try {
    config = getRetailer(retailerId);
  } catch (e) {
    return json({ error: String(e.message) }, 400);
  }
  if (!productUrl.startsWith(config.baseUrl)) {
    return json({ error: `url must belong to ${config.name} (${config.baseUrl})` }, 400);
  }
  const res = await fetchText(productUrl, { delayMs: 500, timeoutMs: 25000, retries: 1 });
  if (!res.ok) {
    return json(
      {
        error: res.blocked
          ? "retailer returned a bot challenge page — live check blocked, try again later"
          : `fetch failed: ${res.error || `HTTP ${res.status}`}`,
        blocked: res.blocked,
      },
      res.blocked ? 503 : 502
    );
  }
  const product = parseProduct(config, res.html, productUrl);
  if (product === null) {
    return json(
      { error: `not a product page — no JSON-LD Product offers / og:type=product / og product price found at ${productUrl} (category or guide page, dropped)` },
      404
    );
  }
  return json({ ...product, _admin_live_check: true, _warning: "manual admin live check — NOT the public API; the website must use /api/product instead" });
};
