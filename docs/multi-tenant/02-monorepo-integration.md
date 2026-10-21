# Monorepo Integration Recommendations

Status: **PLANNING.** The monorepo does not exist and is not created by this task. This document
fixes the decisions that can be made now so that the multi-tenant and security work lands in
monorepo-shaped locations and moves with `git mv`.

## 1. Target layout (provisional, refined against the code found)

```text
sellmate/
├── apps/
│   ├── cloud/            ← SellMateCloud (FastAPI, Cloud Run). Own Dockerfile, requirements.txt.
│   ├── dashboard/        ← sellmate-dashboard (Next.js). Own package.json.
│   ├── machine/
│   │   ├── controller/   ← sellmate-pi (poller, health, vend-api, systemd units)
│   │   └── kiosk/        ← pi-touchscreen (Qt Quick customer UI)
│   └── theme-studio/     ← sellmate-theme-studio (Vite)
├── packages/
│   ├── python/
│   │   └── sellmate_contracts/   payload models shared by cloud + machine apps (health report,
│   │                             vend complete, catalog snapshot); schema validation helpers
│   ├── typescript/
│   │   └── contracts/            types generated/hand-mirrored from schemas; capability helpers
│   │                             used by dashboard and theme-studio
│   └── schemas/                  AUTHORITATIVE JSON Schemas + capabilities.json (see §3)
├── firebase/
│   ├── firebase.json, .firebaserc (demo-sellmate, sellmate-bdd22)
│   ├── firestore.rules, firestore.indexes.json
│   └── tests/                    rules tests (Node, @firebase/rules-unit-testing)
├── dev/
│   ├── emulators/   fixtures/   seed/   simulator/   scenarios/
├── scripts/          consolidate.sh, release helpers, pi install helpers
├── docs/             ← this folder tree (multi-tenant/, architecture/) moves here verbatim
└── Makefile          up / down / seed / reset / test / sim / scenario / <app>-dev / <app>-build
```

Refinements versus the brief's sketch, based on what exists:

- `SellMateKioskApp` (Android) is **not** one of the five apps and should not be consolidated;
  archive it once D5 is answered. `MarketKioskDisplayApp` and the empty `SellMateDashboard/` are
  unrelated/junk and stay out.
- `apps/machine/` groups the two Pi apps because they share `/etc/sellmate/machine.env`
  (`MACHINE_ID`, `CLOUD_BASE`, `MACHINE_SHARED_TOKEN`) and a deploy target, but they remain
  separate processes with separate tests.
- Node workspaces: one root `package.json` with `workspaces: ["apps/dashboard", "apps/theme-studio",
  "packages/typescript/*", "firebase", "dev/seed"]` — npm workspaces, no new tool. Python: no
  monorepo tool; each Python app has its own `requirements.txt`, and `packages/python` is installed
  editable (`pip install -e packages/python`) or vendored into the Cloud Run image by a Docker build
  whose context is the repo root.

## 2. What lives in shared directories (multi-tenant and security infrastructure)

| Asset | Shared location | Consumers | Notes |
|---|---|---|---|
| Firestore rules, indexes, `firebase.json`, aliases | `firebase/` | dashboard (reads), backend tests (emulator), CI | single version-controlled source; deploy is a manual, approved command |
| Rules tests | `firebase/tests/` | CI | run with `make rules-test` |
| `capabilities.json` (permission matrix) | `packages/schemas/` | dashboard UI gating, backend `authz.py`, rules tests, Dev Console | **one copy** post-consolidation |
| Document schemas (`organization`, `membership`, `location`, `machine_assignment`, `attribution`, `audit_event`, `machine_credential`, `inventory_adjustment`) | `packages/schemas/*.schema.json` | seed validation, backend tests, dashboard fixture tests | JSON Schema draft 2020-12 |
| Device payload schemas (`health_report`, `vend_job_complete`, `catalog_snapshot`) | `packages/schemas/` | cloud + controller + kiosk tests | replaces fixtures duplicated across `sellmate-pi/tests` and `SellMateCloud/tests` |
| Theme package schema | `packages/schemas/theme_package.schema.json` | theme-studio (`src/theme/types.ts`, `parse.ts`), kiosk (`app/theme/schema.py`, `loader.py`), cloud (`theme_packages.py`) | currently duplicated TS/Python with cloud validating only the envelope [V]; unify **after** consolidation |
| Fixtures (`organizations.json`, `machines.json`, `orders.json`, `expected_totals.json`, …) | `dev/fixtures/` | seed, backend tests, dashboard tests, kiosk `INVENTORY_FIXTURE_PATH` | kiosk's existing `fixtures/inventory.json` becomes a symlink or generated file |
| Seed/reset scripts | `dev/seed/` | everyone | Admin SDK against emulator; refuses non-`demo-` projects |
| Machine simulator and fake webhook poster | `dev/simulator/` | backend tests, Dev Console, manual | Python; imports payload models from `packages/python` |
| Scenarios | `dev/scenarios/` | Dev Console, `make scenario`, integration tests | JSON sequences of simulator + API steps with expected outcomes |
| Env conventions (`SELLMATE_ENV`, `demo-sellmate`, ports 8080/8081/3000/4000/9099) | `dev/emulators/README.md` + `.env.example` files per app | all | documented once |

