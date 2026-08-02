/**
 * Machine health display helpers.
 *
 * Thresholds MUST stay aligned with SellMateCloud/health_status.py.
 * Offline is derived from received_at / last_seen_at age at read time.
 */

export const HEALTHY_MAX_AGE_SECONDS = 120;
export const OFFLINE_AFTER_SECONDS = 180;

export type HealthStatus = "healthy" | "attention" | "offline" | "unknown";

export type MachineHealthDocument = {
  schema_version?: number;
  machine_id?: string;
  reported_at?: string | { toDate?: () => Date };
  received_at?: string | { toDate?: () => Date };
  status?: HealthStatus | string;
  issue_count?: number;
  issues?: string[];
  hostname?: string;
  app_version?: string;
  system?: {
    uptime_seconds?: number | null;
    cpu_temperature_c?: number | null;
    cpu_percent?: number | null;
    memory_percent?: number | null;
    disk_percent?: number | null;
  };
  network?: {
    internet_connected?: boolean | null;
    cloud_reachable?: boolean | null;
    // Admin-only in product policy; not shown to merchants in this app.
    local_ip?: string | null;
    tailscale_ip?: string | null;
  };
  services?: {
    vend_api_running?: boolean | null;
    poller_running?: boolean | null;
  };
  hardware?: {
    i2c_devices?: string[] | null;
    tof_connected?: boolean | null;
    motor_controller_connected?: boolean | null;
  };
  errors?: string[];
};

export type MachineHealthSummary = {
  last_seen_at?: string | { toDate?: () => Date } | null;
  health_status?: HealthStatus | string | null;
  health_issue_count?: number | null;
};

export function parseHealthTimestamp(
  value?: string | { toDate?: () => Date } | null
): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveDisplayStatus(
  storedStatus: string | null | undefined,
  receivedAt: string | { toDate?: () => Date } | null | undefined,
  now = new Date()
): HealthStatus {
  const received = parseHealthTimestamp(receivedAt ?? null);
  if (!received) return "unknown";

  const ageSeconds = (now.getTime() - received.getTime()) / 1000;
  if (ageSeconds >= OFFLINE_AFTER_SECONDS) return "offline";

  if (storedStatus === "healthy" || storedStatus === "attention") {
    return storedStatus;
  }
  return "unknown";
}

export function healthStatusLabel(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "attention":
      return "Attention";
    case "offline":
      return "Offline";
    default:
      return "Unknown";
  }
}

export function healthStatusBadgeClass(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "bg-green-100 text-green-700";
    case "attention":
      return "bg-amber-100 text-amber-800";
    case "offline":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-200 text-gray-700";
  }
}

export function formatUptime(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
    return "Not available";
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatOptionalNumber(
  value?: number | null,
  suffix = "",
  digits = 1
): string {
  if (value == null || Number.isNaN(value)) return "Not available";
  return `${value.toFixed(digits)}${suffix}`;
}

export function boolLabel(value?: boolean | null): string {
  if (value === true) return "Running / connected";
  if (value === false) return "Down / missing";
  return "Unknown";
}

export function boolBadgeClass(value?: boolean | null): string {
  if (value === true) return "bg-green-100 text-green-700";
  if (value === false) return "bg-red-100 text-red-700";
  return "bg-gray-200 text-gray-700";
}
