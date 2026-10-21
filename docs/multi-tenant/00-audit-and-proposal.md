# SellMate Multi‑Tenant Foundation — Milestone 0: Audit and Proposal

Status: **AUDIT RECORD (retained) + ORIGINAL PROPOSAL (partially superseded). Nothing implemented.**
This document is uncommitted. Delete the `docs/multi-tenant/` and `docs/architecture/` folders to
reverse all planning work.

> **Revision 2 — 2026‑10‑18.** All security and behavioural findings in §1, §2 and §7.1 were
> re‑verified against source and the live Firebase project on 2026‑10‑18 and stand unchanged (the
> live rules fetched today are byte‑identical to §1.2; Java is still missing). The *design* sections
> are superseded as follows — read the newer document for anything that conflicts:
>
> | Section here | Superseded by |
> |---|---|
> | §3 model, §4 permission matrix, §5 schemas/indexes, §6 backend, §9 dashboard | [01‑architecture‑v2.md](01-architecture-v2.md) |
> | §8 local environment (re‑homed to `firebase/`, `dev/`, `Makefile`, Dev Console) | 01 §8 and [02‑monorepo‑integration.md](02-monorepo-integration.md) |
> | §10 slices, §13 manual checklist (retained as step references) | [03‑implementation‑roadmap.md](03-implementation-roadmap.md) |
> | §11 decisions D1, D10, D14; §3.5 `host_viewer`; §5.1 `kind`; §5.7 kinds/`terms`; §5.8 flat fields | [04‑decision‑summary.md](04-decision-summary.md) |
> | Security items S4–S8, D14 | [../architecture/security-remediation-plan.md](../architecture/security-remediation-plan.md) (separate project) |
> | Inventory gap (§1.6) | [../architecture/inventory-accounting-plan.md](../architecture/inventory-accounting-plan.md) (separate milestone) |
>
> **Corrections after approval (same day).** Hosts do not read the machine document
> (reader id and health detail cannot be redacted). Placement in the pilot is owner/operator
> initiated and platform-admin authorized, with host approval reserved. Vend completion does not
> call Stripe inside a Firestore transaction; see
> [vend-completion-workflow.md](../architecture/vend-completion-workflow.md). Which clients are
> still real is in [legacy-client-inventory.md](../architecture/legacy-client-inventory.md).
> The implementation sequence is security tests, then shadow-mode backend, then the monorepo.
>
> Additional facts established on 2026‑10‑18 that refine §1: the Pi poller sends **no headers at
> all** on claim/complete and does not read `MACHINE_SHARED_TOKEN` (`sellmate-pi/app/cloud_poller.py:101-115,376-399`);
> the touchscreen sends `X-Machine-Token` only on theme routes, not order routes
> (`pi-touchscreen/app/api/cloud_client.py:50-62,83,86-144`); `complete_vend_job` is non‑atomic and
> accepts completion from `PENDING` (`main.py:1537-1598`); nothing reads `checkout_sessions`,
> `stripe_event_receipts`, `commands` or `activity` from any client; the dashboard's `topologyAudit`
> read is not permitted by the live rules; `SellMateKioskApp` still exists (last commit 2026‑05‑25).

Audit date: 2026‑10‑17. All claims below are tagged:

- **[V]** verified in code / live config (file:line given)
- **[A]** reasonable assumption, not verified
- **[?]** unanswered question needing your input or access

---

## 0. Executive summary (plain language)

The system today is a working **single‑tenant** vending stack keyed only by `machine_id`. There is
no notion of organization, user, membership or role anywhere in data, and the only "identities" are
two shared secrets (one for all machines, one for all operators) plus a self‑declared role header.
The dashboard has no sign‑in at all; it reads production Firestore anonymously, which works only
because the **live Firestore rules allow public read of every commerce collection** (orders,
vend_jobs, checkout_sessions, inventory, machines). Those rules are not in version control.

The good news: device‑facing contracts are narrow and well documented, nothing on the Pis writes
Firestore, and the backend already stamps `machine_id` on every order/vend job. That makes an
**additive** multi‑tenant design feasible without moving any collection or changing any device:

1. Add `organizations`, memberships, `locations`, `machine_assignments`, `audit_events`.
2. Stamp `owner_org_id` / `operator_org_id` / `location_id` onto `machines/{id}` (current state)
   and onto each new order / vend job **at creation** (frozen history).
3. Give the dashboard real Firebase Auth and tenant‑filtered queries.
4. Tighten Firestore rules to deny‑by‑default with membership checks, on a schedule that keeps the
   one anonymous Firestore client (the Android Kiosk app) working until you retire or update it.
5. Move tenant‑admin mutations (memberships, transfers) behind the existing FastAPI backend, which
   verifies Firebase ID tokens and writes audit events.

Everything can be demonstrated locally with Firebase emulators and a simulated machine, except
Stripe capture and physical vending. One prerequisite is missing on this Mac: **a Java runtime**
(required by the Firestore emulator).

---

## 1. Verified current‑system map

### 1.1 Repositories found in `/Users/sam/AndroidStudioProjects`

| Repo | Stack | Role | Git remote | Notes |
|---|---|---|---|---|
| `SellMateCloud` | Python 3.11 / FastAPI / `google-cloud-firestore` / Stripe | Cloud backend (Cloud Run) | SamBeals/SellMateCloud | 90 KB `main.py`; last commit FEATURE‑013 |
| `sellmate-dashboard` | Next.js 16 / React 19 / Firebase JS SDK 12 / Tailwind | Fleet dashboard (early) | SamBeals/sellmate-dashboard | Client‑only; no server routes |
| `sellmate-pi` | Python, systemd | Pi vend poller, health reporter, local vend‑api | SamBeals/sellmate-pi | No Firestore access |
| `pi-touchscreen` | Python / Qt Quick | Customer kiosk UI on Pi | SamBeals/pi-touchscreen | Reads Firestore with a **service account** |
| `SellMateKioskApp` | Kotlin / Compose / Firebase Android | Older Android tablet kiosk | SamBeals/SellMateKioskApp | Hardcoded `machine_001`; anonymous Firestore reads |
| `sellmate-theme-studio` | Vite / React | Theme editor; publishes themes via backend | SamBeals/sellmate-theme-studio | No Firebase |
| `MarketKioskDisplayApp` | Android | Unrelated nail‑booth display app | none | **Out of scope** [V] |
| `SellMateDashboard/` | — | Empty folder (only `.idea`) | — | Ignore |

Workspace root (not a git repo) contains `.firebaserc` → `sellmate-bdd22` [V] and **no**
`firebase.json`, `firestore.rules`, or `firestore.indexes.json` anywhere in the workspace [V].

Missing / not available to me: Cloud Run service config and IAM, the Pi service‑account JSON,
production env values (`MACHINE_SHARED_TOKEN`, `THEME_OPERATOR_TOKEN`, Stripe keys), Firebase Auth
console configuration, Firestore composite indexes in the console, and the production dataset
contents. I did **not** enumerate production data. [?]

### 1.2 Live Firestore security rules (fetched read‑only from project `sellmate-bdd22`) [V]

```text
match /machines/{machineId}            { allow read: if true;
  match /inventory/{slotId}            { allow read: if true; }
  match /planogramSlots/{slotId}       { allow read: if true; }
  match /commands/{commandId}          { allow read: if true; }
  match /activity/{activityId}         { allow read: if true; } }
match /orders/{orderId}                { allow read: if true; }
match /vend_jobs/{vendJobId}           { allow read: if true; }
match /stripe_event_receipts/{eventId} { allow read: if true; }
match /checkout_sessions/{sessionId}   { allow read: if true; }
match /{document=**}                   { allow read, write: if false; }
```

Consequences:

- Anyone on the internet with the (public) web API key can read all orders, vend jobs, checkout
  sessions, inventory and machine docs. There is no client write path at all.
- `machines/{id}/health/*`, `topology*`, `commissioning*` are not readable by clients — the backend
  works around this by denormalising onto the machine doc
  (`SellMateCloud/main.py:1738-1750`, `sellmate-dashboard/app/machines/[machineId]/page.tsx:217-219`).
- `commands` and `activity` subcollections are referenced by rules but **no code** reads or writes
  them [V] (legacy).
- The rules file is **not in any repo**; nothing can be rules‑tested today.

### 1.3 Firestore collections actually used

