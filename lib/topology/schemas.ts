/**
 * FEATURE-013 V1 topology and commissioning-session schemas.
 *
 * Client-side mirrors of Firestore / sellmate-cloud document shapes.
 *
 * Revision semantics:
 *   - proposed: discovery + technician layout; not used for vend/planogram ops
 *   - active: explicitly approved; authoritative for commissioned machines
 *   - Discovery never silently rewrites active.
 *
 * Firestore paths (V1):
 *   machines/{machineId}/topology/active
 *   machines/{machineId}/topology/proposed
 *   machines/{machineId}/topologyRevisions/{revisionId}
 *   machines/{machineId}/commissioningSessions/{sessionId}
 *   machines/{machineId}/topologyAudit/{eventId}
 *
 * Dashboard reads vendor-safe denormalized fields on the machine doc:
 *   topology_active, topology_review, topology_revision_id, …
 */

export const SCHEMA_VERSION = 1;

export type TopologyStatus =
  | "proposed"
  | "active"
  | "superseded"
  | "rejected";

export type SessionStatus =
  | "idle"
  | "in_service_blocked"
  | "discovering"
  | "awaiting_confirmation"
  | "validating"
  | "approved"
  | "cancelled"
  | "blocked_destructive";

export type PositionCapability =
  | "motor_lane"
  | "vend_verification_tof"
  | "vend_verification_beam";

export type ValidationStatus =
  | "unvalidated"
  | "valid"
  | "failed"
  | "skipped";

export type AuditEventType =
  | "session_started"
  | "discovery_completed"
  | "proposal_created"
  | "validation_result"
  | "approval_blocked"
  | "revision_approved"
  | "revision_rejected"
  | "session_cancelled"
  | "migration_imported";

/** Technician-only raw hardware addressing for a motor lane. */
export type HardwareRef = {
  bank: string;
  mask: number;
  controller?: string;
  i2c_bus?: string | null;
  i2c_address?: string | null;
};

/** A shelf lane/position. V1 abstraction: shelves + positions. */
export type TopologyPosition = {
  position_id: string;
  shelf_id: string;
  column_index: number;
  label: string;
  legacy_slot_id?: string | null;
  discovery_id?: string | null;
  /** Stripped in vendor-safe views. */
  hardware?: HardwareRef | null;
  capabilities?: string[];
  validation_status?: ValidationStatus | string;
  present?: boolean;
};

export type TopologyShelf = {
  shelf_id: string;
  row_index: number;
  label: string;
  positions: TopologyPosition[];
};

/** Vend-verification sensing needed for lane validation (V1: ToF first). */
export type SensingSnapshot = {
  tof_available: boolean;
  tof_sensor?: string;
  tof_error?: string | null;
  beam_available?: boolean;
  beam_error?: string | null;
  preferred_verification?: "tof" | "beam" | "none" | string;
};

export type DiscoveredMotor = {
  discovery_id: string;
  bank: string;
  mask: number;
  addressable: boolean;
  probe_ok: boolean;
  electrically_detected?: boolean;
  probe_result?: string;
  activation_latency_ms?: number | null;
  activation_duration_ms?: number | null;
  label_hint?: string | null;
  legacy_slot_hint?: string | null;
  diagnostics?: Record<string, unknown>;
};

export type CurrentMonitorSnapshot = {
  available: boolean;
  enabled?: boolean;
  address?: string | null;
  bus?: string | null;
  reason?: string | null;
  manufacturer_id?: string | null;
};

export type DiscoverySnapshot = {
  schema_version: number;
  machine_id: string;
  captured_at: string;
  motor_controller_present: boolean;
  motors: DiscoveredMotor[];
  sensing: SensingSnapshot;
  current_monitor?: CurrentMonitorSnapshot | null;
  candidate_count: number;
  simulation?: boolean;
  notes?: string[];
};

export type PlanogramImpact = {
  has_existing_planogram: boolean;
  destructive: boolean;
  preserved_legacy_slot_ids?: string[];
  ambiguous_legacy_slot_ids?: string[];
  removed_legacy_slot_ids?: string[];
  added_position_ids?: string[];
  warnings?: string[];
};

export type TopologyRevision = {
  schema_version: number;
  revision_id: string;
  machine_id: string;
  status: TopologyStatus | string;
  shelves: TopologyShelf[];
  sensing: SensingSnapshot;
  created_at: string;
  updated_at: string;
  source_session_id?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  supersedes_revision_id?: string | null;
  planogram_impact?: PlanogramImpact | null;
  migration_from_legacy?: boolean;
};

export type CommissioningSession = {
  schema_version: number;
  session_id: string;
  machine_id: string;
  status: SessionStatus | string;
  started_at: string;
  updated_at: string;
  out_of_service?: boolean;
  discovery?: DiscoverySnapshot | null;
  proposed_revision_id?: string | null;
  active_revision_id_at_start?: string | null;
  technician_actor?: string | null;
  block_reason?: string | null;
};

