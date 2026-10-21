# SellMate Security Remediation Plan

Status: **S0 local tests exist. Nothing deployed. Payment code unchanged.** Separate project from the multi-tenant
foundation; shares the local environment and the per-machine credential schema with it.
Reconfirmed against source on 2026-10-18 (repos at `SellMateCloud` FEATURE-013 HEAD,
`sellmate-pi` 550e0fe, `pi-touchscreen` be40209, `SellMateKioskApp` c270cb9,
`sellmate-dashboard` 4d3af61, `sellmate-theme-studio` 6659798).

Tags: **[V]** verified in source · **[LIVE]** verified in the production Firebase project today ·
**[?]** production exposure needs configuration verification by you.

---

## 0. Summary and priority order

| ID | Finding | Confirmed in source | Production exposure | Severity | Fix class |
|---|---|---|---|---|---|
| S-01 | Public Firestore reads of commerce collections | [V] rules | **[LIVE]** fetched today | High | rules + dashboard auth |
| S-02 | Unauthenticated vend-job claim and complete | [V] | public Cloud Run URL; exploitation unknown | **Critical** | backend flag + Pi code |
| S-03 | Client-supplied order prices, no server validation | [V] | public endpoint | High | backend flag |
| S-04 | One shared machine token for the whole fleet | [V] | [?] token present on every Pi | Medium-High | backend + per-Pi config |
| S-05 | Operator role from client header | [V] | requires shared operator token | Medium | backend flag |
| S-06 | Service-account JSON on the touchscreen Pi | [V] docs/config | [?] IAM role of that SA | High (if SA ≥ `datastore.user`) / Medium | config now, code later |
| S-07 | Unauthenticated order lifecycle endpoints (`/orders`, `start_payment`, `cancel`, `GET /orders/{id}`) — *new* | [V] | public endpoint | High | backend flag + touchscreen header |
| S-08 | Non-atomic `complete_vend_job`; completion accepted from unclaimed state — *new* | [V] | reliability + abuse amplifier | Medium | backend transaction |
| S-09 | Pi local vend-api defaults (`CHANGE_ME`, PIN `4130`) — *new* | [V] | LAN only; [?] whether defaults are overridden on real Pis | Medium | Pi config check |
| S-10 | Dashboard logs project ID; `.env.local` points at production — *new* | [V] | low | Low | hygiene |

**Implementation sequence** (each step independently deployable; details in §3):

1. **P0 — configuration checks, no code** (S-06 IAM, S-09 Pi env, S-01 confirm no other
   anonymous readers, D5 Kiosk status). Days.
2. **P1 — backend shadow mode**: per-machine credential lookup (S-04), optional auth on vend and
   order routes in `log` mode (S-02, S-07), server price computation in `log` mode (S-03),
   atomic completion (S-08), role-header capping flag (S-05, off). One backend deploy; **no client
   breaks**. Requires the local environment (roadmap L1) for tests.
3. **P2 — client updates**: `sellmate-pi` poller sends `X-Machine-Token` on claim/complete;
   `pi-touchscreen` sends `X-Machine-Token` on order routes; per-machine tokens issued and written to
   each Pi's `machine.env`. Rolled out machine by machine.
4. **P3 — enforcement flips** once telemetry shows zero legacy use for the agreed window:
   `VEND_AUTH_MODE=require`, `ORDER_AUTH_MODE=require`, `ORDER_PRICE_MODE=enforce`.
5. **P4 — Firestore rules** R0a (lock unread collections) now; R1/R2 after dashboard auth (T1);
   R3 after the Kiosk decision; touchscreen off Firestore (S-06 code step).
6. **P5 — retire legacy mechanisms** (shared token, role header, `off/log` modes) with the
   retirement tests in §4.

---

## 1. Findings in detail

Each finding: file/function · current behaviour · consequences · severity · mitigation ·
compatibility · tests · rollback.

### S-01 Public Firestore reads of sensitive commerce collections

- **Where:** live rules of project `sellmate-bdd22` [LIVE]; not in any repository [V]. Rules allow
  `read: if true` on `machines/{id}` (+ `inventory`, `planogramSlots`, `commands`, `activity`),
  `orders`, `vend_jobs`, `stripe_event_receipts`, `checkout_sessions`; everything else denied.
