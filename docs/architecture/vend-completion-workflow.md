# Vend completion workflow

Status: **DESIGN ONLY.** Payment code is not modified by this document.
`complete_vend_job` in `SellMateCloud/main.py` stays as it is until a later approval gate.

Firestore may run a transaction callback more than once. A Stripe capture or cancel inside
that callback can charge or release a card twice. Database transitions and Stripe calls stay
separate.

## 1. Two facts, recorded separately

A vend completion has a physical result and a financial result. They are not the same event,
and a failed HTTP call is neither.

| Physical result | How the backend knows | Financial result | Inventory |
|---|---|---|---|
| Product dispensed | A `SUCCESS` body that includes the vend evidence (`items`) is committed on the vend job | Capture the authorization | Decrement once, in that same commit |
| Product dispensed | Same durable record | Capture fails or times out | Stay decremented. Payment is unresolved. Do not put the stock back |
| Product not dispensed | A `FAILED` body that includes vend evidence (`items` or `failed_slot_id`) and has no `exception_type` | Cancel the authorization | Unchanged |
| Vend outcome unknown | No completion has been stored, or the only report is the Pi's exception payload (`exception_type`, no vend evidence) | Do not capture and do not cancel. Reconcile | Unchanged |

Inventory moves only when a confirmed dispense is durably accepted. It does not move because
the job was claimed, because a motor ran, because a vend was attempted, or because a timeout
fired. Payment capture is not what decrements stock, and a failed capture does not restore it.

## 2. What the Pi actually sends

`handle_vend_job` (`sellmate-pi/app/cloud_poller.py:532-607`) has three exits. This milestone
does not change that code.

1. Local vend succeeded. Posts `SUCCESS` with `result.items` (`:547-552`, evidence built at
   `:516-528`). This is a trustworthy physical success.
2. Local vend failed. Posts `FAILED` with `result.items` and `failed_slot_id` (`:563-569`,
   evidence built at `:499-513`). This is a trustworthy physical failure.
3. Any exception, including a network error on the success post. Posts `FAILED` with
   `result.exception_type` and no vend evidence (`:577-592`). This is not a trustworthy
   physical result. The product may already have dropped, and the success request may never
   have reached the cloud.

The cloud must not treat case 3 as "the vend failed." A missing acknowledgment is not a vend
result. If no trustworthy result has been stored yet, case 3 becomes `physical_outcome:
unknown`. If a trustworthy success is already stored, case 3 is ignored and capture continues.

## 3. Happy path that stays

1. `start_payment` creates a manual-capture PaymentIntent (`main.py:640-655`). The card is
   authorized. Money is not taken yet.
2. `payment_intent.amount_capturable_updated` creates one vend job in `PENDING` and sets the
   order to `AUTHORIZED` (`main.py:1352-1357`).
3. The Pi claims the job (`PENDING` → `CLAIMED`) and vends locally.
4. A trustworthy `SUCCESS` is stored, stock is decremented once, then Stripe is captured.
5. A trustworthy `FAILED` cancels the authorization. Stock is unchanged.
6. A repeat of a job already `SUCCESS`, `FAILED`, or `CANCELLED` returns the stored result and
   does not call Stripe again (`main.py:1537-1553`).

## 4. State machine

```text
PENDING
  └─ claim ─→ CLAIMED
CLAIMED
  ├─ trustworthy SUCCESS ─→ physical dispensed, inventory once, CAPTURING
  │     └─ Stripe capture ─→ payment captured, order COMPLETED
  │     ├─ Stripe timeout ─→ CAPTURE_UNKNOWN (inventory stays down)
  │     └─ Stripe decline ─→ CAPTURE_FAILED (inventory stays down, no auto-cancel)
  ├─ trustworthy FAILED ─→ physical not dispensed, CANCELLING_PAYMENT
  │     └─ Stripe cancel ─→ payment canceled, order FAILED
  └─ untrustworthy FAILED, or no report at all ─→ OUTCOME_UNKNOWN
        no capture, no cancel, no inventory change
```

`CAPTURE_UNKNOWN` means the product was dispensed and the payment outcome is not known.
`OUTCOME_UNKNOWN` means the physical result itself is not known. Those must not be collapsed
into a failed vend.

### 4.1 Admission transaction (no Stripe)

| Stored state | Request | Commit | Then |
|---|---|---|---|
| `PENDING` | either | none | 409 `not_claimed` |
| `CLAIMED` | trustworthy `SUCCESS` | `physical_outcome=dispensed`, evidence, inventory once, `CAPTURING` | capture |
| `CLAIMED` | trustworthy `FAILED` | `physical_outcome=not_dispensed`, evidence, no inventory, `CANCELLING_PAYMENT` | cancel |
| `CLAIMED` | `FAILED` with `exception_type` and no vend evidence | `physical_outcome=unknown`, `OUTCOME_UNKNOWN` | stop. No Stripe |
| `CAPTURING`, `CAPTURE_UNKNOWN`, `CAPTURE_FAILED` | later `FAILED` | none | keep the dispense. Resume capture recovery. Do not cancel |
| `OUTCOME_UNKNOWN` | trustworthy `SUCCESS` or `FAILED` | adopt that physical result | then capture or cancel |
| `OUTCOME_UNKNOWN` | another untrustworthy `FAILED` | none | stay unknown |
| `SUCCESS`, `FAILED`, `CANCELLED` | either | none | 200 stored result. No Stripe |