| Path | Writer | Readers | Key fields |
|---|---|---|---|
| `machines/{machine_id}` | Backend merges only; **root doc is created manually** (`main.py:436-440` returns 400 if missing) | Dashboard, backend | `display_name`, `status`, `stripe_reader_id`, `template_id`, `location{lat,lng}`, `last_seen_at`, `health_status`, `health_issue_count`, `health_current`, `desired_theme`, `applied_theme`, `topology_active`, `topology_review`, … |
| `machines/{id}/inventory/{slot}` | **Nobody in code** (console/manual) | Dashboard, touchscreen, Kiosk | `slot_id`, `name`, `price_cents`, `qty`/`inventory`, `capacity`, `enabled`, `imageUrl`, `sku_id` |
| `machines/{id}/planogramSlots/{slot}` | **Nobody in code** | Touchscreen, Kiosk | `slot_id`, `enabled`, `motorId`, `i2cMask`… |
| `machines/{id}/health/current` | Backend `POST /machines/{id}/health` (`main.py:1729-1737`) | none (rules block) | full health doc (`health_status.py:146-168`) |
| `machines/{id}/topology/{active,proposed}`, `topologyRevisions/*`, `topologyAudit/*`, `commissioningSessions/*`, `commissioning/current`, `commissioningCommands/*` | Backend (`topology_service.py`) | Dashboard reads `topologyAudit` (`page.tsx:249-254`) | FEATURE‑013 |
| `orders/{uuid}` | Backend (`main.py:550-583`, webhook, claim/complete) | Dashboard, kiosks via HTTP | `order_id`, `checkout_session_id`, `machine_id`, `items[{slot_id,qty}]`, `amount_cents`, `status`, `created_at`, `stripe_payment_intent_id`, `vend_job_id` |
| `checkout_sessions/{uuid}` | Backend | — | mirror of order |
| `vend_jobs/{uuid}` | Backend webhook → Pi claim/complete | Dashboard | `machine_id`, `order_id`, `status`, `amount_cents`, `items`, evidence fields |
| `stripe_event_receipts/{evt}` | Backend | — | `event_id`, `type`, `received_at` |
| `theme_packages/{id}` | Backend | — | theme metadata |

Money is already integer cents (`amount_cents`); **currency is hardcoded `"usd"`**
(`main.py:641-642`) and not stored on documents [V].

### 1.4 Authentication and authorization today

| Mechanism | Where | What it proves |
|---|---|---|
| `MACHINE_SHARED_TOKEN` via `X-Machine-Token` or `Authorization: Bearer` | `main.py:209-244` | Caller is *some* machine. **Not bound to `machine_id`** — any holder can act as any machine [V] |
| `THEME_OPERATOR_TOKEN` via `X-Operator-Token` | `theme_packages.py:106-117` | Caller is *some* operator/dashboard |
| `X-SellMate-Role` (vendor / trusted_vendor / technician / admin) | `main.py:281-290`, `commissioning_auth.py` | **Nothing** — client picks any role, including `admin`, after the shared operator token validates [V] |
| Stripe signature | `main.py:1322-1328` | Webhook authenticity |
| **No auth at all** | `POST /orders`, `GET/POST /orders/{id}/*`, `GET /vend_jobs/claim`, `POST /vend_jobs/{id}/complete`, `GET /machines/{id}/commands/next` (`main.py:550,586,595,1186,1436,1518`) | Anyone can create an order for any machine with any `amount_cents`, claim another machine's pending vend, or mark a vend SUCCESS to capture payment [V]; acknowledged in `SellMateCloud/AGENTS.md:174` |
| Dashboard | `lib/firebase.ts` | No Firebase Auth; role chosen from a dropdown and kept in `sessionStorage` (`components/commissioning/auth-gate.tsx:71-85`, `lib/commissioning/credentials.ts`) |
| pi‑touchscreen Firestore | `app/api/inventory_client.py:129-135`, `README.md:109-111` | GCP **service‑account JSON** on the Pi (`/etc/sellmate/firestore-reader.json`) → bypasses rules entirely |
| SellMateKioskApp Firestore | `FirestorePlanogramService.kt:20-36` | Anonymous Firebase client; relies on public‑read rules; no `firebase-auth` dependency [V] |
| sellmate‑pi local vend‑api | `vend_api.py:397-402` | LAN `X-API-Key` (`VEND_API_KEY`, default `CHANGE_ME`) + technician PIN (default `4130`) |

### 1.5 Machine identity and configuration

- Identity is `/etc/sellmate/machine.env` → `MACHINE_ID`, `CLOUD_BASE`, `MACHINE_SHARED_TOKEN`
  (`sellmate-pi/services/machine.env.example:12-14`, `sellmate-pi/app/config.py:19-46`,
  `pi-touchscreen/app/config.py:127-140`) [V].
- Backend never creates `machines/{id}`; machines are provisioned by hand in Firestore [V].
- `vend-api.service` does not load `machine.env`, so commissioning publishes may report
  `machine_id="unknown"` (`sellmate-pi/app/commissioning.py:42-43`) [V] — pre‑existing issue, noted
  for the compatibility inventory.
- SellMateKioskApp hardcodes `machine_001` and the Cloud Run URL (`MainActivity.kt:32-33`) [V].

### 1.6 Flows

- **Order → payment → vend**: kiosk `POST /orders` → `POST /orders/{id}/start_payment` (Stripe
  Terminal, manual capture) → webhook creates `vend_jobs` PENDING → Pi `GET /vend_jobs/claim`
  every 5 s → local vend → `POST /vend_jobs/{id}/complete` → capture/cancel (`AGENTS.md:37-48`).
- **Inventory/planogram**: read‑only by kiosks and dashboard; no decrement anywhere
  (`AGENTS.md:159`) [V].
- **Health**: Pi posts every ~60 s with `X-Machine-Token`; backend derives online/offline at read
  time (`health_status.py:14-15, 112-136`).
- **Themes** and **commissioning/topology**: operator‑token HTTP flows; details in audits above.

### 1.7 Dashboard today

- `/` (`app/page.tsx:139-151`): `getDocs(machines)`, `orders where created_at >= …`,
  `vend_jobs where created_at >= today` — **fleet‑wide, no tenant filter**; totals computed client
  side; revenue formatted as USD.
- `/machines/[id]` (`page.tsx:210-254`): machine doc, `inventory` subcollection, `topologyAudit`
  (orderBy created_at desc, limit 25); "Sales & Events" tab is **mock data** (`page.tsx:87-125`).
- `/machines/[id]/commissioning`: operator‑token + role dropdown gate.
- One‑shot `getDocs` everywhere, no listeners, no cache layer, no contexts; per‑page `useState`.
- Loading/empty/error states exist on both pages; no forbidden state (nothing is forbidden yet).
- `lib/firebase.ts:13` logs the project ID to the console on every load; `.env.local` (gitignored)
  points at **production** `sellmate-bdd22`.

### 1.8 Tests, emulators, scripts

| Repo | Tests | Runner | Firestore in tests | Emulator |
|---|---|---|---|---|
| SellMateCloud | 7 files | `python3 -m unittest discover -s tests -v` | `MagicMock` stubs + `tests/fake_firestore.py` (no queries/transactions) | none |
| sellmate-dashboard | 2 files | `npm test` (`tsx --test`) | none (pure functions) | none |
| sellmate-pi | 9 files | `MACHINE_ID=machine_test python3 -m unittest …` | n/a (HTTP mocked) | none |
| pi-touchscreen | 17 files | unittest; `INVENTORY_FIXTURE_PATH=fixtures/inventory.json` for UI | n/a | none |

No repo contains `FIRESTORE_EMULATOR_HOST` handling [V]. Local tooling present: Node 25.3,
Firebase CLI 15.24, Python 3.14 (backend Dockerfile uses 3.11), Docker 29.7. **Java runtime is
missing** (`java -version` → "Unable to locate a Java Runtime") — the Firestore/Auth emulators need
JDK 11+ [V].

### 1.9 Firebase project facts

`sellmate-bdd22` ("SellMate"), project number 1002770348452, Cloud Run URL
`https://sellmatecloud-1002770348452.us-west4.run.app` [V]. An iOS app `sambeals.SellMateTrial` is
registered [V]. Whether Firebase Authentication is enabled and which providers are configured: [?].

---

## 2. Existing single‑tenant assumptions (what must change)

