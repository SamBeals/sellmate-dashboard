/**
 * Technician layout helpers: reorder / confirm ambiguous physical ordering.
 */

import type { TopologyPosition, TopologyShelf } from "@/lib/topology";

export type EditableShelf = {
  shelf_id: string;
  row_index: number;
  label: string;
  positions: TopologyPosition[];
};

export function cloneShelves(shelves: TopologyShelf[]): EditableShelf[] {
  return [...shelves]
    .sort((a, b) => a.row_index - b.row_index)
    .map((shelf) => ({
      shelf_id: shelf.shelf_id,
      row_index: shelf.row_index,
      label: shelf.label,
      positions: [...(shelf.positions ?? [])]
        .sort((a, b) => a.column_index - b.column_index)
        .map((p) => ({ ...p, hardware: p.hardware ? { ...p.hardware } : p.hardware })),
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
      if (p.hardware) {
        row.bank = p.hardware.bank;
        row.mask = p.hardware.mask;
      }
      return row;
    }),
  }));
}
