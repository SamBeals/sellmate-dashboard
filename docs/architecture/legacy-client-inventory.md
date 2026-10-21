# Legacy client inventory

Status: **investigation, 2026-10-18.** No compatibility code was added or removed.
Production Firestore documents were **not** read. Firebase login could list apps and indexes.
A document listing of `machines` was blocked in this session, so customer deployment is not
confirmed from live data.

## 1. What is actually in use

| Client | Evidence | Treat as |
|---|---|---|
| `sellmate-pi` | Last commit 2026-08-15 (`550e0fe`). Default Cloud Run host is the production service (`health_reporter.py`). Claim and complete send no auth header. | **Current machine software.** Keep the unauthenticated claim/complete path until the phased credential rollout. Do not require the new header yet. |
| `pi-touchscreen` | Last commit 2026-08-08 (`be40209`). Reads catalog with a service-account file, which bypasses security rules. Order routes do not send a machine token. | **Current machine software.** Keep today's order routes working. |
| `sellmate-dashboard` | Active web app registered in Firebase (`sellmate-dashboard`, web). Reads `machines`, `orders`, `vend_jobs`, and `inventory` with the public client SDK (`app/page.tsx`, `app/machines/[machineId]/page.tsx`). | **Current operator UI.** Public read of those collections stays until the signed-in dashboard exists. |
| `SellMateCloud` | Production URL `https://sellmatecloud-1002770348452.us-west4.run.app` is hardcoded by the Pi, the touchscreen README, and the Android kiosk. | **Current backend.** |

Whether a Pi is sitting in a customer location today is **not proven**. The production URL and
the machine software are real. A `last_seen_at` on a machine document would settle it, and that
read has not been done. Until it is, do not delete the Pi or touchscreen protocols.

## 2. Registered, not confirmed on a device

Firebase project `sellmate-bdd22` has three apps (listed 2026-10-18):

| Firebase app | Platform | Code in this workspace |
|---|---|---|
| SellMate Tablet Kiosk App | Android | `SellMateKioskApp`, last commit 2026-05-25 (`c270cb9`). Hardcoded `machine_001`. Anonymous reads of `planogramSlots` and `inventory` only. |
| SellMate | iOS | **No iOS project in the workspace.** The audit recorded the bundle id `sambeals.SellMateTrial`. |
| sellmate-dashboard | Web | `sellmate-dashboard` |

The Android app is registered and the source still compiles against public inventory reads.
Nothing here shows a tablet currently installed at a customer. Keep the public read of
`inventory` and `planogramSlots` until you confirm the tablet is gone (decision D5). Do not
build new features for it.

The iOS registration has no matching repository. Do not add a compatibility layer, a fixture
persona, or a second order API for it. If a device turns up later, identify which collections
it reads before changing rules.

## 3. Abandoned or already disabled

| Item | Evidence | Do not build |
|---|---|---|
| `POST /orders/{id}/authorize` | Returns 410 (`main.py:2765-2770`). | No shim. |
| `GET /machines/{id}/commands/next` | Returns `NO_COMMAND` and does not read Firestore (`main.py:2773-2781`). | No client for `machines/{id}/commands`. |
| `MarketKioskDisplayApp` | Separate Android app, no SellMate Firestore use. | Out of scope, as in the audit. |
| `SellMateDashboard/` | Empty IDE folder. | Ignore. |

## 4. Recheck for the four-path lockdown (S-P0)

Searched again on 2026-10-18, after the rules tests were expanded.

| Path | Client references in this workspace |
|---|---|
| `checkout_sessions/{id}` | None. Backend Admin SDK writes only (`SellMateCloud/main.py`). |
| `stripe_event_receipts/{id}` | None. Backend writes the webhook receipt only. |
| `machines/{id}/commands/{id}` | None. `GET /machines/{id}/commands/next` does not read Firestore. |
| `machines/{id}/activity/{id}` | None. |

Android: `SellMateKioskApp` reads `machines/{id}/planogramSlots` and `machines/{id}/inventory`
(`FirestorePlanogramService.kt`). It does not mention the four paths.

iOS source was inspected on GitHub, not only in this workspace. Full history of
`SamBeals/SellMateTrial` (6 commits, last push 2026-04-06), `SamBeals/SellMateCustomer`
(13 commits, last push 2026-04-22), and `SamBeals/SellMateMerchant` (6 commits, last push
2026-06-05) contains no reference to `checkout_sessions`, `stripe_event_receipts`,
`machines/{id}/commands`, or `machines/{id}/activity`.

What those apps do read from Firestore:

- Trial and Customer: `machines`, `planogramSlots`, and `inventory`. Customer also lists
  `machines` for a map. Orders go through the Cloud Run HTTP API, not Firestore.
- Merchant: `machines` and `machines/{id}/inventory`. It also queries `merchants`, `products`,
  and `sales`, which the live rules already deny. R0A does not change that.

Whether any of these builds is installed on a phone was not verified. Source history does not
justify keeping the four public reads. R0A leaves the machine, planogram, and inventory reads
those apps use.

The touchscreen uses a service account, so security rules do not apply to it. Locking client
reads does not change that process.

## 5. Effect on the rules lockdown

Client source in the dashboard, both Pi apps, the Android kiosk, and Theme Studio does not read
`checkout_sessions`, `stripe_event_receipts`, `machines/{id}/commands`, or `machines/{id}/activity`.
The backend writes checkout sessions and Stripe receipts with the Admin SDK, which does not
consult security rules. Locking client reads of those four paths does not change vending.

That conclusion is about **source**, not about an unknown binary. The iOS app is the remaining
gap. The proposed rules file is tested and not deployed.

Public reads that **must stay** until a later, explicit rules deploy:

- `machines`, `orders`, `vend_jobs` — dashboard
- `inventory`, `planogramSlots` — dashboard and, if it is still installed, the Android kiosk

`topologyAudit` is already denied by the catch-all rule. The dashboard still queries it
(`page.tsx`) and already handles that failure. No compatibility work is required for it.