| # | Assumption | Where | Impact |
|---|---|---|---|
| S1 | `machine_id` is the only partition key; no org anywhere | all repos | New tenant fields + collections needed |
| S2 | Dashboard lists *all* machines/orders/vend_jobs | `app/page.tsx:139-151` | Must filter by active org and be denied otherwise |
| S3 | Dashboard has no user identity | `lib/firebase.ts` | Add Firebase Auth |
| S4 | Public‑read Firestore rules | live rules | Must become deny‑by‑default with membership checks |
| S5 | Role is client‑supplied (`X-SellMate-Role`, dropdown) | `main.py:286-290`, `auth-gate.tsx` | Replace with membership‑derived role from verified ID token |
| S6 | One shared machine token for the fleet | `main.py:223-244` | Per‑machine credentials (additive) |
| S7 | Order creation trusts `machine_id` and `amount_cents` from an unauthenticated caller | `main.py:550-563` | Tenant stamping must be server‑side from the machine doc, never from the request; amount validation is a separate (payment) concern — **out of scope unless approved** |
| S8 | `vend_jobs/claim` / `complete` unauthenticated | `main.py:1436,1518` | Pi can't be changed remotely by me; propose flag‑gated enforcement |
| S9 | Orders/vend_jobs carry no org attribution | `main.py:558-567` | Stamp at creation; backfill history via approved migration |
| S10 | Machines are hand‑created in Firestore | `main.py:436-440` | Keep; add admin "register machine" later (M3) |
| S11 | Currency hardcoded `usd` | `main.py:642` | Store `currency` on new financial docs; keep PI call unchanged |
| S12 | Rules not in source control | — | First review unit: check in the exact live rules |
| S13 | Dashboard env points at production; no emulator switch | `.env.local`, `lib/firebase.ts` | Explicit `NEXT_PUBLIC_SELLMATE_ENV` with fail‑fast |
| S14 | Backend `firestore.Client()` uses ADC project implicitly | `main.py:22` | Explicit `SELLMATE_ENV` + emulator guard |

---

## 3. Recommended tenant boundary and data model

### 3.1 Options compared

| Option | Description | Migration cost | Query pattern | Rules complexity | Device compatibility |
|---|---|---|---|---|---|
| **A. Org‑prefixed paths** `organizations/{org}/machines/{id}/…` | Move all machine‑scoped data under the org | **High**: move every doc; dual‑read in every client | Simple path‑scoped | Simplest (path only) | **Breaks** touchscreen, Kiosk, backend paths; Pi `machine.env` would need org |
| **B. Keep paths, add tenant fields + new top‑level collections** (recommended) | `machines/{id}` gains `owner_org_id`, `operator_org_id`, `location_id`; orders/vend_jobs stamped at creation; new `organizations`, `locations`, `machine_assignments`, `audit_events` | **Low**: additive fields; one backfill for history | Equality filter on tenant field (+ composite index with `created_at`) | Moderate: rules do a `get()` on the membership doc | **No device changes**; service‑account and HTTP clients unaffected |
| **C. B + custom claims** (org roles in the ID token) | Same data as B; rules read `request.auth.token.orgs` instead of `get()` | Low | Same | Lower per‑read cost; **claims go stale** until token refresh (≤1 h) or forced sign‑out | Same as B |

**Recommendation: B now, C later only if rule‑read cost matters.** B gives immediate revocation
(membership doc deleted → next read denied), keeps a single source of truth, and costs one extra
document read per rule evaluation (cached within a request). Claims can be layered on later as a
pure optimisation without changing the data model.

### 3.2 Who governs access to what

| Resource | Authoritative scope | Owner org | Operator org | Host (location) | Platform admin |
|---|---|---|---|---|---|
| `organizations/{org}` settings | the org itself | members (role‑dependent) | — | — | all |
| memberships | the org | owner/admin manage | — | — | all |
| `machines/{id}` doc | **operator org** (primary), owner org (limited) | read identity, health summary, assignments; **not** inventory/sales | full per role | deferred (see §4.4) | all |
| `inventory`, `planogramSlots` | operator org | no | read; edit for operator+ | no | all |
| health (`health_current`) | operator org (+ owner read) | read | read | status only (deferred) | all |
| `orders`, `vend_jobs`, `checkout_sessions` | **the `operator_org_id` stamped on the document** (frozen) | no | read | no | all |
| `locations/{id}` | the **host** org that owns the location record, plus operators placing machines there | — | read (if placed there) | manage own locations | all |
| `machine_assignments` history | operator and owner orgs involved in that row | read own rows | read own rows | read own placement rows | all + write |
| `audit_events` | `org_id` on the event | owner/admin read | owner/admin read | — | all |
| `platform_admins` | platform only | — | — | — | read; write only via backend/seed |

Ownership, operation and hosting are **separate relationships with separate, non‑identical
grants**. ~~The owner of a machine does not see its sales. The host sees nothing tenant‑wide.~~
**[Superseded 2026‑10‑18]** Owner and host receive scoped revenue summaries through a backend
endpoint; the operator alone sees transactions. See 01 §3.3 and §5.

### 3.3 Historical attribution policy

- Every new order / checkout session / vend job gets `operator_org_id`, `owner_org_id`,
  `location_id`, `operator_assignment_id` copied from the machine doc **at creation by the
  backend**. These fields are never updated afterwards (rules + backend both forbid).
- **Former operator**: keeps read access to orders/vend_jobs stamped with its org forever (its
  sales), loses access to the machine doc, inventory, planogram and current health at
  `effective_to`. There is no historical inventory or telemetry store today, so nothing further to
  grant; if health history is added later, it follows the same stamping rule.
- **New operator**: sees the machine, inventory, planogram, health from `effective_from`; sees only
  orders stamped with its org (i.e. none before the transfer).
- **Owner**: sees assignment history for machines it owns, never sales (initially).
- Dashboard totals are therefore computed from `orders where operator_org_id == activeOrg`, and a
  transfer cannot move past revenue.

### 3.4 Assignment rules

- Exactly **one active** `owner`, **one active** `operator`, **one active** `placement` per machine
  (unassigned is allowed and is the state of a freshly registered machine).
- `effective_from` is server time at the moment of change (backend `SERVER_TIMESTAMP`); past dates
  are allowed **only** through the approved migration tool for backfill. **Future‑dated
  assignments are not supported** in this project (kept out to avoid scheduler + rules complexity).
- Overlap prevention: the backend performs a Firestore **transaction** that (1) reads the machine
  doc and its `assignment_version`, (2) compares with the caller‑supplied
  `expected_assignment_version` (409 on mismatch), (3) closes the current active row
  (`effective_to = now`, `status = "ended"`), (4) creates the new row, (5) updates the denormalised
  fields and increments `assignment_version`, (6) writes an `audit_events` doc — all in one
  transaction. Rules deny client writes to `machine_assignments` and the denormalised machine
  fields, so the backend is the only writer.

### 3.5 Roles (initial set) and mapping from today's roles

| New role | Meaning | Replaces |
|---|---|---|
| `owner` | Organization owner; can do everything in the org incl. manage admins and delete/rename org | — |
| `admin` | Day‑to‑day administrator: members (not owners), machines, assignments (if owner org), devices | FEATURE‑013 `admin` |
| `operator` | Field/technician staff: inventory, planogram, commissioning; no member or settings changes | `technician`, `trusted_vendor` |
| `viewer` | Read‑only | `vendor` |
| `platform_admin` (not a membership) | SellMate staff; granted by `platform_admins/{uid}` doc writable only by backend/seed | — |
| ~~`host_viewer` (deferred, §4.4)~~ | **[Dropped 2026‑10‑18]** hosting is a business relationship, not a member role; host staff use the four roles above (01 §3.2) | — |

Why four: the brief's "operator or technician" is merged into `operator` because both edit
inventory/planograms and run commissioning; splitting them later is a one‑line matrix change.

---

## 4. Role–permission matrix

Capabilities are the single vocabulary used by UI, backend and rules tests. Proposed file:
`sellmate-dashboard/lib/authz/capabilities.json` (mirrored to
`SellMateCloud/authz/capabilities.json` with a test that both copies are byte‑identical when the
sibling repo is present).

