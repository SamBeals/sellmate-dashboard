"use client";

import {
  ROLE_ADMIN,
  ROLE_TECHNICIAN,
  ROLE_TRUSTED_VENDOR,
  ROLE_VENDOR,
  canCommission,
  credentialsReady,
  roleLabel,
  type CommissioningCredentials,
  type CommissioningTransport,
  type SellMateRole,
} from "@/lib/commissioning";

type CommissioningAuthGateProps = {
  credentials: CommissioningCredentials;
  onChange: (next: CommissioningCredentials) => void;
  onContinue: () => void;
};

const ROLE_OPTIONS: SellMateRole[] = [
  ROLE_TECHNICIAN,
  ROLE_TRUSTED_VENDOR,
  ROLE_ADMIN,
  ROLE_VENDOR,
];

export function CommissioningAuthGate({
  credentials,
  onChange,
  onContinue,
}: CommissioningAuthGateProps) {
  const ready = credentialsReady(credentials);
  const allowed = canCommission(credentials.role);

  function patch(partial: Partial<CommissioningCredentials>) {
    onChange({ ...credentials, ...partial });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Access
        </p>
        <h2 className="mt-1 text-2xl font-semibold">Commissioning credentials</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reuses SellMate operator / Pi API tokens with an explicit role. Vendor
          role can only view approved layout elsewhere — not this workflow.
        </p>
      </div>

      <div className="grid gap-4 p-6 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Transport</span>
          <select
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            value={credentials.transport}
            onChange={(e) =>
              patch({
                transport: e.target.value as CommissioningTransport,
              })
            }
          >
            <option value="remote">Remote (SellMate Cloud)</option>
            <option value="local">Local Wi-Fi (sellmate-pi)</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-gray-700">Role</span>
          <select
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            value={credentials.role}
            onChange={(e) =>
              patch({ role: e.target.value as SellMateRole })
            }
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </label>

        {credentials.transport === "remote" ? (
          <>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-gray-700">
                Cloud base URL
              </span>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                value={credentials.cloudBaseUrl}
                onChange={(e) => patch({ cloudBaseUrl: e.target.value })}
                placeholder="https://…run.app"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-gray-700">
                Operator token (X-Operator-Token)
              </span>
              <input
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                value={credentials.operatorToken}
                onChange={(e) => patch({ operatorToken: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-gray-700">
                Pi base URL
              </span>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                value={credentials.localBaseUrl}
                onChange={(e) => patch({ localBaseUrl: e.target.value })}
                placeholder="http://192.168.x.x:8000"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">
                Local API key (X-API-Key)
              </span>
              <input
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                value={credentials.localApiKey}
                onChange={(e) => patch({ localApiKey: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">
                Technician PIN (optional)
              </span>
              <input
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                value={credentials.technicianPin}
                onChange={(e) => patch({ technicianPin: e.target.value })}
              />
            </label>
          </>
        )}

        <label className="block text-sm sm:col-span-2">
          <span className="font-medium text-gray-700">Actor label</span>
          <input
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            value={credentials.actor}
            onChange={(e) => patch({ actor: e.target.value })}
            placeholder="tech@example.com"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          {!allowed
            ? "Selected role cannot open commissioning controls."
            : !ready
              ? "Enter credentials for the selected transport."
              : `Ready as ${roleLabel(credentials.role)} via ${
                  credentials.transport === "remote" ? "cloud" : "local Wi-Fi"
                }.`}
        </p>
        <button
          type="button"
          disabled={!ready || !allowed}
          onClick={onContinue}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          Continue to commissioning
        </button>
      </div>
    </section>
  );
}