A job that is still `CLAIMED` because the completion request never arrived is also unknown.
Nothing in this design cancels it merely because time passed. The existing customer
`wait_timeout` path is a separate, explicit cancel while the job is still `PENDING`.

Two callers racing on `CLAIMED` are serialized by the transaction. One admission wins.

### 4.2 Capture, only after a stored dispense

Idempotency key `sellmate_capture_{vend_job_id}`. Retrieve the PaymentIntent first.

1. `succeeded` → write payment captured and order `COMPLETED` with `completed_at`. Do not
   capture again. Do not touch inventory.
2. `requires_capture` → capture once, then the same write.
3. `canceled` → `CAPTURE_FAILED`, reason `payment_already_canceled`. Inventory stays down.
4. Timeout → `CAPTURE_UNKNOWN`. Do not guess, and do not cancel.
5. A definitive decline → `CAPTURE_FAILED`. Do not automatically capture again and do not
   cancel. The product left the machine and the payment needs a person.

### 4.3 Cancel, only after a stored non-dispense

Idempotency key `sellmate_cancel_{vend_job_id}`. Retrieve first. If Stripe already shows
`succeeded`, do not refund from this path; record `payment_conflict` and stop.

### 4.4 Lost acknowledgment

The success post is one HTTP call (`cloud_poller.py:395-401`). It is not retried as `SUCCESS`.
If it throws, the `except` block posts the untrustworthy `FAILED` once.

- The success commit happened, and the response was lost: the follow-up `FAILED` finds
  `physical_outcome=dispensed` and does not cancel.
- The success request never arrived: the follow-up `FAILED` is the first thing stored, it has
  `exception_type` and no vend evidence, and the job becomes `OUTCOME_UNKNOWN`. The
  authorization stays held until reconciliation. The backend does not invent a failed vend.

### 4.5 Webhook

`payment_intent.succeeded` may mark the order `COMPLETED` only when the vend job already has
`physical_outcome=dispensed`. It must not do that for `not_dispensed` or `unknown`, and it must
not change inventory. Duplicate events stay ignored via `stripe_event_receipts`.

## 5. Tests required before any payment-code change

Not implemented. Emulator and the fake payments provider only.

| # | Case | Expected |
|---|---|---|
| 1 | Trustworthy `SUCCESS` | `physical_outcome=dispensed`, inventory decremented once, one capture, order `COMPLETED` |
| 2 | Trustworthy `FAILED` (vend evidence, no `exception_type`) | `not_dispensed`, inventory unchanged, one cancel, order `FAILED` |
| 3 | `FAILED` with `exception_type` while the job is still `CLAIMED` | `unknown`. No capture, no cancel, inventory unchanged |
| 4 | No completion arrives | job stays `CLAIMED`. No capture, no cancel, inventory unchanged |
| 5 | `SUCCESS` stored, then the Pi's exception `FAILED` | stays dispensed. Capture is not cancelled. Inventory not changed again |
| 6 | Two concurrent trustworthy `SUCCESS` | one inventory decrement, one capture |
| 7 | `SUCCESS` when already `SUCCESS` | stored result, no Stripe call, inventory unchanged |
| 8 | Trustworthy `FAILED` when already `FAILED` | stored result, no Stripe call |
| 9 | Complete from `PENDING` | 409, no Stripe call |
| 10 | Crash after the dispense commit, before Stripe | inventory already down; recovery captures once |
| 11 | Crash after Stripe success, before the order write | recovery sees `succeeded`, no second capture, inventory unchanged |
| 12 | Stripe timeout after a stored dispense | `CAPTURE_UNKNOWN`, inventory stays down, authorization not cancelled |
| 13 | Recovery retrieve says `succeeded` | finalize, zero new capture calls |
| 14 | Recovery retrieve says `requires_capture` | one capture |
| 15 | Definitive capture decline after a stored dispense | `CAPTURE_FAILED`, inventory stays down, no automatic cancel |
| 16 | Trustworthy `SUCCESS` after a stored non-dispense | 409, no capture |
| 17 | Duplicate `payment_intent.succeeded` | one receipt, inventory untouched |
| 18 | Webhook `succeeded` while physical outcome is `not_dispensed` or `unknown` | order is not marked `COMPLETED` |
| 19 | Same capture idempotency key twice | fake provider records one capture |

Cases 1–3 and 12 and 15 are the physical/financial split: dispensed and captured, dispensed and
unresolved, not dispensed and canceled, unknown and unreconciled.

Rollback of a future implementation is a Cloud Run revision rollback. `OUTCOME_UNKNOWN` is a
new status. The statuses already written today remain valid.
