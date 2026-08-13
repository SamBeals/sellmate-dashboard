"use client";

import {
  movePosition,
  moveShelf,
  positionReadiness,
  readinessBadgeClass,
  readinessLabel,
  type EditableShelf,
} from "@/lib/commissioning";
import { sensingHealthLabel } from "@/lib/topology";

type CommissioningTopologyCanvasProps = {
  shelves: EditableShelf[];
  editable?: boolean;
  validatingPositionId?: string | null;
  onChange?: (next: EditableShelf[]) => void;
  onValidate?: (positionId: string) => void;
  sensing?: {
    preferred_verification?: string;
    tof_available?: boolean;
    beam_available?: boolean;
  } | null;
  title?: string;
  subtitle?: string;
};

export function CommissioningTopologyCanvas({
  shelves,
  editable = false,
  validatingPositionId,
  onChange,
  onValidate,
  sensing,
  title = "Discovered layout",
  subtitle = "Shelves and positions from the current commissioning session.",
}: CommissioningTopologyCanvasProps) {
  const ordered = [...shelves].sort((a, b) => a.row_index - b.row_index);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
              Topology
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          </div>
          <p className="text-sm font-medium text-gray-600">
            {sensingHealthLabel(sensing)}
          </p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">
          No positions yet. Start discovery to populate shelves and lanes.
        </div>
      ) : (
        <div className="space-y-6 p-6">
          {ordered.map((shelf) => {
            const positions = [...(shelf.positions ?? [])].sort(
              (a, b) => a.column_index - b.column_index
            );
            return (
              <div key={shelf.shelf_id}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {shelf.label || shelf.shelf_id}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Row {shelf.row_index + 1} · {positions.length} position
                      {positions.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {editable && onChange ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        onClick={() =>
                          onChange(moveShelf(shelves, shelf.shelf_id, "up"))
                        }
                      >
                        Shelf up
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        onClick={() =>
                          onChange(moveShelf(shelves, shelf.shelf_id, "down"))
                        }
                      >
                        Shelf down
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {positions.map((position) => {
                    const status = positionReadiness(position, {
                      validatingPositionId,
                      positionId: position.position_id,
                    });
                    return (
                      <article
                        key={position.position_id}
                        className="rounded-lg border border-gray-200 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-semibold text-gray-500">
                              {position.legacy_slot_id ?? position.label}
                            </p>
                            <h4 className="mt-1 font-semibold text-gray-900">
                              {position.label}
                            </h4>
                            <p className="mt-1 text-sm text-gray-500">
                              Column {position.column_index + 1}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${readinessBadgeClass(
                              status
                            )}`}
                          >
                            {readinessLabel(status)}
                          </span>
                        </div>

                        {editable ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              onClick={() =>
                                onChange?.(
                                  movePosition(
                                    shelves,
                                    position.position_id,
                                    "left"
                                  )
                                )
                              }
                            >
                              ← Left
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              onClick={() =>
                                onChange?.(
                                  movePosition(
                                    shelves,
                                    position.position_id,
                                    "right"
                                  )
                                )
                              }
                            >
                              Right →
                            </button>
                            {onValidate && position.hardware ? (
                              <button
                                type="button"
                                className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                                onClick={() => onValidate(position.position_id)}
                              >
                                Validate lane
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