- **Current behaviour:** any holder of the public web API key (it is in the dashboard bundle) can
  enumerate all orders (amounts, items, `stripe_payment_intent_id`, `machine_id`), all vend jobs
  (IDs, status, evidence), checkout sessions, machine docs (`stripe_reader_id`, health, location)
  and inventory/prices. No client write path exists.
- **Consequences:** confidentiality of all commerce data; **enables S-02** (vend-job UUIDs are
  needed to call `complete`, and they are public); reader IDs and PI IDs leak.
- **Readers that depend on it [V]:** dashboard (`app/page.tsx:139-151`, `app/machines/[machineId]/page.tsx:210-211,249-254`),
  Android `SellMateKioskApp` (`FirestorePlanogramService.kt:15-36`, unauthenticated SDK reads of
  `planogramSlots` and `inventory`). The touchscreen bypasses rules (service account). Nothing reads
  `checkout_sessions`, `stripe_event_receipts`, `commands`, `activity` from a client.
- **Severity:** High.
- **Mitigation:** (a) **R0** check the exact live rules into `firebase/firestore.rules` with
  emulator tests documenting current behaviour; (b) **R0a** deny `checkout_sessions`,
  `stripe_event_receipts`, `commands`, `activity` — proposal and checklist are in
  `sellmate-dashboard/firebase/R0A_DEPLOYMENT.md`, tested, **not deployed**; (c) **R1/R2** membership-scoped reads once the dashboard has Firebase Auth (roadmap
  T1); (d) **R3** `inventory`/`planogramSlots` after the Kiosk app is retired or authenticated (D5).
- **Compatibility:** R0a none. R2 breaks the current unauthenticated dashboard build — intended;
  the authenticated dashboard ships first. R3 breaks the Android Kiosk if still deployed.
- **Tests:** rules tests per collection: anonymous denied; member of stamped org allowed; other
  org denied; the exact dashboard queries pass; unfiltered `machines` list denied.
- **Rollback:** redeploy the previous `firestore.rules` from git (never redeploy public-read rules
  to rescue an old client; fix the client).

### S-02 Unauthenticated vend-job claiming and completion

- **Where:** `SellMateCloud/main.py:1436-1515` `claim_vend_job` (signature: `machine_id`,
  `wait_seconds` only); `main.py:1518-1702` `complete_vend_job` (`vend_job_id`, body only). Pi
  client: `sellmate-pi/app/cloud_poller.py:101-115` and `376-399` send **no headers at all**;
  `cloud_poller.py` does not even read `MACHINE_SHARED_TOKEN` [V].
- **Current behaviour:** anyone can claim pending jobs for any `machine_id`, and anyone who knows a
  vend-job UUID (public via S-01) can POST `SUCCESS` (→ `stripe.PaymentIntent.capture`,
  `main.py:1570`) or `FAILED` (→ `PaymentIntent.cancel`, `main.py:1642`).
- **Consequences:** charge a customer without dispensing (attacker claims and completes `SUCCESS`
  before the Pi); free product (Pi vends, attacker posts `FAILED` first — the Pi's later `SUCCESS`
  is ignored as `already_terminal`, `main.py:1537-1553`); denial of service by claiming all jobs.
- **Severity:** **Critical** (direct financial impact, remotely exploitable, no credential needed).
- **Mitigation (phased, flag `VEND_AUTH_MODE=off|log|require`, default `off` at first deploy):**
  1. Backend: `resolve_machine_identity(x_machine_token, authorization)` → `{machine_id}` from
     `machine_credentials` (S-04) or `{"shared": True}` for the legacy token. In `log` mode,
     claim/complete record `vend.auth=none|shared|per_machine` and, when a per-machine token is
     present, **bind**: claim only for that `machine_id`; complete only if the job's `machine_id`
     matches. In `require` mode, absent/invalid → 401; mismatch → 403.
  2. Pi (`cloud_poller.py`): send `X-Machine-Token: ${MACHINE_SHARED_TOKEN}` on both calls (env var
     name kept for compatibility; value becomes per-machine in S-04). Unit tests in
     `tests/test_cloud_poller.py` updated.
  3. Flip to `require` when logs show 0 `auth=none` claims for 7 consecutive days across the fleet.
- **Compatibility:** `off`/`log` change nothing for current Pis. `require` needs every Pi on the
  updated poller; a Pi left behind stops vending (fails closed) — the 7-day telemetry gate prevents
  that.
