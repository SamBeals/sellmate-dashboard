/**
 * Vendor-safe topology helpers for the merchant dashboard.
 *
 * Raw hardware identifiers (I²C, GPIO bank/mask, diagnostics) are
 * technician/admin only. Vendors get layout + health language only.
 */

import {
  SCHEMA_VERSION,
  allPositions,
  type TopologyAuditEvent,
  type TopologyRevision,
  type TopologyReviewMetadata,
  type VendorSafeTopology,
} from "./schemas";

const HARDWARE_DETAIL_KEYS = new Set([
  "hardware",
  "bank",
  "mask",
  "i2c_bus",
  "i2c_address",
  "i2c_devices",
  "diagnostics",
  "controller",
]);

/**
 * Strip raw hardware identifiers from an active topology for vendor display.
 */
export function toVendorSafeTopology(
  revision: TopologyRevision
): VendorSafeTopology {
  return {
    schema_version: revision.schema_version,
    revision_id: revision.revision_id,
    machine_id: revision.machine_id,
    status: revision.status,
    shelves: (revision.shelves ?? []).map((shelf) => ({
      shelf_id: shelf.shelf_id,
      row_index: shelf.row_index,
      label: shelf.label,
      positions: (shelf.positions ?? []).map((p) => ({
        position_id: p.position_id,
        shelf_id: p.shelf_id,
        column_index: p.column_index,
        label: p.label,
        legacy_slot_id: p.legacy_slot_id ?? null,
        capabilities: (p.capabilities ?? []).filter((c) => c === "motor_lane"),
        validation_status: p.validation_status,
        present: p.present,
      })),
    })),
    sensing: {
      preferred_verification: revision.sensing?.preferred_verification,
      tof_available: revision.sensing?.tof_available,
      beam_available: revision.sensing?.beam_available,
    },
    approved_at: revision.approved_at ?? null,
    updated_at: revision.updated_at,
  };
}

/**
 * Ensure a denormalized topology_active payload has no hardware fields.
 * Defensive: cloud should already strip; dashboard double-checks.
 */
export function ensureVendorSafeTopology(
  raw: VendorSafeTopology | TopologyRevision | Record<string, unknown> | null
): VendorSafeTopology | null {
  if (!raw || typeof raw !== "object") return null;
  const revision = raw as TopologyRevision;
  if (!revision.revision_id || !Array.isArray(revision.shelves)) return null;

  const safe = toVendorSafeTopology({
    schema_version: Number(revision.schema_version ?? SCHEMA_VERSION),
    revision_id: String(revision.revision_id),
    machine_id: String(revision.machine_id ?? ""),
    status: String(revision.status ?? "active"),
    shelves: revision.shelves as TopologyRevision["shelves"],
    sensing: (revision.sensing as TopologyRevision["sensing"]) ?? {
      tof_available: false,
    },
    created_at: String(
      (revision as TopologyRevision).created_at ?? revision.updated_at ?? ""
    ),
    updated_at: String(revision.updated_at ?? ""),
    approved_at: (revision.approved_at as string | null) ?? null,
  });

  // Assert no hardware leaked into position objects.
  for (const shelf of safe.shelves) {
    for (const position of shelf.positions) {
      if ("hardware" in position) {
        delete (position as { hardware?: unknown }).hardware;
      }
    }
  }
  return safe;
}

export function buildVendorReviewMetadata(args: {
  active?: TopologyRevision | null;
  hasPendingProposal?: boolean;
  pendingRevisionId?: string | null;
  pendingIsDestructive?: boolean;
  commissioningOutOfService?: boolean;
  commissioningSessionStatus?: string | null;
}): TopologyReviewMetadata {
  const active = args.active ?? null;
  return {
    schema_version: SCHEMA_VERSION,
    active_revision_id: active?.revision_id ?? null,
    active_approved_at: active?.approved_at ?? null,
    active_position_count: active ? allPositions(active).length : 0,
    has_pending_proposal: Boolean(args.hasPendingProposal),
    pending_revision_id: args.hasPendingProposal
      ? (args.pendingRevisionId ?? null)
      : null,
    pending_is_destructive: Boolean(args.pendingIsDestructive),
    commissioning_out_of_service: Boolean(args.commissioningOutOfService),
    commissioning_session_status: args.commissioningSessionStatus ?? null,
  };
}

/** Merchant-safe audit row: no raw hardware/diagnostic detail payloads. */
export type VendorSafeAuditEvent = {
  event_id: string;
  event_type: string;
  created_at: string;
  summary: string;
  revision_id?: string | null;
  actor?: string | null;
};

export function toVendorSafeAuditEvent(
  event: TopologyAuditEvent
): VendorSafeAuditEvent {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    created_at: event.created_at,
    summary: event.summary || auditEventLabel(event.event_type),
    revision_id: event.revision_id ?? null,
    actor: event.actor ?? null,
  };
}

export function sanitizeAuditDetails(
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!details) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (HARDWARE_DETAIL_KEYS.has(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function auditEventLabel(eventType: string): string {
  switch (eventType) {
    case "session_started":
      return "Commissioning session started";
    case "discovery_completed":
      return "Hardware discovery completed";
    case "proposal_created":
      return "Topology proposal created";
    case "validation_result":
      return "Lane validation result recorded";
    case "approval_blocked":
      return "Topology activation blocked for review";
    case "revision_approved":
      return "Topology revision approved";
    case "revision_rejected":
      return "Topology revision rejected";
    case "session_cancelled":
      return "Commissioning session cancelled";
    case "migration_imported":
      return "Legacy slot layout imported";
    default:
      return "Topology change";
  }
}

export function validationStatusLabel(status?: string | null): string {
  switch (status) {
    case "valid":
      return "Validated";
    case "failed":
      return "Needs attention";
    case "skipped":
      return "Skipped";
    case "unvalidated":
      return "Not validated";
    default:
      return "Unknown";
  }
}

export function sensingHealthLabel(sensing?: {
  preferred_verification?: string;
  tof_available?: boolean;
  beam_available?: boolean;
} | null): string {
  if (!sensing) return "Sensing not reported";
  if (sensing.preferred_verification === "tof" && sensing.tof_available) {
    return "Drop detection ready";
  }
  if (sensing.preferred_verification === "beam" && sensing.beam_available) {
    return "Beam verification ready";
  }
  if (sensing.tof_available) return "Drop sensor available";
  if (sensing.beam_available) return "Beam sensor available";
  return "Sensing unavailable";
}
