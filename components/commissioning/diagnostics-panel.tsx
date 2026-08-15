"use client";

import { canViewDiagnostics } from "@/lib/commissioning";
import type {
  DiscoverySnapshot,
  TopologyPosition,
  TopologyRevision,
} from "@/lib/topology";

type CommissioningDiagnosticsPanelProps = {
  role: string;
  discovery?: DiscoverySnapshot | null;
  proposed?: TopologyRevision | null;
  open: boolean;
  onToggle: () => void;
};

function hardwareLine(position: TopologyPosition): string | null {
  if (!position.hardware) return null;
  const hw = position.hardware;
  const parts = [
    `bank ${hw.bank}`,
    `mask ${hw.mask}`,
    hw.controller ? `ctrl ${hw.controller}` : null,
    hw.i2c_bus ? `bus ${hw.i2c_bus}` : null,
    hw.i2c_address ? `addr ${hw.i2c_address}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function CommissioningDiagnosticsPanel({
  role,
  discovery,
  proposed,
  open,
  onToggle,
}: CommissioningDiagnosticsPanelProps) {
  if (!canViewDiagnostics(role)) {
    return (
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        Raw hardware identifiers and low-level diagnostics are restricted to
        technician and admin roles.
      </section>
    );
  }

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Diagnostics
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            Restricted hardware details
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Revealed on demand. Not part of the primary readiness UX.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        >
          {open ? "Hide diagnostics" : "Show diagnostics"}
        </button>
      </div>

      {open ? (
        <div className="space-y-6 p-6">
          <div>
            <h3 className="font-semibold text-gray-900">Discovery motors</h3>
            {!discovery?.motors?.length ? (
              <p className="mt-2 text-sm text-gray-500">
                No discovery snapshot loaded.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200">
                {discovery.motors.map((motor) => (
                  <li
                    key={motor.discovery_id}
                    className="px-4 py-3 font-mono text-xs text-gray-800"
                  >
                    {motor.discovery_id} · bank {motor.bank} · mask {motor.mask}
                    {motor.electrically_detected
                      ? " · electrically detected"
                      : " · no electrical response"}
                    {motor.probe_result ? ` · ${motor.probe_result}` : ""}
                    {motor.activation_duration_ms != null
                      ? ` · ${motor.activation_duration_ms}ms`
                      : ""}
                    {motor.legacy_slot_hint
                      ? ` · hint ${motor.legacy_slot_hint}`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
            {discovery?.sensing ? (
              <p className="mt-3 font-mono text-xs text-gray-600">
                sensing preferred={discovery.sensing.preferred_verification}{" "}
                tof={String(discovery.sensing.tof_available)} beam=
                {String(discovery.sensing.beam_available)}
                {discovery.sensing.tof_sensor
                  ? ` sensor=${discovery.sensing.tof_sensor}`
                  : ""}
              </p>
            ) : null}
          </div>

          <div>
            <h3 className="font-semibold text-gray-900">
              Proposed position hardware
            </h3>
            {!proposed ? (
              <p className="mt-2 text-sm text-gray-500">
                No proposed revision yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200">
                {proposed.shelves.flatMap((shelf) =>
                  (shelf.positions ?? []).map((position) => (
                    <li
                      key={position.position_id}
                      className="px-4 py-3 text-xs text-gray-800"
                    >
                      <span className="font-semibold">
                        {position.label || position.position_id}
                      </span>
                      <span className="mt-1 block font-mono text-gray-600">
                        {hardwareLine(position) ?? "no hardware ref"}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