- **Tests:** backend — `off` accepts headerless; `log` accepts and logs; `require` rejects
  headerless (401), wrong machine (403), revoked token (401); replay of the recorded legacy payloads
  from `sellmate-pi/tests` passes in `off`/`log`. Pi — poller unit test asserts the header is sent.
  Local — simulator `--scenario bad-token` → 401.
- **Rollback:** set `VEND_AUTH_MODE=log`; Pi change is header-only and backward compatible.

### S-03 Order prices supplied by the client

- **Where:** `main.py:64-72` `CreateOrderRequest {machine_id, items[{slot_id, qty}], amount_cents}`;
  `main.py:550-583` `create_order` stores `req.amount_cents` verbatim; `main.py:640-642`
  `start_payment` charges `int(order["amount_cents"])`. The backend never reads
  `machines/{id}/inventory` anywhere [V: grep]. Clients compute the amount locally:
  `pi-touchscreen/app/models/cart.py:16,34-35`, `app/state/checkout_service.py:54-61`;
  `SellMateKioskApp CheckoutManager.kt:51-58`.
- **Current behaviour:** `amount_cents=1` with any items is accepted; the reader prompts for $0.01;
  on authorisation the webhook creates a vend job for the full item list; the Pi dispenses.
- **Consequences:** in-person underpayment fraud bounded only by product value; also disabled or
  non-existent slots can be ordered.
- **Severity:** High (requires physical presence at the machine; trivially repeatable).
- **Mitigation (flag `ORDER_PRICE_MODE=off|log|enforce`):** backend computes
  `server_amount_cents = Σ price_cents(slot) × qty` from `machines/{id}/inventory/{slot}` reading
  `price_cents` with the same `priceCents` fallback the touchscreen uses
  (`inventory_client.py:63`), and checks `enabled`/existence. Stores `server_amount_cents` and
  `price_check: match|mismatch|unavailable` on the order. `log` mode records mismatches; `enforce`
  returns 400 on mismatch, unknown or disabled slot, or `qty ≤ 0`. Out-of-stock rejection is left to
  the inventory milestone (needs trustworthy `qty` first).
- **Compatibility:** the touchscreen and Kiosk compute from the same documents, so matches are
  expected; `log` mode proves it before `enforce`. If inventory docs are missing `price_cents`,
  `price_check=unavailable` is logged and the order proceeds in `log` mode.
- **Tests:** match → accepted; mismatch → 400 in `enforce`, accepted+logged in `log`; disabled slot
  → 400; `priceCents` fallback; replay of touchscreen fixture carts.
- **Rollback:** `ORDER_PRICE_MODE=log`.

### S-04 Shared fleet-wide machine credential

- **Where:** `main.py:223-244` `require_machine_token` compares against the single
  `MACHINE_SHARED_TOKEN`; `machine_id` is a parameter but unused in the comparison (docstring claims
  path binding; code does not implement it) [V]. Used by health (`main.py:1719`), theme
  (`1885,1907,1944`), commissioning/topology (`1983,2053,2081,2194,2597,2620`) and the dual-auth
  routes. Pi side: `sellmate-pi/app/health_reporter.py:37,333-337`, `topology_cloud.py:36,42-53`;
  touchscreen theme routes `cloud_client.py:86-144`. Token lives in `/etc/sellmate/machine.env` on
  every Pi.
