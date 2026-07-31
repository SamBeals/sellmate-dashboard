"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

type MachineData = {
  display_name?: string;
  stripe_reader_id?: string;
  template_id?: string;
  status?: string;
  updated_at?: { toDate?: () => Date };
  location?: {
    latitude?: number;
    longitude?: number;
  };
};


type InventorySlot = {
  id: string;
  slot_id?: string;
  capacity?: number;
  qty?: number;
  price_cents?: number;
  imageUrl?: string;
  name?: string;
  enabled?: boolean;
  sku_id?: string;
};

type SalesEvent = {
  id: string;
  time: string;
  type: "sale" | "vend_success" | "vend_failed" | "inventory";
  title: string;
  detail: string;
  amount_cents?: number;
};

const mockSalesEvents: SalesEvent[] = [
  {
    id: "evt_001",
    time: "11:42 AM",
    type: "sale",
    title: "Sale completed",
    detail: "A1 · Pink Press-On Nail Set",
    amount_cents: 1800,
  },
  {
    id: "evt_002",
    time: "11:42 AM",
    type: "vend_success",
    title: "Vend successful",
    detail: "Slot A1 dispensed successfully",
  },
  {
    id: "evt_003",
    time: "10:58 AM",
    type: "sale",
    title: "Sale completed",
    detail: "B3 · Floral Nail Set",
    amount_cents: 2200,
  },
  {
    id: "evt_004",
    time: "10:58 AM",
    type: "vend_failed",
    title: "Vend requires review",
    detail: "Slot B3 did not confirm beam break",
  },
  {
    id: "evt_005",
    time: "9:15 AM",
    type: "inventory",
    title: "Low inventory detected",
    detail: "Slot C2 has 1 item remaining",
  },
];

function getProductName(slot: InventorySlot) {
  return slot.name ?? "Unassigned product";
}

function getInventoryCount(slot: InventorySlot) {
  return slot.qty ?? 0;
}

function getInventoryPercent(slot: InventorySlot) {
  const capacity = slot.capacity ?? 0;
  if (capacity <= 0) return 0;

  return Math.min(100, Math.round((getInventoryCount(slot) / capacity) * 100));
}

