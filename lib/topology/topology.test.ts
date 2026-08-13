import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEGACY_SLOT_TO_HW,
  assessPlanogramImpact,
  buildLegacySlotMap,
  ensureVendorSafeTopology,
  migrateLegacySlotsToTopology,
  normalizeLegacySlotId,
  parseTopologyRevision,
  planogramSlotCompatRows,
  resolveDisplaySlot,
  resolveHw,
  sanitizeAuditDetails,
  toVendorSafeAuditEvent,
  toVendorSafeTopology,
  type TopologyAuditEvent,
} from "./index";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures"
);

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as T;
}

describe("FEATURE-013 topology schemas", () => {
  it("parses active fixture revision", () => {
    const raw = loadJson<Record<string, unknown>>("topology_active_v1.json");
    const revision = parseTopologyRevision(raw);
    assert.equal(revision.revision_id, "rev_fixture_active");
    assert.equal(revision.status, "active");
    assert.equal(revision.shelves[0].positions.length, 2);
    assert.equal(revision.shelves[0].positions[0].legacy_slot_id, "S01");
  });

  it("loads discovery simulation fixture", () => {
    const discovery = loadJson<{ motors: unknown[]; candidate_count: number }>(
      "discovery_motors_sim.json"
    );
    assert.equal(discovery.candidate_count, 6);
    assert.equal(discovery.motors.length, 6);
  });
});

describe("legacy slot compatibility", () => {
  it("builds legacy slot map from active topology", () => {
    const revision = parseTopologyRevision(
      loadJson("topology_active_v1.json")
    );
    const map = buildLegacySlotMap(revision);
    assert.ok(map.S01);
    assert.equal(map.S01.position_id, "pos_s01");
    assert.equal(map.S01.bank, "A");
    assert.equal(map.S01.mask, 1);
  });

  it("resolves vend identifiers through active topology then static legacy", () => {
    const revision = parseTopologyRevision(
      loadJson("topology_active_v1.json")
    );
    const fromLegacy = resolveHw("S01", revision);
    assert.equal(fromLegacy.source, "active_topology");
    assert.equal(fromLegacy.position_id, "pos_s01");

    const fromPosition = resolveHw("pos_s02", revision);
    assert.equal(fromPosition.legacy_slot_id, "S02");

    const staticOnly = resolveHw("S03", null);
    assert.equal(staticOnly.source, "legacy_static");
    assert.equal(staticOnly.mask, LEGACY_SLOT_TO_HW.S03.mask);
  });

  it("maps position ids back to planogram legacy slots", () => {
    const revision = parseTopologyRevision(
      loadJson("topology_active_v1.json")
    );
    assert.equal(resolveDisplaySlot("pos_s01", revision), "S01");
    assert.equal(normalizeLegacySlotId(" s02 "), "S02");
  });
});

describe("legacy migration path", () => {
  it("preserves legacy slot ids and planogram-compatible rows", () => {
    const revision = migrateLegacySlotsToTopology({
      machineId: "machine_test",
      revisionId: "rev_migration_test",
      status: "proposed",
    });
    assert.equal(revision.migration_from_legacy, true);
    assert.equal(revision.status, "proposed");
    const slots = revision.shelves[0].positions.map((p) => p.legacy_slot_id);
    assert.deepEqual(slots, ["S01", "S02", "S03", "S04", "S05", "S06"]);

    const rows = planogramSlotCompatRows(revision);
    assert.equal(rows.length, 6);
    assert.equal(rows[0].slot_id, "S01");
    assert.equal(rows[0].topology_revision_id, "rev_migration_test");
  });

  it("flags destructive planogram impact on shrink", () => {
    const active = migrateLegacySlotsToTopology({
      machineId: "machine_test",
      status: "active",
    });
    const slim = migrateLegacySlotsToTopology({
      machineId: "machine_test",
      legacyMap: { S01: LEGACY_SLOT_TO_HW.S01 },
      status: "proposed",
    });
    const impact = assessPlanogramImpact({
      existingLegacySlotIds: Object.keys(LEGACY_SLOT_TO_HW),
      proposed: slim,
      active,
    });
    assert.equal(impact.destructive, true);
    assert.ok(impact.removed_legacy_slot_ids?.includes("S02"));
    assert.ok(impact.preserved_legacy_slot_ids?.includes("S01"));
  });
});

describe("vendor-safe dashboard views", () => {
  it("strips hardware from active topology", () => {
    const revision = parseTopologyRevision(
      loadJson("topology_active_v1.json")
    );
    const vendor = toVendorSafeTopology(revision);
    assert.equal(vendor.shelves[0].positions[0].legacy_slot_id, "S01");
    assert.equal(
      "hardware" in vendor.shelves[0].positions[0],
      false
    );
    assert.equal(vendor.sensing.tof_available, true);

    const ensured = ensureVendorSafeTopology(revision);
    assert.ok(ensured);
    assert.equal(
      "hardware" in ensured.shelves[0].positions[0],
      false
    );
  });

  it("sanitizes audit events for merchant display", () => {
    const events = loadJson<TopologyAuditEvent[]>("topology_audit_sample.json");
    const safe = toVendorSafeAuditEvent(events[0]);
    assert.equal(safe.event_type, "migration_imported");
    assert.ok(safe.summary.length > 0);

    const cleaned = sanitizeAuditDetails(events[0].details);
    assert.equal("hardware" in cleaned, false);
    assert.equal(cleaned.legacy_slot_count, 6);

    const approved = sanitizeAuditDetails(events[1].details);
    assert.equal("bank" in approved, false);
    assert.equal("mask" in approved, false);
    assert.equal(approved.position_count, 2);
  });
});