export type TopologyAuditEvent = {
  schema_version: number;
  event_id: string;
  machine_id: string;
  event_type: AuditEventType | string;
  created_at: string;
  session_id?: string | null;
  revision_id?: string | null;
  actor?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
};

/**
 * Merchant-safe review metadata denormalized on machines/{id}.
 * Pending proposal *content* stays technician-only.
 */
export type TopologyReviewMetadata = {
  schema_version: number;
  active_revision_id?: string | null;
  active_approved_at?: string | null;
  active_position_count?: number;
  has_pending_proposal?: boolean;
  pending_revision_id?: string | null;
  pending_is_destructive?: boolean;
  commissioning_out_of_service?: boolean;
  commissioning_session_status?: string | null;
};

/** Vendor-safe active topology (no hardware / diagnostics). */
export type VendorSafeTopology = {
  schema_version: number;
  revision_id: string;
  machine_id: string;
  status: string;
  shelves: Array<{
    shelf_id: string;
    row_index: number;
    label: string;
    positions: Array<{
      position_id: string;
      shelf_id: string;
      column_index: number;
      label: string;
      legacy_slot_id?: string | null;
      capabilities: string[];
      validation_status?: string;
      present?: boolean;
    }>;
  }>;
  sensing: {
    preferred_verification?: string;
    tof_available?: boolean;
    beam_available?: boolean;
  };
  approved_at?: string | null;
  updated_at?: string;
};

export function utcNowIso(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${hex}`;
}

export function allPositions(revision: TopologyRevision): TopologyPosition[] {
  const shelves = [...(revision.shelves ?? [])].sort(
    (a, b) => a.row_index - b.row_index
  );
  const positions: TopologyPosition[] = [];
  for (const shelf of shelves) {
    const ordered = [...(shelf.positions ?? [])].sort(
      (a, b) => a.column_index - b.column_index
    );
    positions.push(...ordered);
  }
  return positions;
}

export function parseTopologyRevision(
  data: Record<string, unknown>
): TopologyRevision {
  return {
    schema_version: Number(data.schema_version ?? SCHEMA_VERSION),
    revision_id: String(data.revision_id ?? ""),
    machine_id: String(data.machine_id ?? ""),
    status: String(data.status ?? "proposed"),
    shelves: Array.isArray(data.shelves)
      ? (data.shelves as TopologyShelf[])
      : [],
    sensing: (data.sensing as SensingSnapshot) ?? {
      tof_available: false,
      preferred_verification: "none",
    },
    created_at: String(data.created_at ?? utcNowIso()),
    updated_at: String(data.updated_at ?? utcNowIso()),
    source_session_id: (data.source_session_id as string | null) ?? null,
    approved_at: (data.approved_at as string | null) ?? null,
    approved_by: (data.approved_by as string | null) ?? null,
    supersedes_revision_id:
      (data.supersedes_revision_id as string | null) ?? null,
    planogram_impact:
      (data.planogram_impact as PlanogramImpact | null) ?? null,
    migration_from_legacy: Boolean(data.migration_from_legacy ?? false),
  };
}

export function parseTopologyReview(
  data: Record<string, unknown> | null | undefined
): TopologyReviewMetadata | null {
  if (!data || typeof data !== "object") return null;
  return {
    schema_version: Number(data.schema_version ?? SCHEMA_VERSION),
    active_revision_id: (data.active_revision_id as string | null) ?? null,
    active_approved_at: (data.active_approved_at as string | null) ?? null,
    active_position_count: Number(data.active_position_count ?? 0),
    has_pending_proposal: Boolean(data.has_pending_proposal ?? false),
    pending_revision_id: (data.pending_revision_id as string | null) ?? null,
    pending_is_destructive: Boolean(data.pending_is_destructive ?? false),
    commissioning_out_of_service: Boolean(
      data.commissioning_out_of_service ?? false
    ),
    commissioning_session_status:
      (data.commissioning_session_status as string | null) ?? null,
  };
}

export function parseAuditEvent(
  data: Record<string, unknown>
): TopologyAuditEvent {
  return {
    schema_version: Number(data.schema_version ?? SCHEMA_VERSION),
    event_id: String(data.event_id ?? ""),
    machine_id: String(data.machine_id ?? ""),
    event_type: String(data.event_type ?? ""),
    created_at: String(data.created_at ?? utcNowIso()),
    session_id: (data.session_id as string | null) ?? null,
    revision_id: (data.revision_id as string | null) ?? null,
    actor: (data.actor as string | null) ?? null,
    summary: String(data.summary ?? ""),
    details:
      data.details && typeof data.details === "object"
        ? (data.details as Record<string, unknown>)
        : {},
  };
}
