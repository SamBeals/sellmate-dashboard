/**
 * Hybrid FEATURE-013 commissioning client.
 *
 * One topology domain, two transports:
 *   - remote: dashboard → SellMate Cloud (operator token + role)
 *   - local:  dashboard → sellmate-pi vend_api on machine LAN (API key + role)
 */

import {
  parseTopologyRevision,
  type CommissioningSession,
  type DiscoverySnapshot,
  type PlanogramImpact,
  type TopologyRevision,
  type TopologyShelf,
} from "@/lib/topology";
import { normalizeRole, type SellMateRole } from "./auth";
import type {
  CommissioningCredentials,
  CommissioningTransport,
} from "./credentials";

export type TopologyDiff = {
  added_position_ids?: string[];
  removed_position_ids?: string[];
  added_legacy_slot_ids?: string[];
  removed_legacy_slot_ids?: string[];
  remapped_legacy_slot_ids?: Array<Record<string, unknown>>;
  previous_revision_id?: string | null;
  proposed_revision_id?: string;
};

export type CurrentSessionResponse = {
  ok: boolean;
  machine_id?: string;
  role?: string;
  session: CommissioningSession | null;
  out_of_service: boolean;
  proposed?: TopologyRevision | null;
  active?: TopologyRevision | null;
  customer_message?: string | null;
};

export type DiscoverResponse = {
  ok: boolean;
  discovery: DiscoverySnapshot | null;
  suggested_shelves?: TopologyShelf[];
  command?: Record<string, unknown> | null;
};

export type ProposeResponse = {
  ok: boolean;
  revision: TopologyRevision | null;
  blocked?: boolean;
  diff?: TopologyDiff | null;
  planogram_impact?: PlanogramImpact | null;
  command?: Record<string, unknown> | null;
};

export type ApproveResponse = {
  ok: boolean;
  revision: TopologyRevision | null;
  activated?: boolean;
  legacy_slot_map?: Record<string, unknown>;
};

export class CommissioningApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "CommissioningApiError";
    this.status = status;
    this.body = body;
  }
}

function parseSession(
  raw: Record<string, unknown> | null | undefined
): CommissioningSession | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    schema_version: Number(raw.schema_version ?? 1),
    session_id: String(raw.session_id ?? ""),
    machine_id: String(raw.machine_id ?? ""),
    status: String(raw.status ?? "idle"),
    started_at: String(raw.started_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    out_of_service: Boolean(raw.out_of_service ?? false),
    discovery: (raw.discovery as DiscoverySnapshot | null) ?? null,
    proposed_revision_id: (raw.proposed_revision_id as string | null) ?? null,
    active_revision_id_at_start:
      (raw.active_revision_id_at_start as string | null) ?? null,
    technician_actor: (raw.technician_actor as string | null) ?? null,
    block_reason: (raw.block_reason as string | null) ?? null,
  };
}