Application-specific authorization code stays in the app: `apps/cloud/authz.py` (enforcement),
`apps/dashboard/lib/authz/` (gating + `OrgContext`). Only the *vocabulary* (`capabilities.json`)
is shared.

## 3. Authoritative schemas: how sharing works without codegen

- JSON Schema files in `packages/schemas/` are the source of truth.
- Python consumers validate with `jsonschema` in tests (and optionally at runtime for admin
  endpoints). TypeScript consumers keep hand-written types in `packages/typescript/contracts` and a
  test that validates the fixtures against the schema with `ajv`. If drift becomes a problem, add
  `json-schema-to-typescript` later; do not start with codegen.
- Capability matrix: `capabilities.json` `{ "<capability>": { "org": [roles], "operation": [roles],
  "ownership": [roles], "host": [roles] } }`; `authz.py` and `lib/authz` both load it; rules tests
  iterate it to generate allow/deny cases.

## 4. Independence guarantees

- Each app keeps its own build/deploy entry point: `apps/cloud/Dockerfile` (build context repo
  root so `packages/python` is copied), `apps/dashboard` `next build` (Vercel/Hosting root
  directory setting = `apps/dashboard`), `apps/theme-studio` `vite build`, Pi apps installed from a
  release tarball or sparse checkout of `apps/machine/* packages/python`.
- CI runs per-app jobs with path filters (`apps/cloud/**`, `packages/python/**`, `packages/schemas/**`
  → cloud job, etc.). Shared changes fan out to every dependent job.
- `make <app>-dev` starts one app; `make up` starts all. No app imports another app.

## 5. Decisions by timing

### 5.1 Decide now (this document)

- Target layout above; app directory names; `apps/machine/{controller,kiosk}` naming.
- JSON Schema + `capabilities.json` in `packages/schemas/` are authoritative; no codegen initially.
- All new multi-tenant/security shared assets are created **inside `sellmate-dashboard/`** under
  `firebase/`, `dev/`, `packages/schemas/` with the exact future paths and **no imports from the
  dashboard app**. The dashboard is the interim host because it is the only repo with Node tooling
  for rules tests and the seed (M0 D1), not because the assets belong to it.
- Interim duplication allowed: **only** `capabilities.json` into `SellMateCloud/authz/` during T1,
  with the existing byte-identical sibling test from M0 §4. Nothing else is copied.
- Documentation lives in `sellmate-dashboard/docs/` until consolidation, then `sellmate/docs/`.

### 5.2 Do before consolidation

The approved sequence puts consolidation after the shadow-mode security deploy and before the
full local environment and the tenant schema. It has not been started.

- S0 (in the dashboard repo, as the interim host): versioned Firestore rules, emulator
  authorization tests, and the unused-collection source scan. This is the minimal regression net
  for the move. It is not the Dev Console or the persona fixtures.
- Security P1 (backend shadow mode) deployed from the current `SellMateCloud` repo, flags left on
  legacy behavior. The vend-completion redesign is documented and is not part of that deploy
  unless separately approved.
- Each repo: tests green with one documented command; add `.env.example`; tag `pre-monorepo`
  once those tests are green. Do not combine the move with a schema change, a rules deploy, or a
  payment-path edit.
- Answer D5 (Kiosk) before deleting `SellMateKioskApp`. Do not archive it until a device check
  says it is unused. Delete the empty `SellMateDashboard/` only as part of the move.
- Write `scripts/consolidate.sh` using `git subtree add --prefix=apps/cloud <remote> main` (or
  `git filter-repo` per repo for cleaner history); rehearse in a throwaway directory; verify
  `make up && make test` passes from the consolidated tree.
- Decide hosting for the dashboard build root (Vercel/Firebase Hosting "root directory") and the
  Cloud Run build (Cloud Build trigger with `apps/cloud/Dockerfile`, context `.`).

### 5.3 Do after the monorepo exists

- Move `firebase/`, `dev/`, `packages/schemas/`, `docs/` to the root (`git mv`); delete the
  `SellMateCloud/authz/capabilities.json` copy and its byte-identical test.
- Introduce `packages/python/sellmate_contracts` and point cloud + controller + kiosk tests at the
  shared payload fixtures; unify the theme schema.
- Root `Makefile`, npm workspaces, CI path filters.
- Then build the full local environment and multi-tenancy (T1–T4) in the consolidated tree.

## 6. Sequencing rule

Consolidation is a mechanical, behaviour-neutral change and must be the **only** thing happening
in its window: no schema changes, no rules deploys, no production backfills, no flag flips. The
recommended window is between T1 and T2 (see roadmap); the fallback is between T3 and the
migration project if T1 slips.