| Capability | owner | admin | operator | viewer | platform_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `org.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org.settings.edit` (name, labels, defaults) | ✓ | ✓ | – | – | ✓ |
| `members.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `members.manage` (add, remove, change role ≤ admin) | ✓ | ✓ | – | – | ✓ |
| `members.manage_owner` (grant/revoke owner) | ✓ | – | – | – | ✓ |
| `machines.view` (as operator org) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `machines.view_owned` (as owner org: identity, health summary, assignments) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `machines.register` (create machine doc, owned by this org) | ✓ | ✓ | – | – | ✓ |
| `machines.assign` (set/transfer operator or placement) — **as owner org only** | ✓ | ✓ | – | – | ✓ |
| `machines.release_operation` (end own operator assignment) | ✓ | ✓ | – | – | ✓ |
| `sales.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory.view`, `planogram.view`, `health.view`, `location.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory.edit`, `planogram.edit` | ✓ | ✓ | ✓ | – | ✓ |
| `commissioning.run` (FEATURE‑013 workflow) | ✓ | ✓ | ✓ | – | ✓ |
| `commissioning.force_activate` | ✓ | ✓ | – | – | ✓ |
| `devices.manage` (issue/rotate per‑machine credential) | ✓ | ✓ | – | – | ✓ |
| `audit.view` | ✓ | ✓ | – | – | ✓ |
| `platform.orgs.manage`, `platform.legacy_mapping`, `platform.admins.view` | – | – | – | – | ✓ |

Rules of thumb enforced everywhere:

- Nobody can change **their own** membership document (owner included) — prevents self‑promotion
  and accidental lock‑out is handled by requiring another owner or platform admin.
- `admin` cannot create or modify an `owner` membership.
- Ownership transfer (owner role change) and machine transfers write audit events.
- Hiding a button is UX only; every capability above is enforced in rules (reads/simple writes) or
  backend (administrative writes) and tested directly.

### 4.1 Where each capability is enforced

| Capability group | Firestore rules (client SDK) | Backend (Admin SDK) | Notes |
|---|---|---|---|
| All `*.view` | ✓ membership `get()` | ✓ when served via API | Queries must filter by tenant field |
| `inventory.edit`, `planogram.edit` | ✓ field‑validated client write | — (M4 may add API) | Simplest path; no backend owns these docs today |
| `members.*`, `org.settings.edit`, `machines.register/assign/release`, `devices.manage` | **deny** client writes | ✓ ID‑token verified + membership lookup + audit | Backend is only writer |
| `audit.view` | ✓ read by org owner/admin | — | Client writes always denied |
| `platform.*` | `platform_admins/{uid}` exists | ✓ same check | Writable by backend/seed only |
| Machine endpoints (health, theme, topology, claim/complete) | n/a | machine credential (per‑machine, M4) | Legacy shared token accepted while configured |

### 4.2 Revocation and role‑change strategy

- Source of truth is the membership document. Rules `get()` it on every request → **revocation is
  immediate for Firestore reads/writes**. Backend looks it up per request → immediate for API.
- No custom claims in the initial design, so **no token‑staleness problem**. If claims are added
  later (option C), the design must include a `claims_version` on the user doc and the backend
  forcing `revokeRefreshTokens` on downgrade; this is explicitly deferred.
- Dashboard listens (`onSnapshot`) to its own membership doc for the active org; when it
  disappears or the role changes, the UI clears tenant state and shows the forbidden/empty state.
- Platform admin status is a document (`platform_admins/{uid}`) that **no client can write**; it is
  seeded in the emulator and would be created in production only by a backend/console action you
  perform.

### 4.3 Cross‑tenant leakage controls (dashboard)

- All tenant data is held in an `OrgContext` keyed by `activeOrgId`; switching org **unmounts** the
  tenant subtree, cancels listeners and resets state (no shared caches across orgs).
- `activeOrgId` is stored in `localStorage` but is **validated against the membership list on every
  load**; an unknown or revoked org falls back to "choose organization".
- Error messages shown to users never include other orgs' IDs or document paths; raw errors go to
  `console.error` only in non‑production builds.
- Exports (CSV, later) are generated from the already tenant‑filtered query result, never from a
  broader fetch.

### 4.4 Host (location) access — deferred but defined

> **[Superseded 2026‑10‑18]** host access is in scope as a *relationship* (machine doc read via
> denormalised `host_org_id`, placement history, scoped revenue summary) with no new role. See 01
> §3.3.

`locations/{locationId}` has `host_org_id`. A future `host_viewer` membership would grant read on
`locations` it hosts and the `machines` currently placed there, limited to identity + online/offline.
Not in Milestones 1–4.

---

## 5. Firestore design

Conventions: snake_case fields (matches existing docs), `schema_version` integer on new document
types, integer minor units + `currency` for money, server timestamps for `created_at/updated_at`,
IDs are stable slugs for fixtures and random IDs in production.

### 5.1 `organizations/{orgId}`

> **[Superseded 2026‑10‑18]** `kind` is removed in v2. An organization's business roles (machine
> owner, machine operator, location host) are derived from `machine_assignments` and
> `locations.host_org_id`, so one org can hold all three at once without changing type. See 01 §2.

```json
{
  "schema_version": 1,
  "org_id": "org_northside",
  "name": "Northside Vending LLC",
  "kind": "operator",            // REMOVED in v2 — see note above
  "status": "active",            // "active" | "suspended"
  "default_currency": "usd",
  "settings": { "labels": { "machine": "Machine" } },
  "created_at": "<server ts>", "updated_at": "<server ts>",
  "created_by": "uid_platform_admin"
}
```

- Scope: itself. Read: any member or platform admin. Client writes: **none** (settings edits go via
  backend so they're audited). Backend only: everything.
- Queries: by ID only (members fetch their org docs from the membership list).

### 5.2 `organizations/{orgId}/members/{uid}`

```json
{
  "schema_version": 1,
  "org_id": "org_northside", "uid": "uid_dana_admin",
  "role": "admin",               // owner | admin | operator | viewer
  "status": "active",            // active | revoked
  "display_name": "Dana Admin", "email": "dana@northside.test",
  "created_at": "...", "updated_at": "...", "granted_by": "uid_nina_owner",
  "revoked_at": null, "revoked_by": null
}
```

- Scope: the org. Read: members of the org (list) and the member themself (own doc, for
  "my organizations"). Client writes: **none**. Backend: all, with audit.
- Queries: `collectionGroup("members").where("uid","==",me).where("status","==","active")` → needs
  a **collection‑group index on `members.uid`** (and composite `uid`+`status`). Org member list:
  `organizations/{org}/members` ordered by `role`.
- Rules helper: `isActiveMember(orgId) = exists(/organizations/$(orgId)/members/$(uid)) && get(...).data.status == "active"`;
  `roleIn(orgId, roles)`.

### 5.3 `users/{uid}` (profile only)

```json
{ "schema_version": 1, "uid": "...", "display_name": "...", "email": "...",
  "last_active_org_id": "org_northside", "created_at": "...", "updated_at": "..." }
```

- Read/write: the user themself; **no role or org fields** live here (rules reject unknown keys).
  `last_active_org_id` is a convenience and is always re‑validated against memberships.

### 5.4 `platform_admins/{uid}`

```json
{ "schema_version": 1, "uid": "...", "granted_at": "...", "granted_by": "seed|console|uid", "note": "SellMate staff" }
```

- Read: the uid itself (to render the platform area). Client writes: **never**. This is the trusted
  mechanism for platform access; in production you create it yourself (console or an approved
  backend command).

### 5.5 `locations/{locationId}`

```json
{ "schema_version": 1, "location_id": "loc_beanhouse_cafe", "name": "Bean House Café",
  "host_org_id": "org_beanhouse", "address": { "line1": "...", "city": "...", "region": "...", "postal_code": "...", "country": "US" },
  "geo": { "latitude": 0, "longitude": 0 }, "status": "active",
  "created_at": "...", "updated_at": "...", "created_by": "..." }
