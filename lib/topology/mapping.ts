/**
 * Legacy slot ID ↔ topology position compatibility mapping.
 *
 * Existing vend jobs and planogramSlots use legacy IDs like S01. Until a
 * machine is migrated to an approved topology, those IDs remain the
 * operational keys. After migration, legacy_slot_id on each position
 * preserves planogram continuity.
 */

import {
  allPositions,
  type TopologyPosition,
  type TopologyRevision,
} from "./schemas";

/** Static V1 fallback used before commissioning (mirrors sellmate-pi / cloud). */
export const LEGACY_SLOT_TO_HW: Record<
  string,
  { bank: string; mask: number }
> = {
  S01: { bank: "A", mask: 1 },
  S02: { bank: "A", mask: 2 },
  S03: { bank: "A", mask: 4 },
  S04: { bank: "A", mask: 8 },
  S05: { bank: "A", mask: 16 },
  S06: { bank: "A", mask: 32 },
};

export type LegacySlotMapEntry = {
  slot_id: string;
  position_id: string;
  shelf_id: string;
  bank: string;
  mask: number;
};

export type LegacyHwConfig = {
  bank: string;
  mask: number;
};

export function normalizeLegacySlotId(raw: string): string {
  return (raw || "").trim().toUpperCase();
}

export function hwKey(bank: string, mask: number): string {
  return `${(bank || "A").trim().toUpperCase()}:${Number(mask)}`;
}

export function legacySlotForHw(
  bank: string,
  mask: number,
  legacyMap: Record<string, LegacyHwConfig> = LEGACY_SLOT_TO_HW
): string | null {
  const target = hwKey(bank, mask);
  for (const [slotId, cfg] of Object.entries(legacyMap)) {
    if (hwKey(cfg.bank, cfg.mask) === target) {
      return normalizeLegacySlotId(slotId);
    }
  }
  return null;
}

export function buildPositionIndexes(revision: TopologyRevision): {
  byLegacy: Record<string, TopologyPosition>;
  byPosition: Record<string, TopologyPosition>;
} {
  const byLegacy: Record<string, TopologyPosition> = {};
  const byPosition: Record<string, TopologyPosition> = {};
  for (const position of allPositions(revision)) {
    byPosition[position.position_id] = position;
    if (position.legacy_slot_id) {
      byLegacy[normalizeLegacySlotId(position.legacy_slot_id)] = position;
    }
  }
  return { byLegacy, byPosition };
}

/**
 * Compatibility map so vend execution can keep using legacy slot IDs
 * until clients migrate to position_ids.
 *
 * Note: bank/mask are technician/runtime fields. Dashboard tooling may build
 * this map locally; merchant UI must not surface raw hardware identifiers.
 */
export function buildLegacySlotMap(
  revision: TopologyRevision
): Record<string, LegacySlotMapEntry> {
  const mapping: Record<string, LegacySlotMapEntry> = {};
  for (const position of allPositions(revision)) {
    if (!position.legacy_slot_id || !position.hardware) continue;
    const slotId = normalizeLegacySlotId(position.legacy_slot_id);
    mapping[slotId] = {
      slot_id: slotId,
      position_id: position.position_id,
      shelf_id: position.shelf_id,
      bank: position.hardware.bank.toUpperCase(),
      mask: Number(position.hardware.mask),
    };
  }
  return mapping;
}

/**
 * Resolve a catalog/vend identifier to the legacy slot ID used by planogram.
 */
export function resolveDisplaySlot(
  slotOrPositionId: string,
  activeRevision: TopologyRevision | null | undefined
): string {
  const raw = (slotOrPositionId || "").trim();
  if (!raw) return "";
  if (!activeRevision || activeRevision.status !== "active") {
    return normalizeLegacySlotId(raw);
  }

  const { byLegacy, byPosition } = buildPositionIndexes(activeRevision);
  const legacyId = normalizeLegacySlotId(raw);
  if (byLegacy[legacyId]) return legacyId;
  const position = byPosition[raw];
  if (position?.legacy_slot_id) {
    return normalizeLegacySlotId(position.legacy_slot_id);
  }
  return legacyId || raw;
}

/**
 * Resolve vend identifier → bank/mask using active topology or static legacy.
 * Used by migration/compat tooling; not for merchant display.
 */
export function resolveHw(
  slotOrPositionId: string,
  activeRevision?: TopologyRevision | null,
  legacyMap: Record<string, LegacyHwConfig> = LEGACY_SLOT_TO_HW
): {
  slot_id: string;
  position_id: string | null;
  legacy_slot_id: string | null;
  bank: string;
  mask: number;
  source: "active_topology" | "legacy_static";
} {
  const raw = (slotOrPositionId || "").trim();
  if (!raw) {
    throw new Error("Empty slot_id");
  }

  if (activeRevision && activeRevision.status === "active") {
    const { byLegacy, byPosition } = buildPositionIndexes(activeRevision);
    const legacyId = normalizeLegacySlotId(raw);
    const position = byLegacy[legacyId] ?? byPosition[raw];
    if (position?.hardware) {
      return {
        slot_id: position.legacy_slot_id
          ? normalizeLegacySlotId(position.legacy_slot_id)
          : position.position_id,
        position_id: position.position_id,
        legacy_slot_id: position.legacy_slot_id ?? null,
        bank: position.hardware.bank.toUpperCase(),
        mask: Number(position.hardware.mask),
        source: "active_topology",
      };
    }
  }

  const sid = normalizeLegacySlotId(raw);
  const cfg = legacyMap[sid];
  if (!cfg) {
    throw new Error(
      `Unknown slot_id '${slotOrPositionId}' (no active topology and no legacy mapping)`
    );
  }
  return {
    slot_id: sid,
    position_id: null,
    legacy_slot_id: sid,
    bank: String(cfg.bank).toUpperCase(),
    mask: Number(cfg.mask),
    source: "legacy_static",
  };
}

export function planogramSlotCompatRows(
  revision: TopologyRevision
): Array<{
  slot_id: string;
  position_id: string;
  shelf_id: string;
  column_index: number;
  label: string;
  legacy_slot_id?: string | null;
  enabled: boolean;
  topology_revision_id: string;
}> {
  return allPositions(revision).map((position) => {
    const slotId = position.legacy_slot_id || position.position_id;
    return {
      slot_id: position.legacy_slot_id
        ? normalizeLegacySlotId(slotId)
        : slotId,
      position_id: position.position_id,
      shelf_id: position.shelf_id,
      column_index: position.column_index,
      label: position.label,
      legacy_slot_id: position.legacy_slot_id ?? null,
      enabled: true,
      topology_revision_id: revision.revision_id,
    };
  });
}
