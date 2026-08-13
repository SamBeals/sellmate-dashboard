/**
 * FEATURE-013 commissioning authorization roles for the dashboard.
 *
 * Mirrors sellmate-cloud/commissioning_auth.py and sellmate-pi commissioning_auth.
 * Reuses operator token + X-SellMate-Role; does not invent a parallel identity system.
 */

export const ROLE_VENDOR = "vendor";
export const ROLE_TRUSTED_VENDOR = "trusted_vendor";
export const ROLE_TECHNICIAN = "technician";
export const ROLE_ADMIN = "admin";

export type SellMateRole =
  | typeof ROLE_VENDOR
  | typeof ROLE_TRUSTED_VENDOR
  | typeof ROLE_TECHNICIAN
  | typeof ROLE_ADMIN;

export const COMMISSIONING_ROLES = new Set<SellMateRole>([
  ROLE_TRUSTED_VENDOR,
  ROLE_TECHNICIAN,
  ROLE_ADMIN,
]);

export const DIAGNOSTICS_ROLES = new Set<SellMateRole>([
  ROLE_TECHNICIAN,
  ROLE_ADMIN,
]);

export const FORCE_ACTIVATE_ROLES = new Set<SellMateRole>([ROLE_ADMIN]);

const ALIASES: Record<string, SellMateRole> = {
  merchant: ROLE_VENDOR,
  vendor_readonly: ROLE_VENDOR,
  tech: ROLE_TECHNICIAN,
  service: ROLE_TECHNICIAN,
  operator: ROLE_TECHNICIAN,
};

export function normalizeRole(
  raw?: string | null,
  defaultRole: SellMateRole = ROLE_VENDOR
): SellMateRole {
  const value = (raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (!value) return defaultRole;
  const aliased = ALIASES[value] ?? value;
  if (
    aliased === ROLE_VENDOR ||
    aliased === ROLE_TRUSTED_VENDOR ||
    aliased === ROLE_TECHNICIAN ||
    aliased === ROLE_ADMIN
  ) {
    return aliased;
  }
  return defaultRole;
}

export function canCommission(role?: string | null): boolean {
  return COMMISSIONING_ROLES.has(normalizeRole(role));
}

export function canViewDiagnostics(role?: string | null): boolean {
  return DIAGNOSTICS_ROLES.has(normalizeRole(role));
}

export function canForceActivate(role?: string | null): boolean {
  return FORCE_ACTIVATE_ROLES.has(normalizeRole(role));
}

export function canViewProposedTopology(role?: string | null): boolean {
  return canCommission(role);
}

export function roleLabel(role?: string | null): string {
  switch (normalizeRole(role)) {
    case ROLE_ADMIN:
      return "Admin";
    case ROLE_TECHNICIAN:
      return "Technician";
    case ROLE_TRUSTED_VENDOR:
      return "Trusted vendor";
    default:
      return "Vendor";
  }
}
