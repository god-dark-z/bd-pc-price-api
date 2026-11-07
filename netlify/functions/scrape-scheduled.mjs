/**
 * scrape-scheduled.mjs — Netlify Scheduled Function.
 *
 * SCHEDULE (the single source of truth): netlify.toml
 *   [functions."scrape-scheduled"]  schedule = "20 18 * * *"
 * That is ONCE A DAY at 18:20 UTC = 00:20 midnight Dhaka (the 00:20 test
 * time — change netlify.toml back to "0 18 * * *" for the daily midnight
 * refresh after testing). To change the
 * hour, edit netlify.toml ONLY — this file has no schedule of its own.
 *
 * Scheduled functions have a 30-SECOND limit, so this function does NO
 * scraping itself: it triggers ONE background job PER RETAILER (all 10),
 * each with a 15-minute limit. The background jobs do the scraping and
 * atomically replace each retailer's data in Netlify Blobs; a retailer
 * whose scrape fails keeps yesterday's data (see src/lib/store.js).
 *
 * Requires env var SCRAPE_SECRET (any random string) — the background
 * function only accepts calls carrying it, so strangers cannot trigger
 * scrapes against the retailers from your URL.
 */
import { getStore } from "@netlify/blobs";
import { RETAILERS } from "../../src/scrapers/index.js";
import { emptyStatus, updateStatus, writeStatus, STATUS_KEY } from "../../src/lib/store.js";

async function handler() {
  const store = getStore("products");
  const started = new Date().toISOString();
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";

  // Record the attempt in the status blob so GET /api/status can report
  // that a refresh was kicked off, even before any retailer finishes.
  let status = emptyStatus();
  try {
    status = (await store.get(STATUS_KEY, { type: "json" })) || emptyStatus();
  } catch {
    status = emptyStatus();
  }
  status.last_attempt = started;
  for (const r of RETAILERS) {
    status = updateStatus(status, r.id, { status: "queued", products: status.per_retailer?.[r.id]?.products ?? 0, last_scrape: status.per_retailer?.[r.id]?.last_scrape || started });
  }
  try {
    await store.setJSON(STATUS_KEY, status);
  } catch (e) {
    console.log(`[scheduled] could not write status blob: ${e.message}`);
  }

  if (!siteUrl) {
    console.log("[scheduled] no site URL configured — background triggers skipped; retailers left queued in status");
    return new Response("queued (no site URL)", { status: 200 });
  }

  // Background functions are invoked by POSTing to the -background endpoint.
  // They answer 202 immediately, so all 10 triggers fit in the 30s limit.
  const triggered = [];
  const failed = [];
  for (const retailer of RETAILERS) {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/scrape-background-background`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-scrape-secret": process.env.SCRAPE_SECRET || "",
        },
        body: JSON.stringify({ retailer: retailer.id }),
      });
      console.log(`[scheduled] triggered ${retailer.id}: background responded ${res.status}`);
      if (res.status >= 200 && res.status < 300) triggered.push(retailer.id);
      else failed.push({ retailer: retailer.id, status: res.status });
    } catch (e) {
      console.log(`[scheduled] trigger failed for ${retailer.id}: ${e.message}`);
      failed.push({ retailer: retailer.id, error: String(e.message || e) });
    }
  }
  console.log(`[scheduled] refresh ${started}: triggered ${triggered.length}/10 retailers${failed.length ? `, ${failed.length} trigger failures` : ""}`);
  // A trigger failure must not leave the retailer with no status entry:
  // record it as "failed" in the status blob so GET /api/status shows
  // the retailer never started (instead of silently staying "queued").
  if (failed.length > 0) {
    try {
      let failedStatus = (await store.get(STATUS_KEY, { type: "json" })) || status;
      for (const f of failed) {
        const reason = f.error || `background responded HTTP ${f.status}`;
        failedStatus = updateStatus(failedStatus, f.retailer, {
          status: "failed",
          products: failedStatus.per_retailer?.[f.retailer]?.products ?? 0,
          error: `trigger failed: ${reason}`,
        });
      }
      await writeStatus(store, failedStatus);
    } catch (e) {
      console.log(`[scheduled] could not write trigger-failure status: ${e.message}`);
    }
  }
  return new Response(JSON.stringify({ triggered, failed, at: started }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export default handler;
// NOTE: no `export const config = { schedule: ... }` here on purpose —
// the schedule lives in netlify.toml ([functions."scrape-scheduled"])
// so there is exactly one place to change the refresh time.
