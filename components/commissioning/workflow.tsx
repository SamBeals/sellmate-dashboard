"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommissioningApiError,
  bindDiscoveryMotors,
  canForceActivate,
  cloneShelves,
  createCommissioningClient,
  shelvesForPropose,
  type CommissioningCredentials,
  type EditableShelf,
  type TopologyDiff,
} from "@/lib/commissioning";
import type {
  CommissioningSession,
  DiscoverySnapshot,
  PlanogramImpact,
  TopologyRevision,
} from "@/lib/topology";
import { CommissioningDiagnosticsPanel } from "./diagnostics-panel";
import { CommissioningDiffReview } from "./diff-review";
import { CommissioningTopologyCanvas } from "./topology-canvas";

const POLL_MS = 2500;

type CommissioningWorkflowProps = {
  machineId: string;
  credentials: CommissioningCredentials;
  onChangeCredentials: () => void;
};

export function CommissioningWorkflow({
  machineId,
  credentials,
  onChangeCredentials,
}: CommissioningWorkflowProps) {
  const client = useMemo(
    () => createCommissioningClient(machineId, credentials),
    [machineId, credentials]
  );

  const [session, setSession] = useState<CommissioningSession | null>(null);
  const [proposed, setProposed] = useState<TopologyRevision | null>(null);
  const [active, setActive] = useState<TopologyRevision | null>(null);
  const [discovery, setDiscovery] = useState<DiscoverySnapshot | null>(null);
  const [editableShelves, setEditableShelves] = useState<EditableShelf[]>([]);
  const [diff, setDiff] = useState<TopologyDiff | null>(null);
  const [impact, setImpact] = useState<PlanogramImpact | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [validatingPositionId, setValidatingPositionId] = useState<
    string | null
  >(null);
  const [outOfService, setOutOfService] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const current = await client.getCurrent();
      setSession(current.session);
      setOutOfService(current.out_of_service);
      if (current.session?.discovery) {
        setDiscovery(current.session.discovery);
      }
      if (current.proposed) {
        setProposed(current.proposed);
        setEditableShelves(cloneShelves(current.proposed.shelves));
        setImpact(current.proposed.planogram_impact ?? null);
        setBlocked(Boolean(current.proposed.planogram_impact?.destructive));
      }
      if (current.active) {
        setActive(current.active);
      }

      if (client.transport === "remote") {
        const [proposedRes, activeRes] = await Promise.all([
          client.getProposed(),
          client.getActive(false).catch(async () => client.getActive(true)),
        ]);
        if (proposedRes.topology) {
          setProposed(proposedRes.topology);
          setEditableShelves((prev) =>
            prev.length > 0
              ? prev
              : cloneShelves(proposedRes.topology!.shelves)
          );
          setImpact(proposedRes.topology.planogram_impact ?? null);
          setBlocked(
            Boolean(proposedRes.topology.planogram_impact?.destructive)
          );
        }
        if (proposedRes.diff) setDiff(proposedRes.diff);
        if (activeRes.topology) setActive(activeRes.topology);
      }
    } catch (err) {
      setError(
        err instanceof CommissioningApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to refresh commissioning state"
      );
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (!cancelled) await refresh();
    }
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  async function runAction(
    label: string,
    action: () => Promise<void>
  ): Promise<void> {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(
        err instanceof CommissioningApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : `${label} failed`
      );
    } finally {
      setBusy(null);
    }
  }

  const sessionStatus = session?.status ?? (outOfService ? "in_service_blocked" : "idle");

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
              Session
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              Commissioning controls
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Transport: {client.transport === "remote" ? "cloud remote" : "local Wi-Fi"} ·
              Role: {credentials.role}
              {session?.session_id ? ` · ${session.session_id}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                outOfService
                  ? "bg-amber-100 text-amber-900"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {outOfService ? "Out of service" : "In service"}
            </span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
              {String(sessionStatus).replaceAll("_", " ")}
            </span>
            <button
              type="button"
              onClick={onChangeCredentials}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Credentials
            </button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="border-b border-green-200 bg-green-50 px-6 py-3 text-sm text-green-800">
            {message}
          </div>
        ) : null}
        {session?.block_reason ? (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
            {session.block_reason}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 p-6">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              runAction("Starting session", async () => {
                await client.startSession();
                setMessage("Commissioning session started. Machine is out of service.");
              })
            }
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
          >
            Start discovery session
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              runAction("Discovering motors", async () => {
                const result = await client.discover();
                if (result.discovery) setDiscovery(result.discovery);
                if (result.suggested_shelves?.length) {
                  setEditableShelves(
                    bindDiscoveryMotors(
                      cloneShelves(result.suggested_shelves),
                      result.discovery?.motors ?? []
                    )
                  );
                }
                setMessage(
                  result.discovery
                    ? `Discovered ${result.discovery.candidate_count} motor candidate(s).`
                    : "Discover command sent; waiting for Pi publish."
                );
              })
            }
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
          >
            Run discovery
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || editableShelves.length === 0}
            onClick={() =>
              runAction("Saving layout", async () => {
                const result = await client.proposeLayout(
                  shelvesForPropose(editableShelves)
                );
                if (result.revision) {
                  setProposed(result.revision);
                  setEditableShelves(cloneShelves(result.revision.shelves));
                }
                if (result.diff) setDiff(result.diff);
                if (result.planogram_impact) setImpact(result.planogram_impact);
                setBlocked(Boolean(result.blocked));
                setMessage(
                  result.blocked
                    ? "Layout saved but activation is blocked for planogram review."
                    : "Proposed layout confirmed."
                );
              })
            }
            className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
          >
            Confirm / save layout
          </button>
          <button
            type="button"
            disabled={
              Boolean(busy) ||
              !proposed?.revision_id ||
              (blocked && !canForceActivate(credentials.role))
            }
            onClick={() =>
              runAction("Approving topology", async () => {
                const force = blocked && canForceActivate(credentials.role);
                const result = await client.approve(
                  proposed!.revision_id,
                  force
                );
                if (result.revision) setActive(result.revision);
                setMessage(
                  force
                    ? "Topology force-activated by admin."
                    : "Topology approved and activated."
                );
              })
            }
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
          >
            {blocked && canForceActivate(credentials.role)
              ? "Force approve (admin)"
              : "Approve active topology"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || !proposed?.revision_id}
            onClick={() =>
              runAction("Rejecting proposal", async () => {
                await client.reject(proposed!.revision_id);
                setMessage("Proposed topology rejected.");
              })
            }
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:text-gray-400"
          >
            Reject proposal
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              runAction("Cancelling session", async () => {
                await client.cancel();
                setMessage("Commissioning session cancelled.");
              })
            }
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:text-gray-400"
          >
            Cancel session
          </button>
          {busy ? (
            <p className="self-center text-sm font-medium text-gray-500">
              {busy}…
            </p>
          ) : null}
        </div>
      </section>

      <CommissioningTopologyCanvas
        shelves={
          editableShelves.length > 0
            ? editableShelves
            : proposed
              ? cloneShelves(proposed.shelves)
              : []
        }
        editable
        validatingPositionId={validatingPositionId}
        sensing={proposed?.sensing ?? discovery?.sensing ?? active?.sensing}
        onChange={setEditableShelves}
        onValidate={(positionId) => {
          const shelves =
            editableShelves.length > 0
              ? editableShelves
              : proposed
                ? cloneShelves(proposed.shelves)
                : [];
          const position = shelves
            .flatMap((s) => s.positions)
            .find((p) => p.position_id === positionId);
          if (!position?.hardware) {
            setError("Position has no hardware reference to validate.");
            return;
          }
          runAction("Validating lane", async () => {
            setValidatingPositionId(positionId);
            try {
              await client.validatePosition({
                bank: position.hardware!.bank,
                mask: position.hardware!.mask,
                position_id: positionId,
              });
              setMessage(`Lane ${position.label} validation requested.`);
            } finally {
              setValidatingPositionId(null);
            }
          });
        }}
      />

      <CommissioningDiffReview
        diff={diff}
        impact={impact ?? proposed?.planogram_impact}
        blocked={blocked || sessionStatus === "blocked_destructive"}
      />

      {active ? (
        <CommissioningTopologyCanvas
          shelves={cloneShelves(active.shelves)}
          editable={false}
          sensing={active.sensing}
          title="Currently active topology"
          subtitle="Approved layout in effect for downstream planogram/vend compatibility. Proposed changes do not replace this until approval."
        />
      ) : null}

      <CommissioningDiagnosticsPanel
        role={credentials.role}
        discovery={discovery ?? session?.discovery}
        proposed={proposed}
        open={diagnosticsOpen}
        onToggle={() => setDiagnosticsOpen((v) => !v)}
      />
    </div>
  );
}
