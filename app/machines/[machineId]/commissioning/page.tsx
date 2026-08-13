"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { CommissioningAuthGate } from "@/components/commissioning/auth-gate";
import { CommissioningWorkflow } from "@/components/commissioning/workflow";
import {
  canCommission,
  credentialsReady,
  emptyCredentials,
  loadCredentials,
  saveCredentials,
  subscribeCredentials,
  type CommissioningCredentials,
} from "@/lib/commissioning";

export default function MachineCommissioningPage() {
  const { machineId } = useParams<{ machineId: string }>();
  const stored = useSyncExternalStore(
    subscribeCredentials,
    loadCredentials,
    emptyCredentials
  );
  const [draft, setDraft] = useState<CommissioningCredentials | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const credentials = draft ?? stored;
  const canEnter =
    credentialsReady(credentials) && canCommission(credentials.role);
  const showGate = !unlocked || !canEnter;

  function handleCredentialsChange(next: CommissioningCredentials) {
    setDraft(next);
    saveCredentials(next);
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-8 text-gray-900 sm:px-8">
      <Link
        href={`/machines/${machineId}`}
        className="fixed left-4 top-4 z-20 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-green-700"
      >
        ← Back to machine
      </Link>

      <div className="mx-auto max-w-5xl pt-12">
        <header className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
            FEATURE-013
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">
            Hardware commissioning
          </h1>
          <p className="mt-2 text-gray-600">
            Technician laptop/tablet workflow for machine{" "}
            <span className="font-mono text-sm">{machineId}</span>. Discover
            motors, confirm shelf order, review diffs, and approve before the
            topology becomes active.
          </p>
        </header>

        {showGate ? (
          <CommissioningAuthGate
            credentials={credentials}
            onChange={handleCredentialsChange}
            onContinue={() => {
              saveCredentials(credentials);
              setDraft(null);
              setUnlocked(true);
            }}
          />
        ) : (
          <CommissioningWorkflow
            machineId={machineId}
            credentials={credentials}
            onChangeCredentials={() => setUnlocked(false)}
          />
        )}
      </div>
    </main>
  );
}
