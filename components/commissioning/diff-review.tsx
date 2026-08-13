"use client";

import type { TopologyDiff } from "@/lib/commissioning";
import type { PlanogramImpact } from "@/lib/topology";

type CommissioningDiffReviewProps = {
  diff?: TopologyDiff | null;
  impact?: PlanogramImpact | null;
  blocked?: boolean;
};

export function CommissioningDiffReview({
  diff,
  impact,
  blocked,
}: CommissioningDiffReviewProps) {
  const hasDiff =
    Boolean(diff) &&
    Boolean(
      (diff?.added_position_ids?.length ?? 0) +
        (diff?.removed_position_ids?.length ?? 0) +
        (diff?.added_legacy_slot_ids?.length ?? 0) +
        (diff?.removed_legacy_slot_ids?.length ?? 0) +
        (diff?.remapped_legacy_slot_ids?.length ?? 0)
    );
  const hasImpact = Boolean(impact?.has_existing_planogram);

  if (!hasDiff && !hasImpact && !blocked) {
    return null;
  }

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Review
        </p>
        <h2 className="mt-1 text-2xl font-semibold">
          Topology change review
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Re-discovery against an existing layout. Destructive activation stays
          blocked until reviewed
          {blocked ? " (currently blocked)" : ""}.
        </p>
      </div>

      {blocked || impact?.destructive ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm font-medium text-amber-900">
          Activation is blocked because the proposed topology would move or
          remove populated planogram assignments. Preserve unambiguous slots and
          require admin force only when intentionally overriding.
        </div>
      ) : null}

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">Structural diff</h3>
          {!hasDiff ? (
            <p className="mt-2 text-sm text-gray-500">
              No structural position/slot changes reported.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              <li>
                Added positions:{" "}
                {(diff?.added_position_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Removed positions:{" "}
                {(diff?.removed_position_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Added legacy slots:{" "}
                {(diff?.added_legacy_slot_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Removed legacy slots:{" "}
                {(diff?.removed_legacy_slot_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Remapped hardware:{" "}
                {(diff?.remapped_legacy_slot_ids ?? []).length || 0}
              </li>
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900">Planogram impact</h3>
          {!hasImpact ? (
            <p className="mt-2 text-sm text-gray-500">
              No existing planogram assignments were evaluated.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              <li>
                Preserved:{" "}
                {(impact?.preserved_legacy_slot_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Ambiguous:{" "}
                {(impact?.ambiguous_legacy_slot_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Removed:{" "}
                {(impact?.removed_legacy_slot_ids ?? []).join(", ") || "none"}
              </li>
              <li>
                Added: {(impact?.added_position_ids ?? []).join(", ") || "none"}
              </li>
            </ul>
          )}
          {(impact?.warnings ?? []).length > 0 ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {(impact?.warnings ?? []).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