function formatTimestamp(value?: { toDate?: () => Date }) {
  if (!value?.toDate) return "Not available";

  return value.toDate().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function MachineDetailPage() {
  const { machineId } = useParams<{ machineId: string }>();
  const [machine, setMachine] = useState<MachineData | null>(null);
  const [inventory, setInventory] = useState<InventorySlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "sales">("overview");

  const totalItems = inventory.reduce(
    (sum, slot) => sum + getInventoryCount(slot),
    0
  );
  const totalCapacity = inventory.reduce(
    (sum, slot) => sum + (slot.capacity ?? 0),
    0
  );
  const outOfStockSlots = inventory.filter(
    (slot) => getInventoryCount(slot) <= 0
  ).length;
  const lowStockSlots = inventory.filter((slot) => {
    const count = getInventoryCount(slot);
    const percent = getInventoryPercent(slot);
    return count > 0 && percent <= 25;
  }).length;
  const stockedSlots = inventory.length - lowStockSlots - outOfStockSlots;
  const overallInventoryPercent =
    totalCapacity > 0
      ? Math.min(100, Math.round((totalItems / totalCapacity) * 100))
      : 0;

  useEffect(() => {
    async function loadMachine() {
      try {
        const [machineSnap, inventorySnap] = await Promise.all([
          getDoc(doc(db, "machines", machineId)),
          getDocs(collection(db, "machines", machineId, "inventory")),
        ]);

        if (machineSnap.exists()) {
          setMachine(machineSnap.data());
        } else {
          setError(`Machine '${machineId}' was not found.`);
          return;
        }

        setInventory(
          inventorySnap.docs.map((slotDoc) => ({
            id: slotDoc.id,
            ...(slotDoc.data() as Omit<InventorySlot, "id">),
          }))
        );
      }  catch (err) {
        console.error("Firestore load failed:", err);
      
        if (err instanceof Error) {
          setError(`Failed to connect to Firestore: ${err.message}`);
        } else {
          setError("Failed to connect to Firestore: unknown error");
        }
      }
    }

    loadMachine();
  }, [machineId]);

  const salesOnly = mockSalesEvents.filter((event) => event.type === "sale");
  const totalRevenueCents = salesOnly.reduce(
    (sum, event) => sum + (event.amount_cents ?? 0),
    0
  );
  const successfulVends = mockSalesEvents.filter(
    (event) => event.type === "vend_success"
  ).length;
  const failedVends = mockSalesEvents.filter(
    (event) => event.type === "vend_failed"
  ).length;

return (
  <main className="min-h-screen bg-gray-100 px-4 py-8 text-gray-900 sm:px-8">
    <Link
      href="/"
      className="fixed left-4 top-4 z-20 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-green-700"
    >
      ← Return To Fleet Overview
    </Link>

    <div className="mx-auto max-w-5xl pt-12">
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">SellMate Dashboard</h1>
          <p className="mt-2 text-gray-600">Remote machine operations and performance.</p>

          <div className="mt-6 flex w-fit rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveView("overview")}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                activeView === "overview"
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Machine Detail
            </button>
            <button
              type="button"
              onClick={() => setActiveView("sales")}
              className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                activeView === "sales"
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Sales & Events
            </button>
          </div>
        </header>

        {activeView === "sales" ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Revenue today</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  ${(totalRevenueCents / 100).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p className="mt-1 text-sm text-green-700">From {salesOnly.length} sales</p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-blue-700">Orders today</p>
                <p className="mt-2 text-3xl font-bold text-blue-900">{salesOnly.length}</p>
                <p className="mt-1 text-sm text-blue-700">Completed payments</p>
              </div>

              <div className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-green-700">Successful vends</p>
                <p className="mt-2 text-3xl font-bold text-green-900">{successfulVends}</p>
                <p className="mt-1 text-sm text-green-700">Confirmed by machine</p>
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
                <p className="text-sm font-medium text-red-700">Vend issues</p>
                <p className="mt-2 text-3xl font-bold text-red-900">{failedVends}</p>
                <p className="mt-1 text-sm text-red-700">Needs review</p>
              </div>
            </section>

            <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 p-6">
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                  Activity Feed
                </p>
                <h2 className="mt-1 text-2xl font-semibold">Sales and machine events</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Proof-of-concept timeline using mock data.
                </p>
              </div>

              <div className="divide-y divide-gray-200">
                {mockSalesEvents.map((event) => {
                  const eventStyle =
                    event.type === "sale"
                      ? "bg-blue-100 text-blue-700"
                      : event.type === "vend_success"
                        ? "bg-green-100 text-green-700"
                        : event.type === "vend_failed"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700";

                  const eventLabel =
                    event.type === "sale"
                      ? "Sale"
                      : event.type === "vend_success"
                        ? "Vend"
                        : event.type === "vend_failed"
                          ? "Issue"
                          : "Inventory";

                  return (
                    <article
                      key={event.id}
                      className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${eventStyle}`}>
                          {eventLabel}
                        </span>
                        <div>
                          <h3 className="font-semibold text-gray-900">{event.title}</h3>
                          <p className="mt-1 text-sm text-gray-500">{event.detail}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-6 sm:justify-end">
                        {typeof event.amount_cents === "number" ? (
                          <p className="font-semibold text-gray-900">
                            ${(event.amount_cents / 100).toFixed(2)}
                          </p>
                        ) : null}
                        <p className="min-w-20 text-right text-sm font-medium text-gray-500">
                          {event.time}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
            <h2 className="text-2xl font-bold text-red-700">Machine Not Found</h2>
            <p className="mt-2 text-red-600">{error}</p>
          </div>
        ) : machine ? (
          <>
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                  Machine
                </p>
                <h2 className="mt-1 text-2xl font-semibold">
                  {machine.display_name ?? "Unnamed machine"}
                </h2>
                <p className="mt-1 font-mono text-sm text-gray-500">{machineId}</p>
              </div>

              <span
                className={`w-fit rounded-full px-3 py-1 text-sm font-semibold capitalize ${
                  machine.status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {machine.status ?? "unknown"}
              </span>
            </div>

            <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Template</p>
                <p className="mt-1 font-mono text-sm font-semibold text-gray-900">
                  {machine.template_id ?? "Not assigned"}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Stripe reader</p>
                <p className="mt-1 font-mono text-sm font-semibold text-gray-900">
                  {machine.stripe_reader_id ?? "Not assigned"}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Last updated</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatTimestamp(machine.updated_at)}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Latitude</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {machine.location?.latitude ?? "Not available"}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500">Longitude</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {machine.location?.longitude ?? "Not available"}
                </p>
              </div>
            </div>
          </section>

          <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-6">
              <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                Inventory
              </p>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Machine inventory</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Current stock by vending slot.
                  </p>
                </div>
                <p className="text-sm font-medium text-gray-600">
                  {inventory.length} slots loaded
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-b border-gray-200 bg-gray-50 p-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Items in stock</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">{totalItems}</p>
                <p className="mt-1 text-sm text-gray-500">
                  of {totalCapacity || "?"} total capacity
                </p>
              </div>

              <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm">
                <p className="text-sm font-medium text-green-700">Stocked slots</p>
                <p className="mt-2 text-3xl font-bold text-green-800">{stockedSlots}</p>
                <p className="mt-1 text-sm text-green-700">Healthy inventory level</p>
              </div>

              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
                <p className="text-sm font-medium text-yellow-700">Low-stock slots</p>
                <p className="mt-2 text-3xl font-bold text-yellow-800">{lowStockSlots}</p>
                <p className="mt-1 text-sm text-yellow-700">At or below 25%</p>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm">
                <p className="text-sm font-medium text-red-700">Out-of-stock slots</p>
                <p className="mt-2 text-3xl font-bold text-red-800">{outOfStockSlots}</p>
                <p className="mt-1 text-sm text-red-700">Needs restocking</p>
              </div>
            </div>

            <div className="border-b border-gray-200 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Overall inventory level</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {overallInventoryPercent}%
                  </p>
                </div>
                <p className="text-sm font-medium text-gray-600">
                  {totalItems} / {totalCapacity || "?"} items
                </p>
              </div>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full ${
                    overallInventoryPercent <= 25
                      ? "bg-red-500"
                      : overallInventoryPercent <= 50
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{ width: `${overallInventoryPercent}%` }}
                />
              </div>
            </div>

            {inventory.length > 0 ? (
              <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
                {inventory.map((slot) => {
                  const count = getInventoryCount(slot);
                  const capacity = slot.capacity ?? 0;
                  const percent = getInventoryPercent(slot);
                  const isOut = count <= 0;
                  const isLow = !isOut && percent <= 25;

                  return (
                    <article
                      key={slot.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      {slot.imageUrl ? (
                        <img
                          src={slot.imageUrl}
                          alt={getProductName(slot)}
                          className="mb-4 h-32 w-full rounded-lg object-cover"
                        />
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm font-semibold text-gray-500">
                            {slot.slot_id ?? slot.id}
                          </p>
                          <h3 className="mt-1 font-semibold text-gray-900">
                            {getProductName(slot)}
                          </h3>
                          {typeof slot.price_cents === "number" ? (
                            <p className="mt-1 text-sm font-medium text-gray-600">
                              ${(slot.price_cents / 100).toFixed(2)}
                            </p>
                          ) : null}
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isOut
                              ? "bg-red-100 text-red-700"
                              : isLow
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-green-100 text-green-700"
                          }`}
                        >
                          {isOut ? "Out" : isLow ? "Low" : "Stocked"}
                        </span>
                      </div>

                      <div className="mt-5 flex items-end justify-between">
                        <div>
                          <p className="text-3xl font-bold text-gray-900">{count}</p>
                          <p className="text-sm text-gray-500">
                            of {capacity || "?"} items
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-gray-600">{percent}%</p>
                      </div>

                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full ${
                            isOut
                              ? "bg-red-500"
                              : isLow
                                ? "bg-yellow-500"
                                : "bg-green-500"
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-gray-500">
                No inventory slots were found for this machine.
              </div>
            )}
          </section>
          </>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500 shadow-sm">
            Loading {machineId}…
          </div>
        )}
      </div>
    </main>
  );
}
