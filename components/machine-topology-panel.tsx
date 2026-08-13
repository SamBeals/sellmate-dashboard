/**
 * Read-only merchant view of the active approved machine topology.
 * Pending proposed layouts stay technician/admin-only.
 */

import {
  sensingHealthLabel,
  validationStatusLabel,
  type TopologyReviewMetadata,
  type VendorSafeAuditEvent,
  type VendorSafeTopology,
} from "@/lib/topology";

function formatIso(value?: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type MachineTopologyPanelProps = {
  topology: VendorSafeTopology | null;
  review: TopologyReviewMetadata | null;
  auditEvents: VendorSafeAuditEvent[];
  auditError?: string | null;
};

export function MachineTopologyPanel({
  topology,
  review,
  auditEvents,
  auditError,
}: MachineTopologyPanelProps) {
  const shelves = [...(topology?.shelves ?? [])].sort(
    (a, b) => a.row_index - b.row_index
  );
  const positionCount =
    review?.active_position_count ??
    shelves.reduce((sum, shelf) => sum + (shelf.positions?.length ?? 0), 0);

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Machine layout
        </p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Approved topology</h2>
            <p className="mt-1 text-sm text-gray-500">
              Read-only shelf and lane layout from the last technician-approved
              commissioning session. Pending proposals stay technician-only.
            </p>
          </div>
          {topology ? (
            <span className="w-fit rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
              Active
            </span>
          ) : (
            <span className="w-fit rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
              Not commissioned
            </span>
          )}
        </div>
      </div>

      {review ? (
        <div className="grid gap-4 border-b border-gray-200 bg-gray-50 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-500">Active revision</p>
            <p className="mt-2 font-mono text-sm font-semibold text-gray-900">
              {review.active_revision_id ?? "None"}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-500">Approved</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">
              {formatIso(review.active_approved_at)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-500">Lane positions</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {positionCount}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-500">Vend sensing</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">
              {sensingHealthLabel(topology?.sensing)}
            </p>
          </div>
        </div>
      ) : null}

      {review?.has_pending_proposal ? (
        <div
          className={`border-b px-6 py-3 text-sm font-medium ${
            review.pending_is_destructive
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          {review.pending_is_destructive
            ? "A topology change that may affect existing product assignments is pending technician review. The active layout below is unchanged."
            : "A topology update is pending technician review. Merchants only see the currently approved layout."}
        </div>
      ) : null}

      {review?.commissioning_out_of_service ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm font-medium text-amber-900">
          This machine is temporarily out of service for commissioning
          {review.commissioning_session_status
            ? ` (${review.commissioning_session_status.replaceAll("_", " ")})`
            : ""}
          .
        </div>
      ) : null}

      {!topology ? (
        <div className="p-6 text-sm text-gray-500">
          No approved machine layout yet. After a technician completes and
          approves commissioning in the dashboard workflow, the shelf and lane
          map will appear here.
        </div>
      ) : (
        <div className="space-y-6 p-6">
          {shelves.map((shelf) => {
            const positions = [...(shelf.positions ?? [])].sort(
              (a, b) => a.column_index - b.column_index
            );
            return (
              <div key={shelf.shelf_id}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {shelf.label || shelf.shelf_id}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {positions.length} position
                    {positions.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {positions.map((position) => {
                    const status = validationStatusLabel(
                      position.validation_status
                    );
                    const present = position.present !== false;
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
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              !present
                                ? "bg-gray-100 text-gray-600"
                                : position.validation_status === "valid"
                                  ? "bg-green-100 text-green-700"
                                  : position.validation_status === "failed"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {!present ? "Missing" : status}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-gray-200">
        <div className="border-b border-gray-200 p-6">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Topology history
          </p>
          <h3 className="mt-1 text-xl font-semibold">Approvals and changes</h3>
          <p className="mt-1 text-sm text-gray-500">
            High-level commissioning history. Low-level hardware diagnostics stay
            in the technician commissioning tools.
          </p>
        </div>

        {auditError ? (
          <div className="p-6 text-sm text-gray-500">
            Topology history is unavailable right now ({auditError}). Active
            layout above still reflects the approved machine configuration.
          </div>
        ) : auditEvents.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">
            No topology history events yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {auditEvents.map((event) => (
              <article
                key={event.event_id}
                className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-gray-900">{event.summary}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {event.event_type.replaceAll("_", " ")}
                    {event.revision_id ? ` · ${event.revision_id}` : ""}
                    {event.actor ? ` · ${event.actor}` : ""}
                  </p>
                </div>
                <p className="text-sm font-medium text-gray-500">
                  {formatIso(event.created_at)}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