```

- Scope: `host_org_id` manages it; operator orgs with a machine placed there can read it.
- Rules read: `isActiveMember(host_org_id)` OR platform admin OR (`location_id` appears on a machine
  the reader operates — implemented by denormalising `location_name`/`location_id` on the machine
  doc so the operator rarely needs the location doc directly).

### 5.6 `machines/{machineId}` — additive fields

```json
{
  "...existing fields unchanged...",
  "tenancy_schema_version": 1,
  "owner_org_id": "org_sellmate",
  "operator_org_id": "org_northside",      // null when unassigned
  "location_id": "loc_beanhouse_cafe",     // null when unplaced
  "owner_assignment_id": "asg_0001", "operator_assignment_id": "asg_0002", "placement_assignment_id": "asg_0003",
  "assignment_version": 3,                  // optimistic concurrency token
  "tenancy_source": "migration|admin_api|seed",
  "location_name": "Bean House Café"        // denormalised for display
}
```

- Scope: `operator_org_id` (primary), `owner_org_id` (limited).
- Rules read: `isActiveMember(resource.data.operator_org_id) || isActiveMember(resource.data.owner_org_id) || isPlatformAdmin()`.
  Legacy docs with no tenant fields are readable **only** by platform admins.
- Client writes: `display_name`, `status` (admin+ of operator org) — field‑whitelisted; **all
  tenancy fields and backend‑denormalised fields (`health_*`, `topology_*`, `desired_theme`…) are
  immutable from clients** (`request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`).
- Queries: `machines where operator_org_id == org` (single‑field, auto‑indexed);
  `machines where owner_org_id == org`. Both satisfy the rule by construction (query‑based rules
  require the filter to match the rule predicate — the dashboard must never issue an unfiltered
  `machines` list).
- `machines/{id}/inventory/{slot}` and `planogramSlots/{slot}`: rules derive tenant from the parent
  (`get(/machines/$(machineId)).data.operator_org_id`). Read: operator members, platform admin,
  **plus `allow read: if true` retained while the Kiosk app depends on it (decision D5)**. Write
  (`inventory.edit`): operator+ of operator org; validated fields `qty` (int ≥ 0), `price_cents`
  (int ≥ 0), `enabled` (bool), `name` (string ≤ 120), `capacity`; `slot_id` immutable.
- `machines/{id}/topologyAudit`: read operator members; unchanged backend writes.

### 5.7 `machine_assignments/{assignmentId}`

> **[Revised 2026‑10‑18]** kinds are renamed `ownership | operation | placement` (avoids collision
> with member roles), `terms` is removed (future `agreements` collection), `host_org_id_at_change`
> is added, and **client reads are denied** — history is served by `GET /machines/{id}/assignments`
> because rules cannot prove multi‑party membership on list queries. See 01 §4 and §6.1.

```json
{
  "schema_version": 1, "assignment_id": "asg_0002",
  "machine_id": "mach_ns_01", "kind": "operator",   // owner | operator | placement
  "org_id": "org_northside",                         // for owner/operator
  "location_id": null,                               // for placement
  "status": "active",                                // active | ended
  "effective_from": "<server ts>", "effective_to": null,
  "supersedes_assignment_id": "asg_0001",
  "reason": "Transferred from Bayview", "created_by": "uid_platform_admin", "created_at": "<server ts>",
  "ended_by": null, "ended_at": null,
  "terms": { "commission_bps": 1500, "currency": "usd", "note": "15% to host" }   // optional metadata only
}
```

- Scope: orgs named on the row (`org_id`, or the location's host org, or the machine's owner org at
  that time — denormalised as `owner_org_id_at_change`, `operator_org_id_at_change`).
- Client writes: **none**. Backend: transactional writes only (§3.4).
- Queries: `where machine_id == X orderBy effective_from desc` (composite `machine_id, effective_from`);
  `where org_id == O and status == "active"` (composite); `where kind == "placement" and location_id == L` (composite).
- `terms` holds **metadata only** (commission basis points, currency, free‑text); no accounting.

### 5.8 `orders`, `checkout_sessions`, `vend_jobs` — additive fields stamped at creation

> **[Revised 2026‑10‑18]** replaced by a single immutable `attribution` object that also carries
> `host_org_id`, `location_id`, the three assignment IDs, `currency` and a `resolution` enum
> (`machine_current | unassigned | machine_missing | legacy_backfill | legacy_unknown`). Orders also
> gain `completed_at`. See 01 §4.3.

```json
{ "...existing...",
  "currency": "usd",
  "operator_org_id": "org_northside", "owner_org_id": "org_sellmate", "location_id": "loc_beanhouse_cafe",
  "operator_assignment_id": "asg_0002",
  "tenancy_resolution": "machine_current"    // machine_current | unassigned | legacy_backfill
}
```

- Scope: `operator_org_id`. Rules read: `isActiveMember(resource.data.operator_org_id) || isPlatformAdmin()`.
  Documents with `operator_org_id == null` (machine unassigned at sale time, or un‑backfilled legacy)
  are platform‑admin‑only; **never inferred**.
- Client writes: none (unchanged).
- Queries: `orders where operator_org_id == org and created_at >= T` → **composite index
  `(operator_org_id ASC, created_at ASC)`**; same for `vend_jobs`.
- `amount_cents` stays; `currency` is added for new docs (readers default missing to `usd`).

### 5.9 `audit_events/{eventId}`

```json
{ "schema_version": 1, "event_id": "aud_...", "org_id": "org_northside",
  "related_org_ids": ["org_sellmate","org_northside"], "event_type": "machine.operator_assigned",
  "actor": { "uid": "...", "kind": "user|platform_admin|system|seed" },
  "target": { "type": "machine", "id": "mach_ns_01" },
  "details": { "from_org_id": "org_bayview", "to_org_id": "org_northside", "assignment_id": "asg_0002" },
  "created_at": "<server ts>", "request_id": "..." }
```

- Scope: `org_id` (owner/admin) and `related_org_ids` (array‑contains query). Client writes:
  **never**. Backend only. Query: `where related_org_ids array_contains org orderBy created_at desc`
  → composite index.

### 5.10 `machine_credentials/{machineId}` (Milestone 4)

```json
{ "schema_version": 1, "machine_id": "...", "token_sha256": "...", "status": "active",
  "issued_at": "...", "issued_by": "...", "rotated_from": null }
```

- No client access. Backend verifies `sha256(X-Machine-Token)` and binds to the path `machine_id`.
  Legacy `MACHINE_SHARED_TOKEN` keeps working while the env var is set (compat window).

### 5.11 Rules structure (deny‑by‑default)

- Replace the live file with a versioned `firestore.rules` whose **first review unit is a
  byte‑for‑byte reproduction of the live rules** plus emulator tests proving current behaviour, so
  later tightening is a reviewable diff.
- Helpers: `signedIn()`, `isPlatformAdmin()`, `isActiveMember(orgId)`, `roleIn(orgId, list)`,
  `onlyKeys(list)`, `unchanged(list)`.
- Remove the blanket `match /machines/{machineId}` read and the unused `commands`/`activity`
  matches once the dashboard is authenticated (decision D5 governs `inventory`/`planogramSlots`).
- No `{document=**}` grants anywhere except the final `deny`. Collection‑group rule for `members`
  is explicit: `match /{path=**}/members/{uid} { allow read: if request.auth.uid == uid || … }` and
  tested with the exact dashboard query.
- Rules tests (`@firebase/rules-unit-testing`, Node) live in `sellmate-dashboard/firebase/tests/`
  and are distinct from backend tests (`SellMateCloud/tests/test_authz_*.py`).

### 5.12 Indexes (`firestore.indexes.json`)

| Collection | Fields | Why |
|---|---|---|
| `orders` | `operator_org_id ASC, created_at ASC` | dashboard sales ranges |
| `vend_jobs` | `operator_org_id ASC, created_at ASC` | failures today |
| `machine_assignments` | `machine_id ASC, effective_from DESC`; `org_id ASC, status ASC`; `kind ASC, location_id ASC, status ASC` | history, active lists |
| `audit_events` | `related_org_ids CONTAINS, created_at DESC` | audit page |
| `members` (collection group) | `uid ASC` (+ `uid ASC, status ASC`) | "my organizations" |

Index deployment to production is a **separate approved step**; locally the emulator needs none.

---

## 6. Backend changes (SellMateCloud) — design only

- **Dependency decision (D2):** add `firebase-admin` to verify Firebase ID tokens (handles the
  Auth emulator automatically via `FIREBASE_AUTH_EMULATOR_HOST`). It wraps the already‑present
  `google-cloud-firestore`, so `db` can stay as is. Alternative without a new dependency:
  `google.oauth2.id_token.verify_firebase_token` — but it rejects the emulator's unsigned tokens,
  forcing a hand‑rolled emulator bypass that I would rather not write.
- New module `authz.py`: `resolve_user_principal(authorization)` → `{uid, platform_admin}`;
  `require_org_role(uid, org_id, capability)` reading `organizations/{org}/members/{uid}` and
  `platform_admins/{uid}`; raises 403 with a stable error code. Capabilities loaded from
  `authz/capabilities.json`.
- New routes (all `Authorization: Bearer <Firebase ID token>`):
  `GET /me` (memberships + platform flag), `GET/PATCH /orgs/{org}`,
  `GET/POST/PATCH/DELETE /orgs/{org}/members/{uid}`, `POST /machines/{id}/assignments`
  (owner/operator/placement, with `expected_assignment_version`), `POST /machines` (register),
  `GET /machines/{id}/assignments`, `POST /platform/orgs`, `POST /platform/legacy_mapping/apply`
  (M5). Every mutation writes `audit_events` in the same transaction/batch.
- `POST /orders` (`main.py:550`): after `get_machine`, copy tenancy fields onto both docs; no
  behavioural change otherwise. Webhook → `create_or_get_vend_job` copies the same from the order.
- Commissioning: `resolve_topology_principal` gains a third branch — Firebase ID token → role from
  membership of the machine's `operator_org_id` (mapped to FEATURE‑013 role names) — while the
  operator‑token path keeps working until you retire it (D6).
- Environment: `SELLMATE_ENV=production|emulator`. In `emulator`, startup **fails** unless
  `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are set and `GOOGLE_CLOUD_PROJECT`
  starts with `demo-`; in `production` it fails if either emulator var is set. Payments:
  `PAYMENTS_PROVIDER=stripe|fake`; `fake` refuses to load unless `SELLMATE_ENV=emulator` (D8).

