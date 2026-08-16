/**
 * Fleet overview loading helpers.
 *
 * Machine access must not wait on sales/vend analytics. Firestore queries can
 * hang in Safari (WebChannel / long-poll) without throwing; timeouts unblock
 * the technician UI for commissioning.
 */

export const MACHINES_TIMEOUT_MS = 12_000;
export const ANALYTICS_TIMEOUT_MS = 8_000;

export type FleetMachineRecord = {
  id: string;
  displayName: string;
  status: string;
  healthStatus: string | undefined;
  lastSeenAt: unknown;
  issueCount: number;
};

export type FleetOrderRecord = {
  amountCents: number;
  createdAt: Date;
  machineId: string;
  status: string;
};

export type SettledResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/** Live path writes COMPLETED after vend + capture; PAID covers legacy orders. */
export const SUCCESSFUL_ORDER_STATUSES = new Set(["COMPLETED", "PAID"]);

export function isSuccessfulOrderStatus(status: string) {
  return SUCCESSFUL_ORDER_STATUSES.has(status);
}

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function salesQueryStartDate(reference = new Date()) {
  const startOfMonth = startOfDay(
    new Date(reference.getFullYear(), reference.getMonth(), 1)
  );
  const startOfWeek = startOfDay(new Date(reference));
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  return startOfMonth < startOfWeek ? startOfMonth : startOfWeek;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function settled<T>(
  promise: Promise<T>
): Promise<SettledResult<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function mapMachineDocuments(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): FleetMachineRecord[] {
  return docs
    .map((machineDoc) => {
      const displayName =
        typeof machineDoc.data.display_name === "string"
          ? machineDoc.data.display_name.trim()
          : "";
      const status =
        typeof machineDoc.data.status === "string"
          ? machineDoc.data.status.trim().toLowerCase()
          : "unknown";
      const issueCount =
        typeof machineDoc.data.health_issue_count === "number"
          ? machineDoc.data.health_issue_count
          : 0;

      return {
        id: machineDoc.id,
        displayName: displayName || machineDoc.id,
        status,
        healthStatus:
          typeof machineDoc.data.health_status === "string"
            ? machineDoc.data.health_status
            : undefined,
        lastSeenAt: machineDoc.data.last_seen_at,
        issueCount,
      };
    })
    .sort((first, second) =>
      first.displayName.localeCompare(second.displayName)
    );
}

export function mapSuccessfulOrders(
  docs: Array<{
    amount_cents?: unknown;
    created_at?: { toDate?: () => Date } | null;
    machine_id?: unknown;
    status?: unknown;
  }>
): FleetOrderRecord[] {
  return docs
    .map((data) => {
      if (
        typeof data.amount_cents !== "number" ||
        !data.created_at?.toDate ||
        typeof data.machine_id !== "string"
      ) {
        return null;
      }

      return {
        amountCents: data.amount_cents,
        createdAt: data.created_at.toDate(),
        machineId: data.machine_id,
        status:
          typeof data.status === "string"
            ? data.status.toUpperCase()
            : "UNKNOWN",
      };
    })
    .filter((order): order is FleetOrderRecord => order !== null)
    .filter((order) => isSuccessfulOrderStatus(order.status));
}

export function mapFailedVendMachineIds(
  docs: Array<{ status?: unknown; machine_id?: unknown }>
): Set<string> {
  const machinesWithFailedVends = new Set<string>();

  docs.forEach((data) => {
    if (
      typeof data.status === "string" &&
      data.status.toUpperCase() === "FAILED" &&
      typeof data.machine_id === "string" &&
      data.machine_id
    ) {
      machinesWithFailedVends.add(data.machine_id);
    }
  });

  return machinesWithFailedVends;
}

export function analyticsWarning(args: {
  ordersFailed: boolean;
  vendJobsFailed: boolean;
}): string | null {
  if (args.ordersFailed && args.vendJobsFailed) {
    return "Sales and vend analytics could not be loaded. Machine access is still available.";
  }
  if (args.ordersFailed) {
    return "Sales analytics could not be loaded. Machine access is still available.";
  }
  if (args.vendJobsFailed) {
    return "Vend-failure analytics could not be loaded. Machine access is still available.";
  }
  return null;
}
