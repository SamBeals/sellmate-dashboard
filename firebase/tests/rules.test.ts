/**
 * Rules tests for current production behavior (R0) and the undeployed
 * lockdown (R0a). The emulator only. Refuses the production project.
 *
 * Admin SDK behavior is represented by withSecurityRulesDisabled. Production
 * Cloud Run uses google.cloud.firestore, which does not evaluate these rules.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  type Firestore,
  where,
} from "firebase/firestore";

const PRODUCTION_PROJECT = "sellmate-bdd22";
const project = process.env.GCLOUD_PROJECT ?? "demo-sellmate";

if (project === PRODUCTION_PROJECT) {
  throw new Error(
    `Refusing to run rules tests against ${PRODUCTION_PROJECT}. Use --project demo-sellmate.`,
  );
}

const rulesDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const r0Rules = readFileSync(resolve(rulesDir, "firestore.rules"), "utf8");
const r0aRules = readFileSync(
  resolve(rulesDir, "proposals/firestore.r0a.rules"),
  "utf8",
);

const LOCKED_DOCS = [
  "checkout_sessions/cs1",
  "stripe_event_receipts/ev1",
  "machines/m1/commands/c1",
  "machines/m1/activity/a1",
] as const;

const PUBLIC_DOCS = [
  "machines/m1",
  "machines/m1/inventory/s1",
  "machines/m1/planogramSlots/s1",
  "orders/o1",
  "vend_jobs/v1",
] as const;

function emulatorEndpoint(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const [host, portText] = raw.split(":");
  return { host, port: Number(portText) };
}

async function seed(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const createdAt = Timestamp.fromDate(new Date("2026-10-18T00:00:00Z"));
    await setDoc(doc(db, "machines/m1"), {
      display_name: "Test",
      stripe_reader_id: "tmr_test",
    });
    await setDoc(doc(db, "machines/m1/inventory/s1"), { qty: 1 });
    await setDoc(doc(db, "machines/m1/planogramSlots/s1"), { slot_id: "s1" });
    await setDoc(doc(db, "machines/m1/commands/c1"), { status: "legacy" });
    await setDoc(doc(db, "machines/m1/activity/a1"), { kind: "legacy" });
    await setDoc(doc(db, "machines/m1/topologyAudit/t1"), { created_at: createdAt });
    await setDoc(doc(db, "orders/o1"), { machine_id: "m1", created_at: createdAt });
    await setDoc(doc(db, "vend_jobs/v1"), { machine_id: "m1", created_at: createdAt });
    await setDoc(doc(db, "checkout_sessions/cs1"), { order_id: "o1" });
    await setDoc(doc(db, "stripe_event_receipts/ev1"), {
      type: "payment_intent.succeeded",
    });
    await setDoc(doc(db, "organizations/org1"), { name: "secret" });
  });
}

async function start(rules: string, projectId: string): Promise<RulesTestEnvironment> {
  const { host, port } = emulatorEndpoint();
  return initializeTestEnvironment({
    projectId,
    firestore: { rules, host, port },
  });
}

let r0: RulesTestEnvironment;
let r0a: RulesTestEnvironment;

before(async () => {
  r0 = await start(r0Rules, "demo-sellmate-r0");
  await seed(r0);
  r0a = await start(r0aRules, "demo-sellmate-r0a");
  await seed(r0a);
});

after(async () => {
  await r0?.cleanup();
  await r0a?.cleanup();
});

test("R0 still allows anonymous document reads, including the four paths R0a will lock", async () => {
  const db = r0.unauthenticatedContext().firestore();
  for (const path of [...PUBLIC_DOCS, ...LOCKED_DOCS]) {
    await assertSucceeds(getDoc(doc(db, path)));
  }
});

test("R0 allows the dashboard's collection queries", async () => {
  const db = r0.unauthenticatedContext().firestore();
  const startOfChart = Timestamp.fromDate(new Date("2026-10-01T00:00:00Z"));
  await assertSucceeds(getDocs(collection(db, "machines")));
  await assertSucceeds(getDocs(collection(db, "machines/m1/inventory")));
  await assertSucceeds(getDocs(collection(db, "machines/m1/planogramSlots")));
  await assertSucceeds(
    getDocs(query(collection(db, "orders"), where("created_at", ">=", startOfChart))),
  );
  await assertSucceeds(
    getDocs(query(collection(db, "vend_jobs"), where("created_at", ">=", startOfChart))),
  );
});

test("R0 denies client writes and denies collections that are not public", async () => {
  const anon = r0.unauthenticatedContext().firestore();
  const signedIn = r0.authenticatedContext("uid_somebody").firestore();
  await assertFails(setDoc(doc(anon, "machines/m1"), { display_name: "hacked" }));
  await assertFails(setDoc(doc(signedIn, "orders/o1"), { amount_cents: 1 }));
  await assertFails(setDoc(doc(anon, "checkout_sessions/cs2"), { order_id: "x" }));
  await assertFails(setDoc(doc(signedIn, "stripe_event_receipts/ev2"), { type: "x" }));
  await assertFails(setDoc(doc(anon, "machines/m1/commands/c2"), { status: "x" }));
  await assertFails(setDoc(doc(signedIn, "machines/m1/activity/a2"), { kind: "x" }));
  await assertFails(setDoc(doc(anon, "machines/m1/inventory/s1"), { qty: 0 }));
  await assertFails(getDoc(doc(anon, "machines/m1/topologyAudit/t1")));
  await assertFails(getDoc(doc(signedIn, "organizations/org1")));
});

test("R0a denies anonymous reads of the four locked paths, by document and by query", async () => {
  const db = r0a.unauthenticatedContext().firestore();
  for (const path of LOCKED_DOCS) {
    await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(getDocs(collection(db, "checkout_sessions")));
  await assertFails(getDocs(collection(db, "stripe_event_receipts")));
  await assertFails(getDocs(collection(db, "machines/m1/commands")));
  await assertFails(getDocs(collection(db, "machines/m1/activity")));
});

test("R0a denies signed-in clients the same four paths", async () => {
  const db = r0a.authenticatedContext("uid_operator").firestore();
  for (const path of LOCKED_DOCS) {
    await assertFails(getDoc(doc(db, path)));
  }
  await assertFails(getDocs(collection(db, "checkout_sessions")));
  await assertFails(getDocs(collection(db, "stripe_event_receipts")));
  await assertFails(getDocs(collection(db, "machines/m1/commands")));
  await assertFails(getDocs(collection(db, "machines/m1/activity")));
});

test("R0a keeps machine, inventory, order, and vend-job reads working", async () => {
  const startOfChart = Timestamp.fromDate(new Date("2026-10-01T00:00:00Z"));
  for (const db of [
    r0a.unauthenticatedContext().firestore(),
    r0a.authenticatedContext("uid_dashboard").firestore(),
  ]) {
    for (const path of PUBLIC_DOCS) {
      await assertSucceeds(getDoc(doc(db, path)));
    }
    await assertSucceeds(getDocs(collection(db, "machines")));
    await assertSucceeds(getDocs(collection(db, "machines/m1/inventory")));
    await assertSucceeds(getDocs(collection(db, "machines/m1/planogramSlots")));
    await assertSucceeds(
      getDocs(query(collection(db, "orders"), where("created_at", ">=", startOfChart))),
    );
    await assertSucceeds(
      getDocs(query(collection(db, "vend_jobs"), where("created_at", ">=", startOfChart))),
    );
  }
});

test("R0a still denies client writes", async () => {
  const clients: Firestore[] = [
    r0a.unauthenticatedContext().firestore(),
    r0a.authenticatedContext("uid_somebody").firestore(),
  ];
  for (const db of clients) {
    await assertFails(setDoc(doc(db, "machines/m1"), { display_name: "hacked" }));
    await assertFails(setDoc(doc(db, "orders/o2"), { machine_id: "m1" }));
    await assertFails(setDoc(doc(db, "vend_jobs/v2"), { machine_id: "m1" }));
    await assertFails(setDoc(doc(db, "checkout_sessions/cs2"), { order_id: "o2" }));
    await assertFails(setDoc(doc(db, "stripe_event_receipts/ev2"), { type: "x" }));
    await assertFails(setDoc(doc(db, "machines/m1/commands/c2"), { status: "x" }));
    await assertFails(setDoc(doc(db, "machines/m1/activity/a2"), { kind: "x" }));
    await assertFails(setDoc(doc(db, "machines/m1/inventory/s2"), { qty: 1 }));
  }
});

test("rules-disabled writes still succeed while clients cannot read the new locked docs", async () => {
  await r0a.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await assertSucceeds(
      setDoc(doc(db, "checkout_sessions/cs_admin"), { order_id: "from-backend" }),
    );
    await assertSucceeds(
      setDoc(doc(db, "stripe_event_receipts/ev_admin"), { type: "payment_intent.succeeded" }),
    );
    await assertSucceeds(getDoc(doc(db, "checkout_sessions/cs_admin")));
    await assertSucceeds(getDoc(doc(db, "stripe_event_receipts/ev_admin")));
  });

  const client = r0a.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(client, "checkout_sessions/cs_admin")));
  await assertFails(getDoc(doc(client, "stripe_event_receipts/ev_admin")));
});