- **Current behaviour:** any Pi (or anyone who reads one Pi's SD card) can act as every machine:
  spoof health, publish topology revisions, ack themes. Rotation means touching every Pi at once.
- **Severity:** Medium-High (devices are in public places; blast radius is the fleet).
- **Mitigation:** `machine_credentials/{machine_id}` `{token_sha256, status: active|revoked,
  issued_at, issued_by, rotated_from}`; backend checks per-machine first, then the shared token
  while `MACHINE_SHARED_TOKEN` is set. Issuance via `POST /machines/{id}/credentials` (owner-org
  admin or platform admin; returns the plaintext once). **Pi needs no code change for health,
  topology and theme** — replace the value in `machine.env`, restart the three services. Metric
  `machine.auth=shared|per_machine` per route.
- **Compatibility:** full, until `MACHINE_SHARED_TOKEN` is unset.
- **Tests:** per-machine token accepted only for its own `machine_id` (401/403 otherwise); revoked
  → 401; shared token still works while configured; with `MACHINE_SHARED_TOKEN` unset the shared
  value → 401 (retirement test).
- **Rollback:** keep/restore `MACHINE_SHARED_TOKEN`; revert a Pi's `machine.env`.

### S-05 Operator role supplied through a client-controlled header

- **Where:** `main.py:267-296` `resolve_topology_principal`: after the shared operator token
  validates (`theme_packages.py:106-117`), role = `normalize_role(x_sellmate_role, default=technician)`
  (`main.py:286-289`). Role gates in `commissioning_auth.py:21-38` (`admin` → `force` approve
  `main.py:2351-2358`, `migrate_legacy force` `2733`). Dashboard picks the role from a dropdown
  (`components/commissioning/auth-gate.tsx:22-27,71-86`) and sends `X-SellMate-Role`
  (`lib/commissioning/client.ts:154-172`). Theme Studio sends only the operator token
  (`src/theme/applyTheme.ts`).
- **Current behaviour:** anyone with the shared operator token is `admin` on request.
- **Consequences:** privilege escalation within commissioning (force-activate topology), no
  per-user accountability in audit.
- **Severity:** Medium (needs the shared token; impact limited to commissioning/theme).
- **Mitigation (flag `OPERATOR_ROLE_MODE=header|capped|id_token_only`):** add the Firebase
  ID-token principal (member role of the machine's `operator_org_id` mapped to FEATURE-013 roles).
  `capped`: shared-token callers get at most `technician` regardless of header. `id_token_only`:
  shared token no longer confers a role (theme publish keeps working via the token if you choose
  to keep it as a *machine-less service credential*, or Theme Studio signs in with Firebase Auth —
  recommended, since it is a React app).
- **Compatibility:** `header` = today. `capped` breaks only dashboard "admin" force actions until the
  dashboard uses ID tokens (T1/T4).
- **Tests:** header `admin` + shared token → `technician` in `capped`; ID token of an org `admin`
  → `admin`; viewer → `vendor`; non-member → 403.
- **Rollback:** `OPERATOR_ROLE_MODE=header`.

### S-06 Service-account credentials on the Raspberry Pi touchscreen

- **Where:** `pi-touchscreen/app/api/inventory_client.py:129-135` builds `firestore.Client()`
  from ADC; `services/touchscreen.env.example:29-30` sets
  `GOOGLE_APPLICATION_CREDENTIALS=/etc/sellmate/firestore-reader.json`; README L109-111. Reads
  `machines/{id}/planogramSlots` and `inventory` (`inventory_client.py:137-148`); writes nothing;
  has fixture (`INVENTORY_FIXTURE_PATH`) and disk-cache fallbacks (`:100-117,179-187`) [V].
- **Current behaviour:** a long-lived GCP key sits on a public-facing device. Its actual IAM role
  is unknown to me [?]; if it is `roles/datastore.user` or broader, a stolen key reads **and
  writes** every document regardless of rules.
- **Severity:** High if the role is writable or project-wide; Medium if `datastore.viewer` scoped
  to this project (still reads all orders).
- **Mitigation:** **Now (config):** verify the SA's role; reduce to `roles/datastore.viewer`; one
  key per machine; rotate. **Then (code):** backend `GET /machines/{id}/catalog` (merged
  planogram+inventory, machine-token authenticated, same shape as `InventorySnapshot`); touchscreen
  reads it instead of Firestore (keeps fixture/cache fallbacks); remove `google-cloud-firestore`
  from the touchscreen; delete keys. **Retire:** when every touchscreen is on the catalog endpoint,
  disable/delete the SA.
- **Compatibility:** the Firestore read today is a one-shot `stream()`, not a live listener, so a
  polled HTTP endpoint is equivalent.
- **Tests:** touchscreen suite runs with no `GOOGLE_APPLICATION_CREDENTIALS` set; `catalog`
  endpoint returns identical snapshots to the Firestore path for fixture machines; wrong machine
  token → 401.
- **Rollback:** touchscreen env flag `CATALOG_SOURCE=firestore|cloud`.

### S-07 Unauthenticated order lifecycle endpoints (new)

- **Where:** `main.py:550` `create_order`, `:586` `get_order`, `:595` `start_payment`, `:1186`
  `cancel_order` — no auth dependency [V]. Touchscreen sends `X-Machine-Token` only on theme routes
  (`cloud_client.py:86-144`), not on orders (`:50-62,83`) [V]. `create_order` does not verify the
  machine exists; `start_payment` does (`main.py:625`).
- **Current behaviour:** anyone can create orders for any machine, make its physical reader prompt
  for payment (`stripe.terminal.Reader.process_payment_intent`, `main.py:652`), cancel in-flight
  orders by UUID, and read any order.
- **Consequences:** nuisance/denial of service at the reader; interference with live checkouts;
  order data disclosure; amplifier for S-03.
- **Severity:** High.
- **Mitigation (flag `ORDER_AUTH_MODE=off|log|require`):** accept `X-Machine-Token` on all four
  routes; with a per-machine token, bind `req.machine_id` (create) and `order.machine_id`
  (others) to the token's machine; `require` rejects missing/mismatched. Touchscreen: add the header
  in `CloudClient` (one place; it already loads `MACHINE_SHARED_TOKEN` via `load_settings`). The
  Android Kiosk has no token → covered by D5 (retire or update).
- **Compatibility:** `off`/`log` safe; `require` after touchscreen rollout and Kiosk decision.
- **Tests:** as S-02 per route; cross-machine order with per-machine token → 403.
- **Rollback:** `ORDER_AUTH_MODE=log`.

### S-08 Non-atomic completion and completion from unclaimed state (new)

- **Where:** `main.py:1518-1702`. Terminal check (`:1537`) then separate `update()` calls; no
  transaction; no check that status is `CLAIMED`. The Pi posts `FAILED` if the `SUCCESS` call
  raises (`sellmate-pi/app/cloud_poller.py:577-592`).
- **Current behaviour:** two concurrent `SUCCESS` calls can both capture. A `PENDING` job can be
  completed without being claimed. A lost `SUCCESS` response is followed by `FAILED`, which
  cancels the payment even though the product was dispensed.
- **Consequences:** double Stripe calls; a dispensed product given away when capture reporting
  fails; with S-02, an attacker can complete a job the Pi has not claimed.
- **Severity:** Medium (reliability; abuse amplifier).
- **Mitigation:** the state machine in `vend-completion-workflow.md`. Firestore transactions only
  change job state. Stripe capture and cancel run after the transaction, following a PaymentIntent
  retrieve, with idempotency keys `sellmate_capture_{vend_job_id}` and
  `sellmate_cancel_{vend_job_id}`. Inventory (later) is decremented in the admission transaction,
  once, and is not part of a Stripe transaction. **Not implemented. Needs an explicit approval
  before `complete_vend_job` is edited (D-V2-08).**
- **Compatibility:** the happy path is unchanged (claim, then `SUCCESS` captures, `FAILED`
  cancels). The Pi will not retry `SUCCESS` on its own; recovery is server-side. A contradictory
  `FAILED` after `SUCCESS` was admitted must not cancel.
- **Tests:** the seventeen cases in `vend-completion-workflow.md` §4. None of them are implemented
  yet, and none of them run against live Stripe.
- **Rollback:** redeploy the previous Cloud Run revision. New status values are additive.

### S-09 Pi local vend-api defaults (new)

- **Where:** `sellmate-pi/app/vend_api.py:103` `VEND_API_KEY` default `CHANGE_ME`; `:394`
  `TECHNICIAN_PIN` default `4130` [V].
- **Consequences:** anyone on the machine's LAN/Wi-Fi can trigger vends or technician actions if
  the defaults were left in place [?].
- **Severity:** Medium.
- **Mitigation:** service refuses to start with default values unless `ALLOW_INSECURE_LOCAL_API=1`
  (dev only); setup script generates per-machine values. Verify current Pis now.
- **Tests:** startup test with defaults → exits non-zero; with values → starts.
- **Rollback:** env flag.

### S-10 Dashboard hygiene (new, low)

`lib/firebase.ts:13` logs the project ID; `.env.local` targets production. Fixed by the env model
in roadmap L1 (`NEXT_PUBLIC_SELLMATE_ENV` fail-fast, no logging in production builds).

---

## 2. Compatibility exceptions register

Every legacy mechanism kept alive has an owner condition for removal.

| Exception | Reason it exists | Migration path | Retirement condition | Retirement test |
|---|---|---|---|---|
| `MACHINE_SHARED_TOKEN` accepted | Pis carry it in `machine.env`; no rotation tooling | issue per-machine tokens; update `machine.env` per Pi | `machine.auth=shared` count = 0 for 14 days | backend test: shared value → 401 when env unset; CI check that prod config has no `MACHINE_SHARED_TOKEN` after retirement date |
| `VEND_AUTH_MODE=off/log` | Pi poller sends no header | poller update + per-machine tokens | `vend.auth=none` = 0 for 7 days | test suite runs with `require`; `off`/`log` code paths deleted in P5 and tests asserting 401 remain |
| `ORDER_AUTH_MODE=off/log` | touchscreen sends no header on order routes; Kiosk has no token | touchscreen header; Kiosk retired or updated (D5) | `order.auth=none` = 0 for 7 days | same pattern |
| `ORDER_PRICE_MODE=off/log` | unproven inventory data quality | `log` mismatches to zero; fix inventory docs | 0 mismatches for 14 days | `enforce` only mode remains; mismatch test → 400 |
| `OPERATOR_ROLE_MODE=header` | dashboard & Theme Studio use shared operator token | dashboard commissioning via ID token (T1/T4); Theme Studio via Firebase Auth or a service credential | no `X-SellMate-Role` observed for 14 days | header ignored test; role derived from membership only |
| Public read of `inventory`/`planogramSlots` (rules R3) | Android Kiosk unauthenticated reads | retire Kiosk or add auth/catalog endpoint | D5 answered "retired" or Kiosk updated | rules test: anonymous read denied |
| Touchscreen service account | current catalog source | `GET /machines/{id}/catalog` | all touchscreens on catalog endpoint | touchscreen tests without ADC; SA key deleted (manual checklist) |

---

## 3. Phase details and approval checkpoints

| Phase | Content | Repos | Needs approval for |
|---|---|---|---|
| P0 | IAM check on the touchscreen SA; Pi `machine.env`/`VEND_API_KEY`/`TECHNICIAN_PIN` check; Kiosk deployment status; Firebase Auth providers | none (console/SSH) | — (your actions) |
| P1 | backend shadow mode: `machine_credentials` + resolver; flags default to legacy behavior; credential issuance route; `GET /machines/{id}/catalog`; tests. Vend-completion redesign is **not** in this deploy | SellMateCloud | Cloud Run deploy of flags only. S-08 is a later, separate approval |
| P2 | `cloud_poller.py` headers; touchscreen `CloudClient` header + catalog source flag; issue tokens; per-Pi `machine.env` | sellmate-pi, pi-touchscreen, fleet ops | fleet rollout schedule |
| P3 | flip `VEND_AUTH_MODE=require`, `ORDER_AUTH_MODE=require`, `ORDER_PRICE_MODE=enforce`, `OPERATOR_ROLE_MODE=capped` | Cloud Run config | each flip, after telemetry gate |
| P4 | rules R0a now; R1/R2 after T1; R3 after D5; SA removal | firebase/, Pis | each rules deploy |
| P5 | delete legacy code paths and env vars; retirement tests stay | all | — |

---

## 4. Tests required (consolidated)

- Backend unit (fake Firestore): credential resolver; each flag mode per route; binding of
  `machine_id`; price computation incl. `priceCents` fallback; the vend-completion cases in
  `vend-completion-workflow.md` §4 (emulator, fake payments, not live Stripe); legacy payload
  replay from `sellmate-pi/tests` and `pi-touchscreen/tests` fixtures in `off`/`log` modes.
- Pi unit: poller header present; touchscreen header present; touchscreen catalog client parity
  with Firestore client on fixtures; vend-api refuses defaults.
- Rules (emulator): R0 reproduces live behaviour; R0a denies the four collections; R2/R3 cases.
- Local scenarios (Dev Console / `make scenario`): `bad-token`, `revoked-token`,
  `cross-machine-complete`, `manipulated-price`, `duplicate-complete`, `duplicate-webhook`.
- Retirement tests listed in §2.

---

## 5. Out of scope here

Multi-tenant authorization (covered in `docs/multi-tenant/01-architecture-v2.md`), inventory
decrement (`inventory-accounting-plan.md`), Stripe account configuration, network hardening of the
Pis, OS patching.