function parseRevision(
  raw: Record<string, unknown> | null | undefined
): TopologyRevision | null {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.revision_id) return null;
  return parseTopologyRevision(raw);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      return JSON.stringify(detail);
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export class CommissioningClient {
  readonly machineId: string;
  readonly credentials: CommissioningCredentials;

  constructor(machineId: string, credentials: CommissioningCredentials) {
    this.machineId = machineId;
    this.credentials = credentials;
  }

  get transport(): CommissioningTransport {
    return this.credentials.transport;
  }

  get role(): SellMateRole {
    return normalizeRole(this.credentials.role);
  }

  private actor(): string {
    return this.credentials.actor.trim() || this.role;
  }

  private async request(
    url: string,
    init: RequestInit = {}
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-SellMate-Role", this.role);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (this.transport === "remote") {
      headers.set(
        "X-Operator-Token",
        this.credentials.operatorToken.trim()
      );
    } else {
      headers.set("X-API-Key", this.credentials.localApiKey.trim());
    }

    const res = await fetch(url, { ...init, headers });
    const body = await readJson(res);
    if (!res.ok) {
      throw new CommissioningApiError(
        errorMessage(body, `Request failed (${res.status})`),
        res.status,
        body
      );
    }
    return body;
  }

  private cloud(path: string): string {
    return `${this.credentials.cloudBaseUrl}/machines/${encodeURIComponent(
      this.machineId
    )}${path}`;
  }

  private local(path: string): string {
    return `${this.credentials.localBaseUrl}${path}`;
  }

  async getCurrent(): Promise<CurrentSessionResponse> {
    if (this.transport === "local") {
      const body = (await this.request(this.local("/commissioning/status"))) as {
        session?: Record<string, unknown> | null;
        out_of_service?: boolean;
        proposed?: Record<string, unknown> | null;
        active?: Record<string, unknown> | null;
        customer_message?: string | null;
        role?: string;
      };
      return {
        ok: true,
        machine_id: this.machineId,
        role: body.role,
        session: parseSession(body.session ?? null),
        out_of_service: Boolean(body.out_of_service),
        proposed: parseRevision(body.proposed ?? null),
        active: parseRevision(body.active ?? null),
        customer_message: body.customer_message ?? null,
      };
    }

    const body = (await this.request(
      this.cloud("/commissioning/current")
    )) as {
      session?: Record<string, unknown> | null;
      out_of_service?: boolean;
      role?: string;
    };
    return {
      ok: true,
      machine_id: this.machineId,
      role: body.role,
      session: parseSession(body.session ?? null),
      out_of_service: Boolean(body.out_of_service),
    };
  }

  async getActive(vendorSafe = true): Promise<{
    topology: TopologyRevision | null;
    diff?: TopologyDiff | null;
    review?: Record<string, unknown> | null;
  }> {
    if (this.transport === "local") {
      const body = (await this.request(
        this.local(
          `/topology/active?vendor_safe=${vendorSafe ? "true" : "false"}`
        )
      )) as { active?: Record<string, unknown> | null };
      return { topology: parseRevision(body.active ?? null) };
    }
    const qs = vendorSafe ? "vendor_safe=true" : "vendor_safe=false";
    const body = (await this.request(
      this.cloud(`/topology/active?${qs}`)
    )) as {
      topology?: Record<string, unknown> | null;
      review?: Record<string, unknown> | null;
    };
    return {
      topology: parseRevision(body.topology ?? null),
      review: body.review ?? null,
    };
  }

  async getProposed(): Promise<{
    topology: TopologyRevision | null;
    diff?: TopologyDiff | null;
  }> {
    if (this.transport === "local") {
      const current = await this.getCurrent();
      return { topology: current.proposed ?? null, diff: null };
    }
    try {
      const body = (await this.request(
        this.cloud("/topology/proposed")
      )) as {
        topology?: Record<string, unknown> | null;
        diff?: TopologyDiff | null;
      };
      return {
        topology: parseRevision(body.topology ?? null),
        diff: body.diff ?? null,
      };
    } catch (err) {
      if (err instanceof CommissioningApiError && err.status === 404) {
        return { topology: null, diff: null };
      }
      throw err;
    }
  }

  async startSession(): Promise<CurrentSessionResponse> {
    if (this.transport === "local") {
      const body = (await this.request(this.local("/commissioning/start"), {
        method: "POST",
        body: JSON.stringify({
          technician_actor: this.actor(),
          pin: this.credentials.technicianPin || undefined,
          role: this.role,
        }),
      })) as {
        session?: Record<string, unknown> | null;
        out_of_service?: boolean;
        customer_message?: string | null;
        role?: string;
      };
      return {
        ok: true,
        machine_id: this.machineId,
        role: body.role,
        session: parseSession(body.session ?? null),
        out_of_service: Boolean(body.out_of_service ?? true),
        customer_message: body.customer_message ?? null,
      };
    }

    const body = (await this.request(
      this.cloud("/commissioning/sessions"),
      {
        method: "POST",
        body: JSON.stringify({
          actor: this.actor(),
          enqueue_start_command: true,
        }),
      }
    )) as {
      session?: Record<string, unknown> | null;
      command?: Record<string, unknown> | null;
    };
    return {
      ok: true,
      machine_id: this.machineId,
      session: parseSession(body.session ?? null),
      out_of_service: true,
    };
  }

  async discover(): Promise<DiscoverResponse> {
    if (this.transport === "local") {
      const body = (await this.request(this.local("/commissioning/discover"), {
        method: "POST",
        body: JSON.stringify({}),
      })) as {
        discovery?: DiscoverySnapshot | null;
        suggested_shelves?: TopologyShelf[];
      };
      return {
        ok: true,
        discovery: body.discovery ?? null,
        suggested_shelves: body.suggested_shelves,
      };
    }

    const current = await this.getCurrent();
    const sessionId = current.session?.session_id;
    const command = (await this.request(
      this.cloud("/commissioning/commands"),
      {
        method: "POST",
        body: JSON.stringify({
          type: "discover",
          actor: this.actor(),
          session_id: sessionId ?? null,
          payload: {},
        }),
      }
    )) as { command?: Record<string, unknown> };

    // Poll session until discovery lands (Pi publishes via hybrid path).
    let discovery: DiscoverySnapshot | null = null;
    for (let i = 0; i < 15; i += 1) {
      await sleep(1000);
      const snap = await this.getCurrent();
      if (snap.session?.discovery) {
        discovery = snap.session.discovery;
        break;
      }
    }
    return {
      ok: true,
      discovery,
      command: command.command ?? null,
    };
  }

  async proposeLayout(
    shelves: Array<Record<string, unknown>>,
    existingPlanogramSlotIds?: string[]
  ): Promise<ProposeResponse> {
    if (this.transport === "local") {
      const body = (await this.request(this.local("/commissioning/propose"), {
        method: "POST",
        body: JSON.stringify({
          shelves,
          existing_planogram_slot_ids: existingPlanogramSlotIds,
        }),
      })) as {
        proposed?: Record<string, unknown> | null;
        blocked?: boolean;
      };
      return {
        ok: true,
        revision: parseRevision(body.proposed ?? null),
        blocked: Boolean(body.blocked),
        planogram_impact:
          (body.proposed?.planogram_impact as PlanogramImpact | null) ?? null,
      };
    }

    const proposed = await this.getProposed();
    let revisionId = proposed.topology?.revision_id;
    if (!revisionId) {
      const current = await this.getCurrent();
      revisionId = current.session?.proposed_revision_id ?? undefined;
    }
    if (!revisionId) {
      // Remote path: enqueue propose so Pi builds the revision, then poll.
      const current = await this.getCurrent();
      await this.request(this.cloud("/commissioning/commands"), {
        method: "POST",
        body: JSON.stringify({
          type: "propose",
          actor: this.actor(),
          session_id: current.session?.session_id ?? null,
          payload: {
            shelves,
            existing_planogram_slot_ids: existingPlanogramSlotIds,
          },
        }),
      });
      for (let i = 0; i < 15; i += 1) {
        await sleep(1000);
        const again = await this.getProposed();
        if (again.topology) {
          return {
            ok: true,
            revision: again.topology,
            diff: again.diff,
            blocked: Boolean(again.topology.planogram_impact?.destructive),
            planogram_impact: again.topology.planogram_impact ?? null,
          };
        }
      }
      throw new CommissioningApiError(
        "Proposed topology not available yet after remote propose",
        408,
        null
      );
    }

    const body = (await this.request(
      this.cloud(`/topology/revisions/${encodeURIComponent(revisionId)}/layout`),
      {
        method: "POST",
        body: JSON.stringify({
          shelves,
          actor: this.actor(),
          existing_planogram_slot_ids: existingPlanogramSlotIds,
          enqueue_propose_command: true,
        }),
      }
    )) as {
      revision?: Record<string, unknown> | null;
      diff?: TopologyDiff | null;
      planogram_impact?: PlanogramImpact | null;
      command?: Record<string, unknown> | null;
    };
    const revision = parseRevision(body.revision ?? null);
    return {
      ok: true,
      revision,
      diff: body.diff ?? null,
      planogram_impact:
        body.planogram_impact ?? revision?.planogram_impact ?? null,
      blocked: Boolean(
        body.planogram_impact?.destructive ??
          revision?.planogram_impact?.destructive
      ),
      command: body.command ?? null,
    };
  }

  async approve(revisionId: string, force = false): Promise<ApproveResponse> {
    if (this.transport === "local") {
      const body = (await this.request(this.local("/commissioning/confirm"), {
        method: "POST",
        body: JSON.stringify({
          force,
          actor: this.actor(),
        }),
      })) as { active?: Record<string, unknown> | null };
      return {
        ok: true,
        revision: parseRevision(body.active ?? null),
        activated: true,
      };
    }

    const body = (await this.request(
      this.cloud(
        `/topology/revisions/${encodeURIComponent(revisionId)}/approve`
      ),
      {
        method: "POST",
        body: JSON.stringify({
          force,
          actor: this.actor(),
        }),
      }
    )) as {
      revision?: Record<string, unknown> | null;
      activated?: boolean;
      legacy_slot_map?: Record<string, unknown>;
    };
    return {
      ok: true,
      revision: parseRevision(body.revision ?? null),
      activated: Boolean(body.activated),
      legacy_slot_map: body.legacy_slot_map,
    };
  }

  async reject(revisionId: string, reason?: string): Promise<ApproveResponse> {
    if (this.transport === "local") {
      await this.cancel();
      return { ok: true, revision: null };
    }
    const body = (await this.request(
      this.cloud(
        `/topology/revisions/${encodeURIComponent(revisionId)}/reject`
      ),
      {
        method: "POST",
        body: JSON.stringify({
          actor: this.actor(),
          reason: reason ?? null,
        }),
      }
    )) as { revision?: Record<string, unknown> | null };
    return {
      ok: true,
      revision: parseRevision(body.revision ?? null),
    };
  }

  async cancel(): Promise<void> {
    if (this.transport === "local") {
      await this.request(this.local("/commissioning/cancel"), {
        method: "POST",
        body: JSON.stringify({}),
      });
      return;
    }
    const current = await this.getCurrent();
    if (!current.session?.session_id) return;
    await this.request(this.cloud("/commissioning/commands"), {
      method: "POST",
      body: JSON.stringify({
        type: "cancel",
        actor: this.actor(),
        session_id: current.session.session_id,
        payload: {},
      }),
    });
  }

  async validatePosition(args: {
    bank: string;
    mask: number;
    position_id?: string;
  }): Promise<Record<string, unknown>> {
    if (this.transport === "local") {
      return (await this.request(
        this.local("/commissioning/validate_position"),
        {
          method: "POST",
          body: JSON.stringify(args),
        }
      )) as Record<string, unknown>;
    }
    const current = await this.getCurrent();
    const enqueued = (await this.request(
      this.cloud("/commissioning/commands"),
      {
        method: "POST",
        body: JSON.stringify({
          type: "validate_position",
          actor: this.actor(),
          session_id: current.session?.session_id ?? null,
          payload: args,
        }),
      }
    )) as { command?: { command_id?: string } };

    const commandId = enqueued.command?.command_id;
    if (!commandId) {
      return { ok: true, queued: true };
    }
    for (let i = 0; i < 30; i += 1) {
      await sleep(1000);
      const status = (await this.request(
        this.cloud(
          `/commissioning/commands/${encodeURIComponent(commandId)}`
        )
      )) as {
        command?: {
          status?: string;
          result?: Record<string, unknown>;
          error?: string;
        };
      };
      const cmd = status.command;
      if (!cmd) continue;
      if (cmd.status === "completed" || cmd.status === "succeeded") {
        return cmd.result ?? { ok: true };
      }
      if (cmd.status === "failed") {
        throw new CommissioningApiError(
          cmd.error || "Validation command failed",
          409,
          cmd
        );
      }
    }
    throw new CommissioningApiError(
      "Timed out waiting for remote lane validation",
      408,
      null
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCommissioningClient(
  machineId: string,
  credentials: CommissioningCredentials
): CommissioningClient {
  return new CommissioningClient(machineId, credentials);
}
