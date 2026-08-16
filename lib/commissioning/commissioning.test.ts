import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCommission,
  canForceActivate,
  canViewDiagnostics,
  cloneShelves,
  createCommissioningClient,
  joinApiUrl,
  movePosition,
  normalizeApiOrigin,
  normalizeRole,
  positionReadiness,
  renumberColumns,
  shelvesForPropose,
  stripTrailingSlash,
} from "./index";
import type { TopologyShelf } from "../topology";
import type { CommissioningCredentials } from "./credentials";

describe("FEATURE-013 commissioning auth", () => {
  it("normalizes role aliases and gates capabilities", () => {
    assert.equal(normalizeRole("tech"), "technician");
    assert.equal(normalizeRole("merchant"), "vendor");
    assert.equal(canCommission("vendor"), false);
    assert.equal(canCommission("trusted_vendor"), true);
    assert.equal(canCommission("technician"), true);
    assert.equal(canViewDiagnostics("trusted_vendor"), false);
    assert.equal(canViewDiagnostics("admin"), true);
    assert.equal(canForceActivate("technician"), false);
    assert.equal(canForceActivate("admin"), true);
  });
});

describe("FEATURE-013 layout reorder", () => {
  const shelves: TopologyShelf[] = [
    {
      shelf_id: "shelf_1",
      row_index: 0,
      label: "Shelf 1",
      positions: [
        {
          position_id: "pos_a",
          shelf_id: "shelf_1",
          column_index: 0,
          label: "A",
          legacy_slot_id: "S01",
          hardware: { bank: "A", mask: 1 },
          validation_status: "unvalidated",
          present: true,
        },
        {
          position_id: "pos_b",
          shelf_id: "shelf_1",
          column_index: 1,
          label: "B",
          legacy_slot_id: "S02",
          hardware: { bank: "A", mask: 2 },
          validation_status: "valid",
          present: true,
        },
      ],
    },
  ];

  it("moves positions left/right and renumbers columns", () => {
    const edited = movePosition(cloneShelves(shelves), "pos_b", "left");
    assert.equal(edited[0].positions[0].position_id, "pos_b");
    assert.equal(edited[0].positions[0].column_index, 0);
    assert.equal(edited[0].positions[1].position_id, "pos_a");
    assert.equal(edited[0].positions[1].column_index, 1);

    const payload = shelvesForPropose(edited);
    assert.equal(payload[0].positions[0].column_index, 0);
    assert.equal(payload[0].positions[0].bank, "A");
  });

  it("maps readiness statuses for visual UX", () => {
    assert.equal(
      positionReadiness({ present: false, validation_status: "valid" }),
      "missing"
    );
    assert.equal(
      positionReadiness({ present: true, validation_status: "valid" }),
      "valid"
    );
    assert.equal(
      positionReadiness({ present: true, validation_status: "failed" }),
      "failed"
    );
    assert.equal(
      positionReadiness(
        { present: true, validation_status: "unvalidated" },
        { validatingPositionId: "x", positionId: "x" }
      ),
      "validating"
    );
    assert.equal(
      positionReadiness({
        present: true,
        validation_status: "unvalidated",
        hardware: { bank: "A", mask: 1 },
      }),
      "discovered"
    );
  });

  it("keeps shelf row indexes contiguous after renumber", () => {
    const next = renumberColumns([
      {
        shelf_id: "s2",
        row_index: 9,
        label: "Two",
        positions: [
          {
            position_id: "p1",
            shelf_id: "s2",
            column_index: 5,
            label: "P1",
          },
        ],
      },
    ]);
    assert.equal(next[0].row_index, 0);
    assert.equal(next[0].positions[0].column_index, 0);
  });
});

describe("FEATURE-013 local Wi-Fi URL origin", () => {
  it("keeps http://host:port instead of a relative dashboard route", () => {
    const joined = joinApiUrl(
      "http://192.168.0.181:8000",
      "/commissioning/status",
      { defaultPort: 8000 }
    );
    assert.equal(
      joined,
      "http://192.168.0.181:8000/commissioning/status"
    );

    const page = "http://localhost:3000/machines/machine_001/commissioning";
    const brokenRelative = new URL("192.168.0.181/commissioning/status", page);
    assert.equal(
      brokenRelative.pathname,
      "/machines/machine_001/192.168.0.181/commissioning/status"
    );
    assert.notEqual(new URL(joined).pathname, brokenRelative.pathname);
  });

  it("recovers scheme/port when the operator entered only the Pi IP", () => {
    assert.equal(
      normalizeApiOrigin("192.168.0.181", { defaultPort: 8000 }),
      "http://192.168.0.181:8000"
    );
    assert.equal(
      joinApiUrl("192.168.0.181:8000", "/commissioning/start", {
        defaultPort: 8000,
      }),
      "http://192.168.0.181:8000/commissioning/start"
    );
  });

  it("does not strip the slashes from http:// while typing", () => {
    assert.equal(stripTrailingSlash("http://"), "http://");
    assert.equal(
      stripTrailingSlash("http://192.168.0.181:8000/"),
      "http://192.168.0.181:8000"
    );
  });
});

describe("FEATURE-013 local Wi-Fi commissioning requests", () => {
  const credentials: CommissioningCredentials = {
    transport: "local",
    role: "technician",
    operatorToken: "",
    localApiKey: "CHANGE_ME",
    technicianPin: "",
    cloudBaseUrl: "http://localhost:8080",
    localBaseUrl: "http://192.168.0.181:8000",
    actor: "tech",
  };

  const jsonOk = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("calls every local endpoint on the Pi origin with X-API-Key", async () => {
    const calls: Array<{ url: string; apiKey: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        apiKey: headers.get("X-API-Key"),
      });
      return jsonOk({
        ok: true,
        session: null,
        out_of_service: false,
        proposed: null,
        active: null,
        discovery: null,
        suggested_shelves: [],
      });
    }) as typeof fetch;

    try {
      const client = createCommissioningClient("machine_001", credentials);
      await client.getCurrent();
      await client.getActive(false);
      await client.startSession();
      await client.discover();
      await client.proposeLayout([]);
      await client.approve("rev_1");
      await client.cancel();
      await client.validatePosition({ bank: "A", mask: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const expected = [
      "http://192.168.0.181:8000/commissioning/status",
      "http://192.168.0.181:8000/topology/active?vendor_safe=false",
      "http://192.168.0.181:8000/commissioning/start",
      "http://192.168.0.181:8000/commissioning/discover",
      "http://192.168.0.181:8000/commissioning/propose",
      "http://192.168.0.181:8000/commissioning/confirm",
      "http://192.168.0.181:8000/commissioning/cancel",
      "http://192.168.0.181:8000/commissioning/validate_position",
    ];
    assert.deepEqual(
      calls.map((call) => call.url),
      expected
    );
    for (const call of calls) {
      assert.equal(call.apiKey, "CHANGE_ME");
      assert.match(call.url, /^http:\/\/192\.168\.0\.181:8000\//);
    }
  });
});

