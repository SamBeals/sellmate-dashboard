# Architecture Decision Summary (v2, 2026-10-18)

One recommendation per decision, with the tradeoff. Milestone 0 decision IDs (D1–D15) are kept;
new ones are D-V2-xx.

## 1. Retained from Milestone 0 (approved in principle; no action needed)

| ID | Decision | Note |
|---|---|---|
| D2 | Add `firebase-admin` to the backend | still the simplest emulator-compatible ID-token verification |
| D3 | Tenant-admin mutations via FastAPI, not Next.js routes | one backend |
| D4 | Schema option B: keep paths, additive fields, new top-level collections | reconfirmed; no device changes |
| D6 | Keep `X-Operator-Token` path alive during transition | now governed by the security plan (`OPERATOR_ROLE_MODE`) with a retirement condition |
| D8 | `PAYMENTS_PROVIDER=fake`, emulator-only | required for every local scenario |
| D9 | Local Python 3.14 first, fall back to 3.11 venv | unchanged |
| D11 | Member roles `owner/admin/operator/viewer` + `platform_admin` | reviewed against three relationships; sufficient (see D-V2-02 for naming) |
| D12 | No future-dated assignments | unchanged |
| D13 | `concurrently` for one-command startup | now wrapped by `make up` |
| — | Firestore rules deny-by-default with membership `get()`; no custom claims yet | unchanged |
| — | Emulator + simulated machine + deterministic fixtures | strongly retained and extended (Dev Console) |
| — | Migration tool with dry-run, manifest, batching, tagged revert | extended for ownership rows and `attribution` |

## 2. Modified in this revision

| ID | Was | Now | Tradeoff |
|---|---|---|---|
| D1 | Firebase config at `sellmate-dashboard/` root | `sellmate-dashboard/{firebase,dev,packages/schemas}/` laid out as the future monorepo root, no dashboard imports | slightly awkward `--config firebase/firebase.json` now; zero-edit move later |
| D10 | Owner never sees sales | Owner and host see **scoped revenue summaries** via `GET /finance/summary`; operator alone sees transactions | one new read-only backend route instead of unsatisfiable rules; summaries can later be materialised |
| D14 | Per-machine credentials built in M4, enforcement deferred indefinitely | Moved to the **security project** with phased flags, telemetry gates and retirement tests | fleet changes required, but each step is reversible and never breaks a vending Pi |
| §3.5 | `host_viewer` deferred role | **Dropped.** Host is a relationship; host staff use normal member roles | no role sprawl |
| §5.1 | `organizations.kind` | **Removed.** Roles derived from `machine_assignments` and `locations.host_org_id` | one less field to keep consistent; "what are we?" answered by `GET /me` counts |
| §5.7 | Assignment kinds `owner/operator/placement` with `terms` | `ownership/operation/placement`, no `terms`; future `agreements` collection | avoids role/relationship word collision; keeps history a pure fact table |
| §5.8 | Four flat tenancy fields on orders | Immutable `attribution` object incl. `host_org_id`, `location_id`, three assignment IDs, `currency`, `resolution` | nested queries need the same composite indexes; much clearer immutability story |
| §5.6 | Machine doc gets `owner_org_id`, `operator_org_id`, `location_id` | adds `host_org_id` for backend summaries and finance queries. Hosts do not read the machine doc | one more denormalised field; sensitive fields stay off the host path |
| §5.7/5.9 | History and audit readable by clients via array rules | **Backend endpoints only** for `machine_assignments` and `audit_events` | rules cannot prove multi-party membership on list queries; backend is simpler and testable |
| §8 | Commands as npm scripts | `Makefile` targets + emulator-only **Dev Console** page | one more file; manual exploration becomes one-click |
| §10 | Security items inside M4 | Separate plan with its own sequence | clear ownership of risk |
| — | Inventory decrement noted as gap | Separate milestone I1 with its own plan | not bundled into tenancy work |

## 3. Decisions approved in principle (2026-10-18), with the corrections below

