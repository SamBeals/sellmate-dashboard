# SellMate Inventory Accounting — Recommended Milestone (I1)

Status: **PLANNING — not part of the multi-tenant implementation.** Pilot-readiness concern with
its own milestone. Reconfirmed 2026-10-18.

## 1. Finding, reconfirmed

The backend never reads or writes `machines/{id}/inventory`. [V]

- `SellMateCloud/main.py`: the only occurrences of `inventory`/`qty` are `OrderItem.qty`
  (`main.py:66`) and a comment (`:2724`); no `Increment`, no decrement, no inventory reads
  (grep across all `*.py`; `topology_service.py:536-539,992` explicitly states planogram/inventory
  are not modified).
- Inventory documents are written by nobody in code (console/manual) and read by the dashboard,
  touchscreen and Android Kiosk. Field names are inconsistent in practice: the touchscreen reads
  `price_cents|priceCents` and `qty|inventory` (`pi-touchscreen/app/api/inventory_client.py:63,66`).
- A sale therefore never changes stock; "low stock" on the dashboard reflects manual edits only.

## 2. Design

### 2.1 Which event is "a successful sale"

Two distinct facts, both recorded on the vend job:

- **Physical dispense confirmed** — a trustworthy `SUCCESS` (vend evidence, not an HTTP
  exception) is committed on the vend job. This is the only inventory event.
- **Payment captured** — `stripe.PaymentIntent.capture` succeeds. This is the revenue event.
- **Physical outcome unknown** — the completion never arrived, or the only report is the Pi's
  exception payload. Inventory does not change, and the payment is not cancelled from that
  report. See `vend-completion-workflow.md`.

A failed capture does not restore stock. The row is a dispensed product with an unresolved
payment. `mark_payment_succeeded` must never touch inventory.

### 2.2 Where to decrement

Inside the admission transaction, and only when that transaction commits
`physical_outcome=dispensed`. Not on claim, not on motor activity, not on a timeout, and not
on an unknown outcome. Stripe runs after the commit. A failed capture does not reverse the
stock write.

```text
transaction (no Stripe):
  job = read vend_jobs/{id}
  require job.status == CLAIMED
  require request is a trustworthy SUCCESS
  if job.inventory_applied_at is null:
      for item in job.items:
          slot = read machines/{machine_id}/inventory/{item.slot_id}
          before = int(slot.qty ?? slot.inventory ?? 0)
          after  = max(0, before - item.qty)
          write slot.qty = after, slot.updated_at, slot.last_sale_vend_job_id
          create machines/{machine_id}/inventory_adjustments/adj_{vend_job_id}_{slot_id}
                 { delta: -item.qty, qty_before, qty_after, reason: "sale",
                   vend_job_id, order_id, attribution (copied from job), actor: {kind: "machine"},
                   discrepancy: before < item.qty, created_at }
      write job.inventory_applied_at = now
  write job.status = CAPTURING
after commit: Stripe capture, then a separate finalize transaction to SUCCESS
```

A trustworthy `FAILED` admission writes `CANCELLING_PAYMENT` and does not touch inventory.
An untrustworthy `FAILED` (`exception_type`, no vend evidence) writes `OUTCOME_UNKNOWN` and
does not touch inventory or Stripe. A retry of
`SUCCESS` sees `inventory_applied_at` already set, or sees a status other than `CLAIMED`, and
does not decrement again. Firestore may retry the transaction callback; the decrement is inside
that callback, so a retry that aborts writes nothing. It must not be moved next to the Stripe call.

Transaction size: ≤ 1 + 2×items writes; items are tiny (one or two slots per order).

### 2.3 Rules for each case

