/**
 * Registry of all retailer adapters (Tier 1 + Tier 2 + Tier 3).
 * Order = recommended scrape order (Star Tech first — the proof-of-concept).
 * Tier 1 entries (startech…onix) are first, in their original order;
 * Tier 2 + Tier 3 adapters (Phase 3, 2026-11-08) are appended after them.
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
// Tier 2 (Phase 3)
import computervillage from "./computervillage.js";
import skyland from "./skyland.js";
import computermania from "./computermania.js";
import nexus from "./nexus.js";
import dolphin from "./dolphin.js";
import creatus from "./creatus.js";
import potakait from "./potakait.js";
import binarylogic from "./binarylogic.js";
import computersource from "./computersource.js";
import flora from "./flora.js";
// Tier 3 (Phase 3)
import globalbrand from "./globalbrand.js";
import ucc from "./ucc.js";
import smartbd from "./smartbd.js";
import itsource from "./itsource.js";
// Tier 4 — found by research beyond the original 24 (Phase 4, 2026-11-08)
import drm from "./drm.js";
import syscomputers from "./syscomputers.js";
import ava from "./ava.js";

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
  // Tier 2
  computervillage,
  skyland,
  computermania,
  nexus,
  dolphin,
  creatus,
  potakait,
  binarylogic,
  computersource,
  flora,
  // Tier 3
  globalbrand,
  ucc,
  smartbd,
  itsource,
  // Tier 4 — found by research beyond the original 24 (Phase 4)
  drm,
  syscomputers,
  ava,
];

export const RETAILER_MAP = Object.fromEntries(RETAILERS.map((r) => [r.id, r]));

export function getRetailer(id) {
  const r = RETAILER_MAP[id];
  if (!r) throw new Error(`unknown retailer id: ${id} (known: ${RETAILERS.map((x) => x.id).join(", ")})`);
  return r;
}

export default RETAILERS;
