/**
 * Position readiness labels for live commissioning visualization.
 * Prioritizes visual readiness over raw diagnostics.
 */

import type { TopologyPosition } from "@/lib/topology";

export type PositionReadiness =
  | "discovered"
  | "missing"
  | "validating"
  | "valid"
  | "failed"
  | "unassigned"
  | "unvalidated";

export function positionReadiness(
  position: Pick<
    TopologyPosition,
    "present" | "validation_status" | "hardware" | "legacy_slot_id"
  > & { validating?: boolean },
  opts?: { validatingPositionId?: string | null; positionId?: string }
): PositionReadiness {
  if (
    opts?.validatingPositionId &&
    opts.positionId &&
    opts.validatingPositionId === opts.positionId
  ) {
    return "validating";
  }
  if (position.validating) return "validating";
  if (position.present === false) return "missing";
  if (position.validation_status === "valid") return "valid";
  if (position.validation_status === "failed") return "failed";
  if (!position.hardware && !position.legacy_slot_id) return "unassigned";
  if (
    position.validation_status === "unvalidated" ||
    !position.validation_status
  ) {
    return "discovered";
  }
  if (position.validation_status === "skipped") return "discovered";
  return "unvalidated";
}

export function readinessLabel(status: PositionReadiness): string {
  switch (status) {
    case "discovered":
      return "Discovered";
    case "missing":
      return "Missing";
    case "validating":
      return "Validating";
    case "valid":
      return "Valid";
    case "failed":
      return "Failed";
    case "unassigned":
      return "Unassigned";
    default:
      return "Not validated";
  }
}

export function readinessBadgeClass(status: PositionReadiness): string {
  switch (status) {
    case "valid":
      return "bg-green-100 text-green-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "missing":
      return "bg-gray-200 text-gray-700";
    case "validating":
      return "bg-blue-100 text-blue-800";
    case "unassigned":
      return "bg-slate-100 text-slate-700";
    case "discovered":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}
