/**
 * Browser-side commissioning credentials.
 *
 * Stores operator token / role / local Pi key in sessionStorage so the
 * dashboard can call cloud or local Wi-Fi APIs without a parallel auth system.
 * Secrets are never committed; values come from operator paste / env defaults.
 */

import {
  ROLE_TECHNICIAN,
  normalizeRole,
  type SellMateRole,
} from "./auth";
import { stripTrailingSlash } from "./urls";

export type CommissioningTransport = "remote" | "local";

export type CommissioningCredentials = {
  transport: CommissioningTransport;
  role: SellMateRole;
  /** Cloud operator token (X-Operator-Token). */
  operatorToken: string;
  /** Local Pi VEND_API_KEY (X-API-Key). */
  localApiKey: string;
  /** Optional technician PIN for local /commissioning/start. */
  technicianPin: string;
  /** Override cloud base URL for this session. */
  cloudBaseUrl: string;
  /** Local Pi base URL, e.g. http://192.168.1.50:8000 */
  localBaseUrl: string;
  actor: string;
};

const STORAGE_KEY = "sellmate.commissioning.credentials.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let memoryCache: CommissioningCredentials | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeCredentials(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function defaultCloudBaseUrl(): string {
  return (
    stripTrailingSlash(process.env.NEXT_PUBLIC_SELLMATE_CLOUD_URL || "") ||
    "http://localhost:8080"
  );
}

export function defaultLocalBaseUrl(): string {
  return (
    stripTrailingSlash(process.env.NEXT_PUBLIC_SELLMATE_PI_URL || "") ||
    "http://127.0.0.1:8000"
  );
}

export function emptyCredentials(): CommissioningCredentials {
  return {
    transport: "remote",
    role: ROLE_TECHNICIAN,
    operatorToken: "",
    localApiKey: "",
    technicianPin: "",
    cloudBaseUrl: defaultCloudBaseUrl(),
    localBaseUrl: defaultLocalBaseUrl(),
    actor: "",
  };
}

function readStorage(): CommissioningCredentials {
  if (typeof window === "undefined") return emptyCredentials();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCredentials();
    const parsed = JSON.parse(raw) as Partial<CommissioningCredentials>;
    const base = emptyCredentials();
    return {
      transport: parsed.transport === "local" ? "local" : "remote",
      role: normalizeRole(parsed.role, ROLE_TECHNICIAN),
      operatorToken: String(parsed.operatorToken ?? ""),
      localApiKey: String(parsed.localApiKey ?? ""),
      technicianPin: String(parsed.technicianPin ?? ""),
      cloudBaseUrl: stripTrailingSlash(
        String(parsed.cloudBaseUrl || base.cloudBaseUrl)
      ),
      localBaseUrl: stripTrailingSlash(
        String(parsed.localBaseUrl || base.localBaseUrl)
      ),
      actor: String(parsed.actor ?? ""),
    };
  } catch {
    return emptyCredentials();
  }
}

export function loadCredentials(): CommissioningCredentials {
  if (!memoryCache) {
    memoryCache = readStorage();
  }
  return memoryCache;
}

export function saveCredentials(creds: CommissioningCredentials): void {
  const normalized: CommissioningCredentials = {
    ...creds,
    cloudBaseUrl: stripTrailingSlash(creds.cloudBaseUrl),
    localBaseUrl: stripTrailingSlash(creds.localBaseUrl),
    role: normalizeRole(creds.role, ROLE_TECHNICIAN),
  };
  memoryCache = normalized;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  emit();
}

export function clearCredentials(): void {
  memoryCache = emptyCredentials();
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  emit();
}

export function credentialsReady(creds: CommissioningCredentials): boolean {
  if (creds.transport === "remote") {
    return Boolean(creds.operatorToken.trim() && creds.cloudBaseUrl.trim());
  }
  return Boolean(creds.localApiKey.trim() && creds.localBaseUrl.trim());
}
