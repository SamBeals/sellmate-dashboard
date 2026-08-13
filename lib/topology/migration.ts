/**
 * Migration path from static SLOT_TO_MASK / legacy slot maps to V1 topology.
 *
 * Preserves legacy_slot_id values so existing planogramSlots and vend jobs
 * keep working until a machine is explicitly commissioned/approved.
 *
 * Does NOT rewrite planogramSlots (write-side ownership is unresolved).
 * Cloud owns Firestore writes; this module builds local JSON for review.
 */

import { LEGACY_SLOT_TO_HW, type LegacyHwConfig } from "./mapping";
import {
  SCHEMA_VERSION,
  newId,
  utcNowIso,
  type SensingSnapshot,
  type TopologyPosition,
  type TopologyRevision,
  type TopologyShelf,
} from "./schemas";

export type MigrateLegacyOptions = {
  machineId: string;
  legacyMap?: Record<string, LegacyHwConfig>;
  shelfId?: string;
  shelfLabel?: string;
  sensing?: SensingSnapshot;
  i2cBus?: string | null;
  i2cAddress?: string | null;
  /** Default proposed — activation requires explicit approval elsewhere. */
  status?: "proposed" | "active";
  revisionId?: string;
};

/**
 * Build a topology revision from the static legacy slot table.
 *
 * Positions are ordered by legacy slot number left-to-right on a single
 * shelf. Technician confirmation is still required before activation unless
 * a separate tooling path marks the revision active after review.
 */
export function migrateLegacySlotsToTopology(
  options: MigrateLegacyOptions
): TopologyRevision {
  const {
    machineId,
    legacyMap = LEGACY_SLOT_TO_HW,
    shelfId = "shelf_1",
    shelfLabel = "Shelf 1",
    sensing,
    i2cBus = null,
    i2cAddress = null,
    status = "proposed",
    revisionId,
  } = options;

  const now = utcNowIso();
  const positions: TopologyPosition[] = [];

  for (const [columnIndex, slotId] of Object.entries(legacyMap)
    .map(([id]) => id)
    .sort()
    .entries()) {
    const cfg = legacyMap[slotId];
    const bank = String(cfg.bank).toUpperCase();
    const mask = Number(cfg.mask);
    positions.push({
      position_id: `pos_${slotId.toLowerCase()}`,
      shelf_id: shelfId,
      column_index: columnIndex,
      label: slotId,
      legacy_slot_id: slotId,
      hardware: {
        bank,
        mask,
        controller: "mcp23017",
        i2c_bus: i2cBus,
        i2c_address: i2cAddress,
      },
      capabilities: ["motor_lane"],
      validation_status: "skipped",
      present: true,
    });
  }

  const shelf: TopologyShelf = {
    shelf_id: shelfId,
    row_index: 0,
    label: shelfLabel,
    positions,
  };

  return {
    schema_version: SCHEMA_VERSION,
    revision_id: revisionId ?? newId("rev"),
    machine_id: machineId,
    status,
    shelves: [shelf],
    sensing: sensing ?? {
      tof_available: false,
      preferred_verification: "none",
    },
    created_at: now,
    updated_at: now,
    migration_from_legacy: true,
    approved_at: status === "active" ? now : null,
    approved_by: status === "active" ? "migration_tool" : null,
  };
}

/**
 * Summarize how a proposed layout would affect existing planogram slot IDs.
 * Used when re-discovery finds changes on a machine with assignments.
 */
export function assessPlanogramImpact(args: {
  existingLegacySlotIds: string[];
  proposed: TopologyRevision;
  active?: TopologyRevision | null;
}): import("./schemas").PlanogramImpact {
  const existing = new Set(
    args.existingLegacySlotIds.map((s) => s.trim().toUpperCase()).filter(Boolean)
  );
  const proposedSlots = new Set<string>();
  const added: string[] = [];

  for (const shelf of args.proposed.shelves ?? []) {
    for (const position of shelf.positions ?? []) {
      if (position.legacy_slot_id) {
        const id = position.legacy_slot_id.toUpperCase();
        proposedSlots.add(id);
      } else {
        added.push(position.position_id);
      }
    }
  }

  const preserved: string[] = [];
  const removed: string[] = [];
  for (const slot of existing) {
    if (proposedSlots.has(slot)) preserved.push(slot);
    else removed.push(slot);
  }
  for (const slot of proposedSlots) {
    if (!existing.has(slot)) added.push(slot);
  }

  const destructive = removed.length > 0;
  const warnings: string[] = [];
  if (destructive) {
    warnings.push(
      "Proposed topology removes legacy slots that may have planogram assignments. Activation is blocked until reviewed."
    );
  }

  return {
    has_existing_planogram: existing.size > 0,
    destructive,
    preserved_legacy_slot_ids: preserved.sort(),
    ambiguous_legacy_slot_ids: [],
    removed_legacy_slot_ids: removed.sort(),
    added_position_ids: added,
    warnings,
  };
}
