/**
 * Registry of all Tier-1 retailer adapters.
 * Order = recommended scrape order (Star Tech first — the proof-of-concept).
 */
import startech from "./startech.js";
import ryans from "./ryans.js";
import techland from "./techland.js";
import pcbstore from "./pcbstore.js";
import ultra from "./ultra.js";
import pchouse from "./pchouse.js";
import selltech from "./selltech.js";
import speedtech from "./speedtech.js";
import indexit from "./indexit.js";
import onix from "./onix.js";

export const RETAILERS = [
  startech,
  ryans,
  techland,
  pcbstore,
  ultra,
  pchouse,
  selltech,
  speedtech,
  indexit,
  onix,
];

export const RETAILER_MAP = Object.fromEntries(RETAILERS.map((r) => [r.id, r]));

export function getRetailer(id) {
  const r = RETAILER_MAP[id];
  if (!r) throw new Error(`unknown retailer id: ${id} (known: ${RETAILERS.map((x) => x.id).join(", ")})`);
  return r;
}

export default RETAILERS;