---

## 7. Compatibility and migration approach

### 7.1 Exact contracts existing clients depend on (must not change)

| Client | Contract | Source |
|---|---|---|
| sellmate‑pi poller | `GET /vend_jobs/claim?machine_id&wait_seconds=0` (no auth); `POST /vend_jobs/{id}/complete` body `{status, beam_verified, result, error?, motor_current_detected?, tof_detection?, evidence_classification?}`; consumes `vend_job_id|id, order_id, items[].slot_id, items[].qty` | `cloud_poller.py:96-115, 376-393` |
| sellmate‑pi health | `POST /machines/{id}/health` + `X-Machine-Token`; payload in §1.6 / audit | `health_reporter.py:293-337` |
| sellmate‑pi topology | `X-Machine-Token` **and** `Authorization: Bearer` on topology/commissioning routes | `topology_cloud.py:42-53` |
| pi‑touchscreen | `POST /orders {machine_id, items[{slot_id,qty}], amount_cents}`, `start_payment`, `GET /orders/{id}`, `cancel {reason, cancel_mode?}`; theme routes with `X-Machine-Token`; **Firestore reads via service account** of `machines/{id}/planogramSlots` and `inventory` | `cloud_client.py`, `inventory_client.py:137-148` |
| SellMateKioskApp | same order endpoints; **anonymous Firestore reads** of the same two subcollections; `machine_001` | `FirestorePlanogramService.kt:20-36`, `MainActivity.kt:32-33` |
| Theme Studio | `POST /machines/{id}/theme/publish_apply`, `GET /machines/{id}/theme` with `X-Operator-Token` | `applyTheme.ts:84-125` |
| Dashboard (current) | anonymous reads of `machines`, `orders`, `vend_jobs`, `machines/{id}/inventory`, `topologyAudit`; operator token + role header for commissioning | `app/page.tsx`, `lib/commissioning/client.ts` |

### 7.2 Additive strategy

1. **No collection moves, no renamed fields, no removed endpoints.** Only new fields, new
   collections, new routes, new optional headers.
2. **Existing machines without tenant metadata** keep working: backend endpoints never require
   tenancy fields; orders from such machines are stamped `operator_org_id: null,
   tenancy_resolution: "unassigned"` and surface only in the platform‑admin "Unassigned" view.
   Assigning them is an explicit, audited action (manual in the dashboard, or via the approved
   legacy mapping manifest in M5).
3. **Older machine clients**: untouched. Per‑machine credentials are optional until you flip
   `REQUIRE_MACHINE_AUTH_FOR_VEND=1` after every Pi has been updated (not in this project's scope
   unless approved — I cannot update Pis).
4. **Delayed/retried events**: tenancy is read from the **order** (stamped at creation), not from
   the machine's current state, so a webhook that arrives after a transfer still attributes to the
   operator at order time. Claim/complete only touch `vend_jobs` fields and never tenancy fields.
5. **Offline machines during transition**: nothing to do; they read nothing tenant‑related.
6. **Existing transactions/inventory**: left as is until the approved backfill (M5). Until then they
   are platform‑admin‑only in the dashboard (deny‑by‑default), which is the safe failure mode.
7. **Service accounts / Admin SDK**: the touchscreen's reader SA and Cloud Run's SA bypass rules
   today and will continue to; no change. Backend tenant checks are explicit code with their own
   tests.
8. **Old and new app versions concurrently**: old dashboard builds will start getting
   `permission-denied` once rules tighten — this is intended; the rollout order (§7.4) upgrades the
   dashboard first.
9. **No dual writes.** The only "denormalisation" is tenancy fields copied at creation, written in
   the same `set()` as the document itself.

### 7.3 Rules‑tightening schedule

| Step | Change | Precondition |
|---|---|---|
| R0 | Check in exact live rules + tests | none (no behaviour change) |
| R1 | Add new collections (orgs, members, users, platform_admins, locations, assignments, audit) — deny‑by‑default with explicit grants | dashboard auth deployed |
| R2 | Replace public read of `machines`, `orders`, `vend_jobs`, `checkout_sessions`, `stripe_event_receipts`, `topologyAudit` with membership checks | new dashboard deployed and verified |
| R3 | Replace public read of `machines/{id}/inventory` and `planogramSlots` | **Kiosk app retired or given auth** (D5) |
| R4 | Drop unused `commands`/`activity` matches | confirm no client (I found none) |

### 7.4 Migration plan (tooling built only after M5 approval)

Inputs you provide: a **legacy mapping manifest** (`migration/legacy_mapping.json`) listing each
production `machine_id` → `owner_org_id`, `operator_org_id`, `location_id`, and the effective date
of operation (default = machine `created_at` or first order), reviewed by you.

Steps, each a separate command with `--dry-run` default and `--execute` explicit:

1. `inventory`: read‑only report of machines, orders, vend_jobs, checkout_sessions counts; lists
   machine IDs missing from the manifest and orders whose `machine_id` has no machine doc
   (**ambiguous → reported, never guessed**).
2. `apply-machines`: write tenancy fields + initial `machine_assignments` rows (`tenancy_source:
   "migration"`) + audit events; batches of ≤200; progress file; idempotent (skips docs already at
   `tenancy_schema_version ≥ 1` with matching values; reports conflicts).
3. `backfill-commerce`: stamp `operator_org_id` etc. on historical orders/vend_jobs/checkout
   sessions using the assignment history (`effective_from`/`effective_to` vs `created_at`);
   `tenancy_resolution: "legacy_backfill"`; same batching/resume; validation pass before and after
   each batch (counts, spot checks).
4. `verify`: recomputes per‑org totals from Firestore and prints them for comparison with the
   dashboard.

Target checks: refuses to run unless `--project` matches the env project **and** the operator types
the project ID; emulator run requires `demo-` project; production run requires an export/backup
reference (`gcloud firestore export` URI) recorded in the run log before `--execute`.

### 7.5 Rollback

| Layer | Rollback | Notes |
|---|---|---|
| Dashboard code | redeploy previous build | old build needs public‑read rules → only safe before R2 |
| Backend code | redeploy previous Cloud Run revision | new fields on docs are ignored by old code (additive) |
| Rules | redeploy previous `firestore.rules` from git | **never** redeploy the public‑read rules just to make an old client work; fix the client instead |
| Indexes | leave in place | harmless |
| Config/flags | unset `SELLMATE_ENV`, `PAYMENTS_PROVIDER`, `REQUIRE_MACHINE_AUTH_FOR_VEND` | a flag is not a data rollback |
| Data (M5) | `revert` command removes only fields written by the migration (tracked by `tenancy_source`/`tenancy_resolution`) and deletes migration‑created assignment/audit rows by `created_by: "migration:<run_id>"` | Records written **after** rollout by the new backend are tagged `tenancy_source: "admin_api"` and are **not** reverted automatically; the revert reports them for a decision |
| Irreversible | deleting legacy public‑read rules (R2/R3) after old clients are gone; retiring `MACHINE_SHARED_TOKEN` | postponed until you approve explicitly |

---

## 8. Local development and fixture plan

### 8.1 Where it lives (decision D1)

> **[Revised 2026‑10‑18]** still hosted by `sellmate-dashboard/`, but under `firebase/`, `dev/`
> and `packages/schemas/` with the exact future monorepo paths and no imports from the dashboard
> app, so they move with `git mv`. Commands become `make` targets and an emulator‑only Dev Console
> page is added. See 01 §8 and 02 §5.1.

Recommended: `sellmate-dashboard/` hosts `firebase.json`, `firestore.rules`,
`firestore.indexes.json`, `firebase/seed/`, `firebase/tests/` and the `npm run` commands, because it
already has Node tooling, is the only Firebase web client, and rules tests are Node‑based. The
backend is started from `SellMateCloud/` with env vars. A `Makefile`‑style wrapper in the
dashboard (`npm run local:up`) starts emulators + backend + Next dev together via `concurrently`
(one new dev dependency) — or a plain shell script if you prefer zero new deps.

