#!/usr/bin/env node
/**
 * run-scrape.mjs — CLI runner for the BD PC scraper.
 * Usage:
 *   node scripts/run-scrape.mjs --retailer startech --limit 20
 *   node scripts/run-scrape.mjs --retailer all --limit 100
 *   node scripts/run-scrape.mjs --retailer all --dry-run --limit 3
 *   node scripts/run-scrape.mjs --retailer startech --out data
 *
 * --dry-run parses the bundled offline fixtures instead of fetching live
 * pages, so the pipeline can be tested without hitting any retailer.
 * Output: data/<retailer>.json + data/index.json + data/status.json
 * (+ stats printed to stdout).
 * Every product is validated before it is written (see normalize.js), and
 * the same guards as the Netlify background function are applied:
 * day-over-day jumps (>50% vs the previous data/<retailer>.json) are
 * flagged, and cross-retailer outliers (>10x the peer median for the same
 * model_key) are flagged and excluded from lowest/highest.
 * A run that produces 0 publishable products for a retailer does NOT
 * overwrite that retailer's previous file (keep-yesterday rule).
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RETAILERS, getRetailer } from "../src/scrapers/index.js";
import { scrapeRetailer, parseProduct } from "../src/scrapers/opencart.js";
import { isPublishable } from "../src/lib/normalize.js";
import { applyCrossRetailerOutliers } from "../src/lib/price.js";
import { applyDayOverDayFlags } from "../src/lib/store.js";
import { readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { retailer: "all", limit: 50, dryRun: false, out: "data" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--retailer") args.retailer = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

async function dryRunRetailer(config, limit) {
  // Offline fixtures live in tests/fixtures/ — one product page per retailer
  // where available, plus the shared OpenCart fixture. This exercises the
  // full parse -> normalise -> validate path without any network call.
  const started = new Date().toISOString();
  const items = [];
  const errors = [];
  const fixturePath = join(ROOT, "tests", "fixtures", `${config.id}.html`);
  let html;
  try {
    html = readFileSync(fixturePath, "utf8");
  } catch {
    html = readFileSync(join(ROOT, "tests", "fixtures", "opencart-product.html"), "utf8");
  }
  const urls = [
    `https://example.invalid/${config.id}-sample-1`,
    `https://example.invalid/${config.id}-sample-2`,
  ].slice(0, Math.min(limit, 2));
  for (const url of urls) {
    try {
      // Honour an adapter's parseProduct override (same dispatch as
      // scrapeRetailer) so dry-run fixtures exercise custom parsers.
      const parse = typeof config.parseProduct === "function" ? config.parseProduct : parseProduct;
      const product = parse(config, html, config.baseUrl + "/sample-product");
      if (product === null) continue; // fixture is not a product page — dropped
      // Fixture URLs are example.invalid by design in dry-run; keep the
      // retailer's real base so validation of the URL shape is meaningful.
      product.url = `${config.baseUrl}/sample-product`;
      items.push(product);
    } catch (e) {
      errors.push({ url, error: String(e.message || e) });
    }
  }
  return {
    retailer_id: config.id,
    retailer: config.name,
    started,
    finished: new Date().toISOString(),
    urls_found: items.length,
    products: items.length,
    blocked: 0,
    dry_run: true,
    errors,
    items,
  };
}

async function readPrevious(outDir, retailerId) {
  try {
    return JSON.parse(await readFile(join(outDir, `${retailerId}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets =
    args.retailer === "all" ? RETAILERS : [getRetailer(args.retailer)];
  const outDir = join(ROOT, args.out);
  await mkdir(outDir, { recursive: true });

  const index = { generated_at: new Date().toISOString(), retailers: {} };
  const collected = [];
  let total = 0;
  let totalPublishable = 0;

  for (const config of targets) {
    console.log(`\n[${config.id}] ${config.name}${config.degraded ? " (DEGRADED — see adapter notes)" : ""}`);
    const result = args.dryRun
      ? await dryRunRetailer(config, args.limit)
      : await scrapeRetailer(config, { limit: args.limit });
    const publishable = result.items.filter(isPublishable);
    // Dropped = non-product pages (gate) + parsed-but-unpublishable items.
    const dropped = (result.dropped || 0) + (result.items.length - publishable.length);
    console.log(
      `  urls found: ${result.urls_found}, parsed: ${result.items.length}, publishable: ${publishable.length}, dropped: ${dropped}, blocked: ${result.blocked}, errors: ${result.errors.length}`
    );
    for (const e of result.errors.slice(0, 5)) console.log(`  error: ${e.url} — ${e.error}`);
    for (const d of (result.discovery_errors || []).slice(0, 5)) console.log(`  discovery: ${d.url} — ${d.error}`);
    for (const p of publishable.slice(0, 3)) {
      console.log(`  sample: ${p.name} — ৳${p.price ?? "no price"}${p.regular_price ? ` (was ৳${p.regular_price}, -${p.savings_pct}%)` : ""} [${p.stock}]`);
    }
    collected.push({ config, result, publishable, dropped, previous: await readPrevious(outDir, config.id) });
    total += result.items.length;
    totalPublishable += publishable.length;
  }

  // Guards (same as the Netlify background function):
  // 1. cross-retailer outliers across everything scraped in this run;
  // 2. day-over-day jumps vs each retailer's previous file on disk.
  const allFlagged = applyCrossRetailerOutliers(collected.flatMap((c) => c.publishable));
  const byUrl = new Map(allFlagged.items.map((p) => [p.url, p]));
  let totalJumps = 0;
  for (const entry of collected) {
    entry.publishable = entry.publishable.map((p) => byUrl.get(p.url) || p);
    const { items, flagged } = applyDayOverDayFlags(entry.publishable, entry.previous?.items || []);
    entry.publishable = items;
    totalJumps += flagged.length;
    for (const f of flagged) console.log(`  day-over-day flag: ${f.url} ${f.old_price} -> ${f.new_price} (${f.change_pct}%)`);
  }
  for (const f of allFlagged.flagged) {
    console.log(`  cross-retailer outlier flag: ${f.retailer_id} ${f.url} price ${f.price} vs peer median ${f.peer_median}`);
  }

  // Write files. Keep-yesterday rule: a retailer with 0 publishable
  // products does NOT overwrite its previous file.
  const status = {
    last_refresh: new Date().toISOString(),
    last_attempt: new Date().toISOString(),
    refresh_schedule: "20 18 * * *",
    refresh_schedule_human: "daily at 18:20 UTC (= 00:20 Dhaka)",
    total_products: 0,
    per_retailer: {},
    failures: [],
  };
  for (const entry of collected) {
    const { config, result, publishable, dropped } = entry;
    if (publishable.length === 0) {
      const kept = entry.previous?.products ?? entry.previous?.items?.length ?? 0;
      console.log(`  [${config.id}] 0 publishable — keeping previous file (${kept} products)`);
      status.per_retailer[config.id] = {
        status: "failed",
        products: kept,
        last_scrape: entry.previous?.finished || null,
        error: `0 publishable products in this run (${result.urls_found ?? 0} URLs found, ${dropped} dropped)${(result.discovery_errors || []).length ? ` — discovery: ${(result.discovery_errors || []).slice(0, 3).map((d) => `${d.url} (${d.error})`).join("; ")}` : ""} — previous data kept`,
      };
      status.failures.push({ retailer_id: config.id, error: "0 publishable products in this run" });
      index.retailers[config.id] = { name: config.name, products: kept, dropped, blocked: result.blocked, errors: result.errors.length, finished: result.finished, kept_previous: true };
      continue;
    }
    const file = join(outDir, `${config.id}.json`);
    await writeFile(file, JSON.stringify({ ...result, products: publishable.length, items: publishable }, null, 2));
    console.log(`  wrote ${file}`);
    index.retailers[config.id] = {
      name: config.name,
      products: publishable.length,
      dropped,
      blocked: result.blocked,
      errors: result.errors.length,
      finished: result.finished,
      file: `${config.id}.json`,
    };
    status.per_retailer[config.id] = { status: "ok", products: publishable.length, last_scrape: result.finished, error: null };
    status.total_products += publishable.length;
  }

  index.total_products = totalPublishable;
  index.total_parsed = total;
  index.outlier_flagged = allFlagged.flagged.length;
  index.day_over_day_flagged = totalJumps;
  await writeFile(join(outDir, "index.json"), JSON.stringify(index, null, 2));
  await writeFile(join(outDir, "status.json"), JSON.stringify(status, null, 2));
  console.log(`\nDone. Total publishable products: ${totalPublishable} (parsed ${total}). Outlier-flagged: ${allFlagged.flagged.length}, day-over-day jumps flagged: ${totalJumps}. Index: ${join(outDir, "index.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
