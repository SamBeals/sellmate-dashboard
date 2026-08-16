import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYTICS_TIMEOUT_MS,
  analyticsWarning,
  mapFailedVendMachineIds,
  mapMachineDocuments,
  mapSuccessfulOrders,
  salesQueryStartDate,
  settled,
  startOfDay,
  withTimeout,
} from "./fleet";

describe("fleet overview loading", () => {
  it("keeps machines when sales and vend analytics fail independently", async () => {
    const machines = await settled(Promise.resolve(["machine_1"]));
    const orders = await settled(
      Promise.reject(new Error("orders permission-denied"))
    );
    const vendJobs = await settled(
      withTimeout(
        new Promise<never>(() => {}),
        20,
        "vend_jobs"
      )
    );

    assert.equal(machines.ok, true);
    if (machines.ok) {
      assert.deepEqual(machines.value, ["machine_1"]);
    }
    assert.equal(orders.ok, false);
    assert.equal(vendJobs.ok, false);
    assert.equal(
      analyticsWarning({ ordersFailed: true, vendJobsFailed: true }),
      "Sales and vend analytics could not be loaded. Machine access is still available."
    );
  });

  it("preserves successful orders and failed-vend markers when analytics resolve", () => {
    const createdAt = {
      toDate: () => new Date("2026-08-15T12:00:00"),
    };

    const orders = mapSuccessfulOrders([
      {
        amount_cents: 1800,
        created_at: createdAt,
        machine_id: "machine_1",
        status: "COMPLETED",
      },
      {
        amount_cents: 900,
        created_at: createdAt,
        machine_id: "machine_1",
        status: "FAILED",
      },
    ]);
    const failedVendIds = mapFailedVendMachineIds([
      { status: "FAILED", machine_id: "machine_1" },
      { status: "SUCCESS", machine_id: "machine_2" },
    ]);

    assert.equal(orders.length, 1);
    assert.equal(orders[0].amountCents, 1800);
    assert.equal(failedVendIds.has("machine_1"), true);
    assert.equal(failedVendIds.has("machine_2"), false);
    assert.equal(
      analyticsWarning({ ordersFailed: false, vendJobsFailed: false }),
      null
    );
  });

  it("maps machine documents without waiting on analytics fields", () => {
    const machines = mapMachineDocuments([
      {
        id: "pi-lab",
        data: {
          display_name: " Lab Pi ",
          status: "Active",
          health_status: "healthy",
          health_issue_count: 0,
        },
      },
    ]);

    assert.equal(machines[0].id, "pi-lab");
    assert.equal(machines[0].displayName, "Lab Pi");
    assert.equal(machines[0].status, "active");
  });

  it("times out hung queries so the fleet UI can continue", async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => {}), 15, "orders"),
      /orders timed out after 15ms/
    );
    assert.equal(ANALYTICS_TIMEOUT_MS > 0, true);
  });

  it("uses the earlier of week or month start for the sales query window", () => {
    const reference = new Date(2026, 7, 15, 18, 0, 0);
    const start = salesQueryStartDate(reference);
    assert.deepEqual(start, startOfDay(new Date(2026, 7, 1)));
  });
});
