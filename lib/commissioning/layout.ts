/**
 * Technician layout helpers: reorder / confirm ambiguous physical ordering.
 */

import type { DiscoveredMotor, TopologyPosition } from "@/lib/topology";

export type EditablePosition = TopologyPosition & {
  /** Present on Pi suggested_layout rows; required by /commissioning/propose. */
  discovery_id?: string | null;
};

export type EditableShelf = {
  shelf_id: string;
  row_index: number;
  label: string;
  positions: EditablePosition[];
};

type SuggestedPosition = Partial<EditablePosition> & {
  bank?: string;
  mask?: number;
};

function normalizePosition(
  shelf: { shelf_id: string },
  position: SuggestedPosition,
  columnIndex: number
): EditablePosition {
  const discoveryId =
    typeof position.discovery_id === "string" && position.discovery_id
      ? position.discovery_id
      : undefined;
  const hardware = position.hardware
    ? { ...position.hardware }
    : position.bank != null && position.mask != null
      ? { bank: String(position.bank), mask: Number(position.mask) }
      : position.hardware;

  return {
    position_id:
      position.position_id ||
      discoveryId ||
      `${shelf.shelf_id}_${columnIndex}`,
    shelf_id: position.shelf_id || shelf.shelf_id,
    column_index:
      typeof position.column_index === "number"
        ? position.column_index
        : columnIndex,
    label: position.label || discoveryId || `Column ${columnIndex + 1}`,
    legacy_slot_id: position.legacy_slot_id ?? null,
    hardware: hardware ?? null,
    capabilities: position.capabilities,
    validation_status: position.validation_status,
    present: position.present,
    discovery_id: discoveryId ?? null,
  };
}

export function cloneShelves(
  shelves: Array<{
    shelf_id: string;
    row_index: number;
    label: string;
    positions?: SuggestedPosition[];
  }>
): EditableShelf[] {
  return [...shelves]
    .sort((a, b) => a.row_index - b.row_index)
    .map((shelf) => ({
      shelf_id: shelf.shelf_id,
      row_index: shelf.row_index,
      label: shelf.label,
      positions: [...(shelf.positions ?? [])]
        .sort((a, b) => (a.column_index ?? 0) - (b.column_index ?? 0))
        .map((position, columnIndex) =>
          normalizePosition(shelf, position, columnIndex)
        ),
    }));
}

/** Bind discovery_id rows to motor bank/mask after live discovery. */
export function bindDiscoveryMotors(
  shelves: EditableShelf[],
  motors: DiscoveredMotor[] = []
): EditableShelf[] {
  if (motors.length === 0) return shelves;
  const byId = new Map(motors.map((motor) => [motor.discovery_id, motor]));
  return shelves.map((shelf) => ({
    ...shelf,
    positions: shelf.positions.map((position) => {
      const motor = position.discovery_id
        ? byId.get(position.discovery_id)
        : undefined;
      if (!motor) return position;
      return {
        ...position,
        discovery_id: motor.discovery_id,
        hardware: position.hardware ?? {
          bank: motor.bank,
          mask: motor.mask,
        },
        label: position.label || motor.label_hint || position.label,
        legacy_slot_id: position.legacy_slot_id ?? motor.legacy_slot_hint,
      };
    }),
  }));
}

/** Re-number column_index left-to-right after technician reorder. */
export function renumberColumns(shelves: EditableShelf[]): EditableShelf[] {
  return shelves.map((shelf, rowIndex) => ({
    ...shelf,
    row_index: rowIndex,
    positions: shelf.positions.map((position, columnIndex) => ({
      ...position,
      shelf_id: shelf.shelf_id,
      column_index: columnIndex,
    })),
  }));
}

export function movePosition(
  shelves: EditableShelf[],
  positionId: string,
  direction: "left" | "right"
): EditableShelf[] {
  const next = cloneShelves(shelves);
  for (const shelf of next) {
    const index = shelf.positions.findIndex((p) => p.position_id === positionId);
    if (index < 0) continue;
    const swapWith = direction === "left" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= shelf.positions.length) return shelves;
    const tmp = shelf.positions[index];
    shelf.positions[index] = shelf.positions[swapWith];
    shelf.positions[swapWith] = tmp;
    return renumberColumns(next);
  }
  return shelves;
}

export function moveShelf(
  shelves: EditableShelf[],
  shelfId: string,
  direction: "up" | "down"
): EditableShelf[] {
  const next = cloneShelves(shelves);
  const index = next.findIndex((s) => s.shelf_id === shelfId);
  if (index < 0) return shelves;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= next.length) return shelves;
  const tmp = next[index];
  next[index] = next[swapWith];
  next[swapWith] = tmp;
  return renumberColumns(next);
}

/**
 * Shape shelves for cloud layout / Pi propose endpoints.
 * Includes hardware when present so local propose can bind motors.
 */
export function shelvesForPropose(shelves: EditableShelf[]): Array<{
  shelf_id: string;
  row_index: number;
  label: string;
  positions: Array<Record<string, unknown>>;
}> {
  return renumberColumns(shelves).map((shelf) => ({
    shelf_id: shelf.shelf_id,
    row_index: shelf.row_index,
    label: shelf.label,
    positions: shelf.positions.map((p) => {
      const row: Record<string, unknown> = {
        position_id: p.position_id,
        column_index: p.column_index,
        label: p.label,
        legacy_slot_id: p.legacy_slot_id ?? null,
      };
      if (p.discovery_id) {
        row.discovery_id = p.discovery_id;
      }
      if (p.hardware) {
        row.bank = p.hardware.bank;
        row.mask = p.hardware.mask;
      }
      return row;
    }),
  }));
}
