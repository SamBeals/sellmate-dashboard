"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  healthStatusBadgeClass,
  healthStatusLabel,
  parseHealthTimestamp,
  resolveDisplayStatus,
  type HealthStatus,
} from "@/lib/health";

type MachineDocument = {
  display_name?: string;
  status?: string;
  last_seen_at?: Timestamp | { toDate?: () => Date } | string;
  health_status?: string;
  health_issue_count?: number;
};

type FleetMachine = {
  id: string;
  displayName: string;
  status: string;
  healthStatus: HealthStatus;
  lastSeenLabel: string;
  issueCount: number;
};

type OrderDocument = {
  amount_cents?: number;
  created_at?: Timestamp;
  machine_id?: string;
  status?: string;
};

type VendJobDocument = {
  created_at?: Timestamp;
  machine_id?: string;
  status?: string;
};

type FleetOrder = {
  amountCents: number;
  createdAt: Date;
  machineId: string;
  status: string;
};

const chartHours = Array.from({ length: 10 }, (_, index) => index + 8);

/** Live path writes COMPLETED after vend + capture; PAID covers legacy orders. */
const SUCCESSFUL_ORDER_STATUSES = new Set(["COMPLETED", "PAID"]);

type SalesChartRange = "today" | "week" | "month";

type ChartBucket = {
  key: string;
  label: string;
  salesCents: number;
  orderCount: number;
};