| Case | Behaviour |
|---|---|
| Decrement twice (Pi retry, duplicate POST, concurrent duplicates) | Admission gate (`status == CLAIMED`) plus `inventory_applied_at` plus deterministic adjustment IDs (`adj_{vend_job_id}_{slot_id}`, create-only) make the decrement idempotent. |
| Failed vend (trustworthy `FAILED` with vend evidence) | No decrement. Payment authorization is cancelled. |
| Vend outcome unknown (no report, or the Pi's `exception_type` payload) | No decrement. Payment is not captured and not cancelled. |
| Payment authorized but vend confirmed failed | No decrement. Authorization cancelled. |
| Vend confirmed dispensed but capture fails | Inventory stays decremented. Record an unresolved payment. Do not restore the count. |
| Order cancelled before claim (`wait_timeout`, customer cancel) | No decrement. |
| Transaction retries | Firestore transactions retry on contention; idempotency above holds. Pi retries of `complete` get the current state response. |
| Stock would go negative | Clamp to 0 and set `discrepancy: true` on the adjustment; surface in the dashboard as a stock-count problem rather than blocking the sale (the product was dispensed). |
| Legacy field `inventory` instead of `qty` | Read both; write `qty` canonically; migration script normalises existing docs (dry-run first). |
| Machine without inventory doc for a sold slot | Create the adjustment with `qty_before: null`, `discrepancy: true`; do not create inventory docs implicitly. |

### 2.4 Restocks and manual corrections

All non-sale changes go through the backend so they are audited:
`POST /machines/{id}/inventory/adjustments` `{slot_id, delta | set_qty, reason: restock|correction|
shrinkage|audit_count, note}` — capability `inventory.edit` (operator+ of the operator org).
It writes the slot and an adjustment row in one transaction with `actor: {uid}`. The
rules-based client write of `qty` from Milestone 0 §5.6 is **not** recommended once this
milestone lands (rules cannot force the paired audit row); keep it only for `price_cents`,
`enabled`, `name`, `capacity` if you want zero-backend edits for those.

### 2.5 Audit and visibility

- `machines/{id}/inventory_adjustments/{adjId}` — read by operator-org members (rules derive
  tenant from the parent machine) and platform admin; never client-writable.
- Dashboard: per-slot history, "reconciliation needed" list (jobs with `CAPTURE_FAILED` or
  `discrepancy`), low-stock derived from `qty/capacity`.
- Operator-only: owners and hosts do not see inventory (per the permission matrix).

### 2.6 Interaction with order-time checks

The security plan's `ORDER_PRICE_MODE` validates prices and slot existence at order time. Rejecting
`qty > stock` at order time is **deferred** until this milestone has been running long enough that
`qty` is trustworthy; even then, it should be `log` first.

## 3. Milestone I1 — scope and acceptance

- **Depends on:** the vend-completion admission transaction (Stripe stays outside it); fake
  payments provider; local emulator. Not part of the S0 security-test milestone.
- **Files likely affected:** `SellMateCloud/main.py` (`complete_vend_job`), new
  `SellMateCloud/inventory.py`, tests `tests/test_inventory_*.py`, `firebase/firestore.rules`
  (adjustments subcollection read), dashboard machine detail (adjustments tab), `dev/fixtures/inventory.json`,
  `dev/scenarios/vend-success.json` expectations.
- **Acceptance:** after `make sim MACHINE=mach_ns_01 SCENARIO=vend-success`, slot `qty` is
  decremented by exactly 1 and one adjustment row exists; running `duplicate-complete` leaves qty
  and row count unchanged; `vend-fail` leaves qty unchanged; `capture-fail` decrements and lists
  the job for reconciliation; restock via endpoint increments with an audited row; `expected_totals.json`
  gains stock expectations and the seed test asserts them.
- **Automated tests:** unit (fake Firestore) for each case in §2.3; emulator concurrency test
  (two simultaneous completes); rules test for adjustments visibility.
- **Manual steps:** Dev Console → Generate purchase (success) → machine inventory tab shows new qty
  and adjustment; repeat with "duplicate complete" → unchanged; restock → row with your uid.
- **Rollback:** feature flag `INVENTORY_ACCOUNTING=off` skips the decrement block (adjustment rows
  already written remain; they are additive). Field normalisation migration has `--revert`.
- **Approval checkpoint:** before deploy (payment-path code), and before running the field
  normalisation against production.