### 8.2 Prerequisites

- Node ≥ 20 (have 25.3), Firebase CLI (have 15.24), Python 3.11+ (have 3.14; backend Dockerfile is
  3.11 — `requirements.txt` should be checked against 3.14 locally, see D9),
  **Java 17/21 JDK — missing** (`brew install --cask temurin@21` or similar).
- No production credentials. No Stripe keys. No GCP login.

### 8.3 Environment (example `.env.local.example`, no secrets)

| Setting | Default | Change when |
|---|---|---|
| `NEXT_PUBLIC_SELLMATE_ENV` | `emulator` | `production` only in a production build; the emulator switch is compiled out when `production` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `demo-sellmate` | prod project in prod |
| `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` / `NEXT_PUBLIC_AUTH_EMULATOR_HOST` | `127.0.0.1:8080` / `127.0.0.1:9099` | port clashes (note: Firestore emulator default 8080 collides with the backend's 8080 → backend will default to `8081` locally) |
| `NEXT_PUBLIC_SELLMATE_CLOUD_URL` | `http://127.0.0.1:8081` | backend port |
| `NEXT_PUBLIC_SELLMATE_FIXED_NOW` | `2026-10-01T12:00:00Z` (emulator only) | to make "today" totals deterministic |
| Backend: `SELLMATE_ENV`, `GOOGLE_CLOUD_PROJECT=demo-sellmate`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `PAYMENTS_PROVIDER=fake`, `MACHINE_SHARED_TOKEN=local-shared-token`, `THEME_OPERATOR_TOKEN=local-operator-token`, `PORT=8081` | | |

Fail‑fast: dashboard throws at startup if `NEXT_PUBLIC_SELLMATE_ENV=emulator` and an emulator host
is missing, or if `production` and project ID starts with `demo-`. Backend mirrors this (§6). The
dashboard header shows a persistent **"EMULATOR · demo-sellmate"** badge; the emulator‑only
"Dev tools" area is behind the same compile‑time check.

### 8.4 Commands (proposed)

| Action | Command |
|---|---|
| Start everything | `npm run local:up` (emulators with import of `firebase/seed/export/` if present, backend, Next dev) |
| Seed | `npm run seed` (idempotent: deterministic IDs, `set()` with full documents; verifies emulator target) |
| Reset | `npm run reset` (deletes all emulator data via the emulator REST endpoint — refuses unless `FIRESTORE_EMULATOR_HOST` set and project starts with `demo-`) then seeds |
| Tests | `npm test` (unit), `npm run test:rules` (emulator rules), `cd SellMateCloud && python3 -m unittest discover -s tests -v` (backend incl. authz) |
| Simulated machine | `python3 scripts/simulate_machine.py --machine mach_ns_01 --scenario heartbeat|vend|health-attention` (in `SellMateCloud/scripts/` — reuses the Pi payload shapes from `sellmate-pi/tests`) |
| Stop | `npm run local:down` |

### 8.5 Deterministic fixtures (`firebase/seed/fixtures/*.json`, editable)

Reference time `2026-10-01T12:00:00Z`. All IDs stable.

| Entity | IDs | Notes |
|---|---|---|
| Organizations | `org_sellmate` (platform), `org_northside`, `org_bayview` (operators), `org_beanhouse`, `org_gymco` (hosts) | |
| Users (emulator Auth, password `password123`) | `uid_sam_platform` (platform admin, also owner of org_sellmate); `uid_nina_owner` (owner @northside); `uid_dana_admin` (admin @northside); `uid_theo_operator` (operator @northside); `uid_vera_viewer` (viewer @northside); `uid_bo_dual` (**admin @bayview, viewer @northside**); `uid_omar_owner` (owner @bayview); `uid_rex_revoked` (revoked admin @northside); `uid_nobody` (no memberships) | emails `<name>@sellmate.test` |
| Locations | `loc_beanhouse_cafe` (host org_beanhouse), `loc_gymco_lobby` (host org_gymco) | |
| Machines | `mach_ns_01` (owner+operator northside, placed beanhouse, healthy, well stocked); `mach_ns_02` (northside, gymco, attention/low stock); `mach_bv_01` (bayview, unplaced, offline, empty slots); `mach_sm_01` (**owned by org_sellmate, operated by bayview**, placed gymco); `mach_transfer_01` (owned sellmate; **operator bayview until 2026‑09‑15, northside after**); `mach_unassigned_01` (owned sellmate, no operator, no placement); `machine_001` (**legacy**: no tenancy fields, mimics production doc) | each with `inventory` + `planogramSlots` (S01–S06) |
| Assignments | `asg_*` rows incl. ended `operator` row for `mach_transfer_01` (bayview, 2026‑06‑01 → 2026‑09‑15) and active row (northside from 2026‑09‑15) | |
| Orders | On the reference day: 10 for `mach_ns_01` (**$184.00**), 4 for `mach_ns_02` ($72.00), 3 for `mach_bv_01` ($54.00), 2 for `mach_sm_01` ($36.00), 2 for `mach_transfer_01` stamped northside ($38.00). Historical: 3 for `mach_transfer_01` on 2026‑08‑20 stamped bayview ($45.00). Legacy: 2 orders for `machine_001` with no tenancy fields | Expected "today" totals: northside **$294.00** (184+72+38), bayview **$90.00** (54+36); bayview "month"/history view additionally shows the $45.00 pre‑transfer sales. Exact per‑range values fixed in `expected_totals.json` and asserted by a seed test |
| Vend jobs | one FAILED today for `mach_ns_02` | "Vend failures today" = 1 for northside |
| Audit events | creation + the transfer | |

How to change: edit the JSON, run `npm run reset`; the seed validates the manifest (unknown org,
duplicate active assignment, order referencing a missing machine → fails before writing).

---

## 9. Dashboard plan (extend, don't replace)

- Add `firebase/auth` sign‑in (email/password in emulator; provider for production is D7).
- New shell: `AuthGate` → `OrgSwitcher` (memberships from the collection‑group query) → tenant
  subtree keyed by `activeOrgId`. Existing pages become `/orgs/[orgId]/...`? **No** — keep current
  URLs and read `activeOrgId` from context to minimise churn; `machines/[machineId]` verifies the
  machine belongs to the active org (otherwise forbidden state).
- Pages/areas: Overview (tenant‑filtered version of today's `/`), Machines, Machine detail
  (+ relationships + history + audit), Members, Organization settings, Platform (admin only),
  **Dev tools (emulator only)**: scenario selector, generate sample sale/health, reset, effective
  permissions, expected‑vs‑actual totals.
- States: loading, empty ("No machines in Northside yet"), forbidden ("You don't have access to
  this machine in the selected organization"), stale‑membership banner.
- Replace the commissioning role dropdown with the membership role; keep operator‑token transport
  for the local‑Wi‑Fi path (Pi LAN) unchanged.

---

## 10. Proposed implementation slices and acceptance criteria

> **[Superseded 2026‑10‑18]** by [03‑implementation‑roadmap.md](03-implementation-roadmap.md),
> which separates security (S‑P0…P5), local/multi‑tenant (L1, T1–T4), monorepo (R1), inventory
> (I1) and migration (M1–M2) and adds per‑milestone rollback and approval checkpoints. The unit
> contents below remain accurate as detail for L1/T1.

Each slice is a proposed review unit (uncommitted until you say otherwise).

### Milestone 1 — Local demonstration foundation

| Unit | Repo | Content | Acceptance |
|---|---|---|---|
| 1.1 | dashboard | `firebase.json`, `.firebaserc` (`demo-sellmate`), `firestore.rules` = **exact live rules**, `firestore.indexes.json` (empty), `firebase/tests/rules.current.test.ts` | `npm run test:rules` proves anonymous read allowed on today's collections and denied elsewhere (documents current behaviour) |
| 1.2 | dashboard | Env model + fail‑fast + emulator wiring in `lib/firebase.ts`; env badge; `.env.local.example` | Starting with `production` + `demo-` project throws; badge visible |
| 1.3 | dashboard | Seed/reset scripts + fixtures + `expected_totals.json` + manifest validation; emulator‑target guard | `npm run reset && npm run seed` twice → identical document counts/hashes; guard refuses when `FIRESTORE_EMULATOR_HOST` unset |
| 1.4 | dashboard | Emulator Auth personas created by seed; sign‑in page; "who am I" panel showing uid, memberships (read via collection group), platform flag | Sign in as each persona; `uid_nobody` sees empty state; `uid_rex_revoked` sees revoked notice |
| 1.5 | backend | `SELLMATE_ENV` + emulator guard; `run_local.sh`; `GET /me` with ID‑token verification (emulator) | `python3 -m unittest` green; curl with emulator token returns memberships; without token → 401 |
| 1.6 | dashboard | `npm run local:up/down` | one command brings everything up; documented |

### Milestone 2 — First tenant‑isolated vertical slice

| Unit | Content | Acceptance |
|---|---|---|
| 2.1 | Rules R1+R2 for `organizations`, `members`, `users`, `platform_admins`, `machines` (read), `orders`/`vend_jobs` (read) with tests for every case listed in your §5 (unauth, member A reads A, A reads B, guessed IDs, forged tenant on create, tenant change on update, self‑promotion, revoked, viewer write, dashboard queries, platform admin) | `npm run test:rules` green with ≥ 1 test per case; unfiltered `machines` list denied |
| 2.2 | Dashboard org switcher + tenant‑filtered Overview + Machines; forbidden/empty states; state reset on switch | `uid_bo_dual` switches bayview↔northside with no stale rows; totals match `expected_totals.json` |
| 2.3 | Backend `authz.py` + tests (`test_authz_*`) for member/non‑member/revoked/platform; `POST /orders` stamps tenancy from machine doc; legacy `machine_001` → `unassigned` | backend tests prove a request for org B with org A token → 403 |
| 2.4 | Legacy evidence: fixture payloads from `sellmate-pi/tests` and `pi-touchscreen` replayed against local backend (health, claim/complete with fake payments, orders) | all legacy payloads accepted unchanged |

### Milestone 3 — Membership and machine relationships

Backend member CRUD + assignment transaction + audit; dashboard Members, Machine relationships,
History, Audit pages; concurrency test (two concurrent transfers → one 409); self‑edit denied;
admin cannot grant owner.

### Milestone 4 — Remaining tenant‑scoped integrations

Inventory/planogram edits via rules (field‑validated), health/sales views tenant‑filtered,
simulated machine script, per‑machine credentials (optional, flag‑gated), commissioning principal
from ID token, historical‑attribution tests (orders before/after transfer on `mach_transfer_01`).

### Milestone 5 — Migration and rollout readiness

Tooling in §7.4, dry runs against emulator seeded with a production‑shaped legacy dataset, rollback
rehearsal including post‑rollout records, rollout sequence document. **No production execution.**

---

## 11. Decisions requiring your input

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| D1 | Where Firebase config/rules/seed live | `sellmate-dashboard/` | Determines repo for review units 1.x |
| D2 | Add `firebase-admin` to SellMateCloud | Yes | ID‑token verification incl. emulator; otherwise hand‑rolled bypass |
| D3 | Tenant‑admin mutations via FastAPI backend (not Next.js server routes) | FastAPI | Keeps one backend, one deployment pattern |
| D4 | Schema option B (additive fields, keep paths) | B | No device changes; see §3.1 |
| D5 | Is **SellMateKioskApp** still deployed on any machine? | If **no**: retire and tighten `inventory`/`planogramSlots` reads in R3. If **yes**: keep public read of those two subcollections until it gets auth | Only client relying on anonymous Firestore reads |
| D6 | Keep `X-Operator-Token` + `X-SellMate-Role` path alive during transition | Yes, until dashboard commissioning uses ID tokens; then remove in a separate approved step | Theme Studio still uses the operator token |
| D7 | Production sign‑in provider | Google sign‑in (you control allowed accounts via membership docs) — email/password in emulator only | Affects Firebase Auth console config (your action) |
| D8 | `PAYMENTS_PROVIDER=fake` adapter for local complete flow | Yes, guarded to emulator | Touches payment code path (`complete_vend_job`) — needs your explicit OK |
| D9 | Local Python: run backend under 3.14 or pin a 3.11 venv | Try 3.14; fall back to `uv`/pyenv 3.11 | Dockerfile is 3.11 |
| D10 | Owner‑org visibility of sales | ~~**No** by default~~ **[Revised 2026‑10‑18]** owner and host get scoped revenue summaries via `GET /finance/summary` (01 §5); operator alone sees transactions | Needed for rental/commission/revenue‑share arrangements |
| D11 | Four roles (`owner/admin/operator/viewer`) + platform admin; host access deferred | Accept | Matrix in §4 |
| D12 | Future‑dated assignments | Not supported | Simplicity |
| D13 | `concurrently` dev dependency for one‑command startup, or shell script | `concurrently` | Minor |
| D14 | Per‑machine credentials and `REQUIRE_MACHINE_AUTH_FOR_VEND` | **[Moved 2026‑10‑18]** to the security remediation plan (S‑02/S‑04): phased `VEND_AUTH_MODE=off\|log\|require` with telemetry gates, Pi poller header change, and retirement tests | Compatibility |
| D15 | Firebase Authentication enabled in `sellmate-bdd22`? Which providers? | You check the console | Needed before any production rollout, not for local work |

---

## 12. Unanswered questions / things I could not verify

- Production machine count, which machine IDs exist, and whether any `orders` reference machines
  without a `machines` doc. [?]
- Whether the Cloud Run service account and the Pi reader service account are distinct and what
  roles they hold. [?]
- Whether the Android Kiosk app is still in service (D5). [?]
- Which Firebase Auth providers are enabled. [?]
- Whether `requirements.txt` installs cleanly on Python 3.14 (not attempted — would create a venv;
  harmless but I kept Milestone 0 read‑only). [?]
- Physical vend, Stripe Terminal capture, and real Pi behaviour remain **untestable locally** and
  will be reported as simulated in every milestone.

---

## 13. Draft manual test checklist (to be finalised with Milestone 1 fixtures)

Numbered steps will reference the fixture IDs in §8.5; expected results are from
`expected_totals.json`. Skeleton:

1. Start: `npm run local:up` → emulator UI at `localhost:4000`, dashboard at `localhost:3000` shows
   **EMULATOR · demo-sellmate** badge; no production env vars required.
2. Reset+seed twice → emulator UI shows identical counts (orgs 5, users 9, machines 7, assignments
   N, orders 26).
3. Edit `fixtures/machines.json` (`mach_ns_01.display_name`), reseed → new name shown.
4. Sign in `nina@sellmate.test` → org Northside, role **Owner**; Machines shows exactly
   `mach_ns_01`, `mach_ns_02`, `mach_transfer_01`; revenue today **$294.00**; vend failures **1**.
5. Same session: open `/machines/mach_bv_01` → **forbidden** state; emulator rules test proves the
   read is denied, not just hidden.
6. Sign in `bo@sellmate.test` → switch Bayview → Northside → Bayview: lists change with no stale
   rows; role badge Admin ↔ Viewer.
7. Sign in `vera@sellmate.test` (viewer) → inventory edit controls hidden **and** direct Firestore
   write from the Dev tools "try forbidden write" button → `permission-denied`.
8. Sign in `nobody@sellmate.test` → "You are not a member of any organization" state.
9. Sign in `rex@sellmate.test` → revoked notice; direct read of Northside machine denied.
10. As `dana` (admin) attempt to change own role via Dev tools direct write → denied; via API → 403
    with audit of the attempt (M3).
11. `mach_sm_01`: Sam (platform) sees owner=SellMate, operator=Bayview, host=GymCo; Bayview admin
    sees inventory & sales; SellMate owner view shows no sales.
12. `mach_transfer_01`: Northside sees only the 2 post‑transfer orders ($38.00); Bayview sees the 3
    pre‑transfer orders ($45.00) and no current inventory.
13. Two concurrent transfers (Dev tools "race" button / script) → exactly one succeeds, one 409; one
    active operator row (M3).
14. `python3 scripts/simulate_machine.py --machine mach_ns_01 --scenario heartbeat` → health badge
    updates; same script with `--machine mach_bv_01 --token <ns_01 token>` → 401 (M4).
15. Legacy payload replay (health, claim/complete, order) → 200s; `machine_001` order lands in
    platform "Unassigned" (M2/M4).
16. Audit page lists the transfer with actor, before/after, server timestamp (M3).
17. `npm run reset` with `FIRESTORE_EMULATOR_HOST` unset → refuses (M1).
18. Migration dry run against seeded legacy data → report lists `machine_001` as unmapped; no writes
    (M5).
19. Rollback rehearsal → migration fields removed; post‑rollout `admin_api` records reported, not
    deleted (M5).
