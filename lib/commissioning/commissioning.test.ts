import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCommission,
  canForceActivate,
  canViewDiagnostics,
  cloneShelves,
  movePosition,
  normalizeRole,
  positionReadiness,
  renumberColumns,
  shelvesForPropose,
} from "./index";
import type { TopologyShelf } from "../topology";

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
