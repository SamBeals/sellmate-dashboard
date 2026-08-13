#!/usr/bin/env npx tsx
/**
 * Migrate static legacy SLOT_TO_MASK definitions into a V1 topology revision.
 *
 * Dashboard-side helper for FEATURE-013. Prints proposed (default) or active
 * topology JSON plus planogramSlots-compatible rows. Does not access secrets
 * and does not rewrite planogramSlots (write-side ownership is unresolved;
 * cloud owns activation writes).
 *
 * Usage:
 *   npx tsx scripts/migrate_legacy_topology.ts --machine-id machine_test
 *   npx tsx scripts/migrate_legacy_topology.ts --machine-id machine_test --activate --print-planogram-rows
 */

import {
  migrateLegacySlotsToTopology,
  planogramSlotCompatRows,
  toVendorSafeTopology,
} from "../lib/topology";

function parseArgs(argv: string[]) {
  const out: {
    machineId?: string;
    activate: boolean;
    printPlanogramRows: boolean;
    vendorSafe: boolean;
  } = {
    activate: false,
    printPlanogramRows: false,
    vendorSafe: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--machine-id") {
      out.machineId = argv[++i];
    } else if (arg === "--activate") {
      out.activate = true;
    } else if (arg === "--print-planogram-rows") {
      out.printPlanogramRows = true;
    } else if (arg === "--vendor-safe") {
      out.vendorSafe = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: migrate_legacy_topology.ts --machine-id <id> [--activate] [--print-planogram-rows] [--vendor-safe]`);
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.machineId) {
    console.error("--machine-id is required");
    process.exit(2);
  }

  const revision = migrateLegacySlotsToTopology({
    machineId: args.machineId,
    status: args.activate ? "active" : "proposed",
  });

  const payload = args.vendorSafe
    ? toVendorSafeTopology(revision)
    : revision;

  if (args.printPlanogramRows) {
    console.log(
      JSON.stringify(
        {
          topology: payload,
          planogram_compat_rows: planogramSlotCompatRows(revision),
          note: "planogramSlots are not rewritten by this tool; cloud owns writes.",
        },
        null,
        2
      )
    );
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

main();