| ID | Decision | Correction |
|---|---|---|
| D-V2-01 | Organization roles come only from relationships. No `kind`, no capability flags yet. | unchanged |
| D-V2-02 | Member role name stays `operator`. | unchanged |
| D-V2-03 | **Corrected.** Hosts do **not** read `machines/{id}`. That document contains `stripe_reader_id` and `health_current`, and rules cannot hide fields. Hosts use `GET /machines/{id}/summary?as=host`. | was: host reads the full machine doc |
| D-V2-04 | **Corrected.** Owner and operator admins initiate relocation. A new placement requires host authorization. The pilot accepts platform-admin approval in the same request. No approval queue. `host_member` is reserved and rejected until enabled later. Ending a placement needs no host. | was: owner or operator may place; host has no say |
| D-V2-05 | Ownership transfer requires member role `owner` in the owning org, or a platform admin. | unchanged |
| D-V2-06 | Per-machine credentials are issued by an owner-org admin or a platform admin. | unchanged |
| D-V2-07 | `completed_at` is written when the vend job reaches `SUCCESS`. Not implemented yet. | unchanged in intent; tied to the workflow doc |
| D-V2-08 | **Corrected.** Firestore transactions change job state only. Stripe capture and cancel run outside the transaction, after a retrieve, with a stable idempotency key. State machine and tests: `docs/architecture/vend-completion-workflow.md`. Payment code is not modified until a separate approval. | was: one transaction that also calls Stripe |
| D-V2-09 | Owner and host revenue comes from `GET /finance/summary`. | unchanged |
| D-V2-10 | **Corrected.** Sequence is: minimal security tests, then the shadow-mode backend, then the monorepo, then the full local environment, then multi-tenancy, then pilot migration. Monorepo work has not started. | was: monorepo after T1 and before T2 |
| D-V2-11 | Proposed rules that lock the four unused collections are tested in the emulator. **Not deployed.** | deploy still needs a separate approval |
| D-V2-12 | Theme Studio moves to Firebase sign-in later, so the shared operator token can be removed. | unchanged, low priority |

## 4. Still requiring investigation or your input (unchanged from M0 unless noted)

| ID | Question | Why it matters |
|---|---|---|
| D5 | Is the Android kiosk installed on a device? The Firebase app is registered and the repo's last commit is 2026-05-25. No production machine list was read. Keep public `inventory` / `planogramSlots` reads until you confirm it is gone. See `docs/architecture/legacy-client-inventory.md`. | gates rules R3 |
| — | Is any Pi deployed at a customer site? | Not confirmed. Pi and touchscreen protocols stay until a `last_seen_at` read says otherwise. |
| D7 | Production sign-in provider (recommend Google) | Firebase console config before any production rollout |
| D15 | Firebase Authentication enabled; which providers | same |
| S-06 | IAM role of the touchscreen service account; one key or many | decides whether S-06 is High or Medium |
| S-09 | Are `VEND_API_KEY`/`TECHNICIAN_PIN` overridden on real Pis? | LAN exposure |
| — | Production machine list and whether any `orders.machine_id` lacks a machine doc | manifest for M1 |
| — | Cloud Run service account roles; Pi reader SA distinct? | blast radius |
| — | Dashboard `topologyAudit` read is denied by live rules today (`page.tsx:249-254`): is that panel known to be broken? | not a v2 change; noted for the compatibility inventory |
| — | Java runtime on the dev machine | L1 prerequisite |

## 5. Explicitly rejected alternatives (so they are not re-litigated)

- Org-prefixed Firestore paths (M0 option A) — breaks every device client.
- Custom claims now — stale-token revocation problem; revisit only for rule-read cost.
- Per-field visibility through rules — impossible in Firestore.
- Materialised revenue rollups now — new write in the payment path for no current need.
- A `host_viewer` or `host_admin` role — relationship, not role.
- Calling Stripe inside a Firestore transaction callback — the callback can run more than once.
- Event broker / microservices for attribution or inventory — a transaction in one backend suffices.
- Enabling strict machine auth immediately — would stop every current Pi from vending.
- Running the monorepo consolidation alongside schema or rules changes.