function isSuccessfulOrderStatus(status: string) {
  return SUCCESSFUL_ORDER_STATUSES.has(status);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function salesQueryStartDate(reference = new Date()) {
  const startOfMonth = startOfDay(
    new Date(reference.getFullYear(), reference.getMonth(), 1)
  );
  const startOfWeek = startOfDay(new Date(reference));
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  return startOfMonth < startOfWeek ? startOfMonth : startOfWeek;
}

function formatHour(hour: number) {
  return new Date(2026, 0, 1, hour).toLocaleTimeString("en-US", {
    hour: "numeric",
  });
}

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function Home() {
  const [machines, setMachines] = useState<FleetMachine[]>([]);
  const [orders, setOrders] = useState<FleetOrder[]>([]);
  const [failedVendMachineIds, setFailedVendMachineIds] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salesChartRange, setSalesChartRange] =
    useState<SalesChartRange>("today");

  useEffect(() => {
    async function loadFleetOverview() {
      try {
        setLoading(true);
        setError(null);

        const startOfToday = startOfDay(new Date());
        const todayTimestamp = Timestamp.fromDate(startOfToday);
        const salesChartStartTimestamp = Timestamp.fromDate(
          salesQueryStartDate()
        );

        const [machineSnapshot, orderSnapshot, vendJobSnapshot] =
          await Promise.all([
            getDocs(collection(db, "machines")),
            getDocs(
              query(
                collection(db, "orders"),
                where("created_at", ">=", salesChartStartTimestamp)
              )
            ),
            getDocs(
              query(
                collection(db, "vend_jobs"),
                where("created_at", ">=", todayTimestamp)
              )
            ),
          ]);

        const loadedMachines = machineSnapshot.docs
          .map((machineDoc) => {
            const data = machineDoc.data() as MachineDocument;
            const healthStatus = resolveDisplayStatus(
              data.health_status,
              data.last_seen_at ?? null
            );
            const lastSeen = parseHealthTimestamp(data.last_seen_at ?? null);

            return {
              id: machineDoc.id,
              displayName: data.display_name?.trim() || machineDoc.id,
              status: data.status?.trim().toLowerCase() || "unknown",
              healthStatus,
              lastSeenLabel: lastSeen
                ? lastSeen.toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "Never",
              issueCount:
                typeof data.health_issue_count === "number"
                  ? data.health_issue_count
                  : 0,
            };
          })
          .sort((first, second) =>
            first.displayName.localeCompare(second.displayName)
          );

        const loadedOrders = orderSnapshot.docs
          .map((orderDoc) => {
            const data = orderDoc.data() as OrderDocument;

            if (
              typeof data.amount_cents !== "number" ||
              !data.created_at ||
              !data.machine_id
            ) {
              return null;
            }

            return {
              amountCents: data.amount_cents,
              createdAt: data.created_at.toDate(),
              machineId: data.machine_id,
              status: data.status?.toUpperCase() || "UNKNOWN",
            };
          })
          .filter((order): order is FleetOrder => order !== null)
          .filter((order) => isSuccessfulOrderStatus(order.status));

        const machinesWithFailedVends = new Set<string>();

        vendJobSnapshot.docs.forEach((vendJobDoc) => {
          const data = vendJobDoc.data() as VendJobDocument;

          if (data.status?.toUpperCase() === "FAILED" && data.machine_id) {
            machinesWithFailedVends.add(data.machine_id);
          }
        });

        setMachines(loadedMachines);
        setOrders(loadedOrders);
        setFailedVendMachineIds(machinesWithFailedVends);
      } catch (loadError) {
        console.error("Failed to load fleet overview:", loadError);

        if (loadError instanceof Error) {
          setError(`Failed to load fleet data: ${loadError.message}`);
        } else {
          setError("Failed to load fleet data.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadFleetOverview();
  }, []);

  const todayOrders = useMemo(() => {
    const startOfToday = startOfDay(new Date());
    return orders.filter((order) => order.createdAt >= startOfToday);
  }, [orders]);

  const fleetRevenueCents = useMemo(
    () => todayOrders.reduce((sum, order) => sum + order.amountCents, 0),
    [todayOrders]
  );

  const activeMachines = useMemo(
    () => machines.filter((machine) => machine.status === "active").length,
    [machines]
  );

  const chartSales = useMemo((): ChartBucket[] => {
    const now = new Date();
    const startOfToday = startOfDay(now);

    if (salesChartRange === "today") {
      return chartHours.map((hour) => {
        const ordersForHour = todayOrders.filter(
          (order) => order.createdAt.getHours() === hour
        );

        return {
          key: `hour-${hour}`,
          label: formatHour(hour),
          salesCents: ordersForHour.reduce(
            (sum, order) => sum + order.amountCents,
            0
          ),
          orderCount: ordersForHour.length,
        };
      });
    }

    if (salesChartRange === "week") {
      return Array.from({ length: 7 }, (_, index) => {
        const day = startOfDay(new Date(now));
        day.setDate(day.getDate() - (6 - index));
        const dayEnd = endOfDay(day);
        const ordersForDay = orders.filter(
          (order) => order.createdAt >= day && order.createdAt <= dayEnd
        );

        return {
          key: day.toISOString(),
          label: day.toLocaleDateString("en-US", { weekday: "short" }),
          salesCents: ordersForDay.reduce(
            (sum, order) => sum + order.amountCents,
            0
          ),
          orderCount: ordersForDay.length,
        };
      });
    }

    const year = now.getFullYear();
    const month = now.getMonth();
    const daysSoFar = now.getDate();

    return Array.from({ length: daysSoFar }, (_, index) => {
      const day = startOfDay(new Date(year, month, index + 1));
      const dayEnd = endOfDay(day);
      const ordersForDay = orders.filter(
        (order) => order.createdAt >= day && order.createdAt <= dayEnd
      );

      return {
        key: day.toISOString(),
        label: String(index + 1),
        salesCents: ordersForDay.reduce(
          (sum, order) => sum + order.amountCents,
          0
        ),
        orderCount: ordersForDay.length,
      };
    });
  }, [orders, salesChartRange, todayOrders]);

  const revenueByMachine = useMemo(() => {
    const totals = new Map<string, number>();

    todayOrders.forEach((order) => {
      totals.set(
        order.machineId,
        (totals.get(order.machineId) || 0) + order.amountCents
      );
    });

    return totals;
  }, [todayOrders]);

  const maxChartSales = Math.max(
    ...chartSales.map((bucket) => bucket.salesCents),
    1
  );

  const salesChartTitle =
    salesChartRange === "today"
      ? "Revenue by hour"
      : salesChartRange === "week"
        ? "Revenue by day"
        : "Revenue by day this month";

  const salesChartDescription =
    salesChartRange === "today"
      ? "Successful fleet-wide sales from 8 AM through 5 PM."
      : salesChartRange === "week"
        ? "Successful fleet-wide sales for the last 7 days."
        : "Successful fleet-wide sales for each day of the current month.";

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-8 text-gray-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            SellMate Dashboard
          </h1>
          <p className="mt-2 text-gray-600">
            Fleet-wide machine operations and performance.
          </p>
        </header>

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 shadow-sm">
            Loading fleet data…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
            <h2 className="text-2xl font-bold text-red-700">
              Unable to Load Fleet
            </h2>
            <p className="mt-2 text-red-600">{error}</p>
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">
                  Fleet revenue today
                </p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {formatCurrency(fleetRevenueCents)}
                </p>
                <p className="mt-1 text-sm text-green-700">
                  From completed orders
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-blue-700">
                  Orders today
                </p>
                <p className="mt-2 text-3xl font-bold text-blue-900">
                  {todayOrders.length}
                </p>
                <p className="mt-1 text-sm text-blue-700">
                  Successful fleet-wide
                </p>
              </div>

              <div className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-green-700">
                  Active machines
                </p>
                <p className="mt-2 text-3xl font-bold text-green-900">
                  {activeMachines} / {machines.length}
                </p>
                <p className="mt-1 text-sm text-green-700">
                  Enabled in Firestore
                </p>
              </div>

              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-yellow-700">
                  Vend failures today
                </p>
                <p className="mt-2 text-3xl font-bold text-yellow-900">
                  {failedVendMachineIds.size}
                </p>
                <p className="mt-1 text-sm text-yellow-700">
                  Machines with failures
                </p>
              </div>
            </section>

            <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                      Sales
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">
                      {salesChartTitle}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {salesChartDescription}
                    </p>
                  </div>

                  <div className="flex w-fit shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-1">
                    {(
                      [
                        ["today", "Today"],
                        ["week", "Week"],
                        ["month", "Month"],
                      ] as const
                    ).map(([range, label]) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setSalesChartRange(range)}
                        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                          salesChartRange === range
                            ? "bg-gray-900 text-white"
                            : "text-gray-600 hover:bg-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div
                  className={`flex h-72 items-end border-b border-l border-gray-300 px-4 pt-6 ${
                    salesChartRange === "month"
                      ? "gap-1 overflow-x-auto"
                      : "gap-3"
                  }`}
                >
                  {chartSales.map((bucket) => {
                    const heightPercent =
                      bucket.salesCents === 0
                        ? 0
                        : Math.max(
                            6,
                            Math.round(
                              (bucket.salesCents / maxChartSales) * 100
                            )
                          );

                    return (
                      <div
                        key={bucket.key}
                        className={`flex h-full min-w-0 flex-col items-center justify-end ${
                          salesChartRange === "month"
                            ? "w-8 shrink-0 flex-none"
                            : "flex-1"
                        }`}
                      >
                        <p className="mb-2 text-xs font-semibold text-gray-700">
                          {bucket.salesCents > 0
                            ? formatCurrency(bucket.salesCents)
                            : "$0"}
                        </p>
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            salesChartRange === "month" ? "max-w-6" : "max-w-12"
                          } ${
                            bucket.salesCents > 0 ? "bg-blue-500" : "bg-gray-200"
                          }`}
                          style={{
                            height:
                              bucket.salesCents > 0
                                ? `${heightPercent}%`
                                : "2px",
                          }}
                          title={`${bucket.label}: ${formatCurrency(
                            bucket.salesCents
                          )} from ${bucket.orderCount} successful order${
                            bucket.orderCount === 1 ? "" : "s"
                          }`}
                        />
                        <p className="mt-2 whitespace-nowrap text-xs font-medium text-gray-500">
                          {bucket.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 p-6">
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                  Fleet Status
                </p>
                <h2 className="mt-1 text-2xl font-semibold">All machines</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Select a machine to view its detailed status, inventory,
                  sales, and events.
                </p>
              </div>

              {machines.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No machines were found in Firestore.
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {machines.map((machine) => {
                    const hasVendFailure = failedVendMachineIds.has(machine.id);
                    // Prefer live Pi health; fall back to vend-failure attention.
                    const healthStatus =
                      machine.healthStatus === "unknown" && hasVendFailure
                        ? "attention"
                        : machine.healthStatus === "healthy" && hasVendFailure
                          ? "attention"
                          : machine.healthStatus;
                    const issueCount =
                      machine.issueCount + (hasVendFailure ? 1 : 0);

                    return (
                      <article
                        key={machine.id}
                        className="grid gap-3 p-5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
                      >
                        <div>
                          <Link
                            href={`/machines/${machine.id}`}
                            className="font-mono text-sm font-semibold text-blue-700 hover:underline"
                          >
                            {machine.id}
                          </Link>
                          <h3 className="mt-1 font-semibold text-gray-900">
                            {machine.displayName}
                          </h3>
                          <p className="mt-1 text-xs text-gray-500">
                            Last seen: {machine.lastSeenLabel}
                          </p>
                        </div>

                        <span
                          className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${healthStatusBadgeClass(
                            healthStatus
                          )}`}
                        >
                          {healthStatusLabel(healthStatus)}
                        </span>

                        <p className="text-xs font-medium text-gray-500 sm:min-w-16 sm:text-center">
                          {issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : "—"}
                        </p>

                        <p className="font-semibold text-gray-900 sm:min-w-24 sm:text-right">
                          {formatCurrency(
                            revenueByMachine.get(machine.id) || 0
                          )}
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
