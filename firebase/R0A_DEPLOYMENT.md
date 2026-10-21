# R0a deployment checklist

Status: **deployed to sellmate-bdd22 on 2026-10-19.** Rules only. Pre-deploy backup: `firebase/backups/firestore.rules.20261019T003655Z`.

The live rules of `sellmate-bdd22` were read on 2026-10-18 and saved at
`firebase/backups/firestore.rules.live-20261018`. They are the same nine public reads
plus the catch-all deny. The proposal removes exactly four of those reads. Comments in the
live file differ from `firebase/firestore.rules`; the `allow` lines do not.

The change removes client reads of four paths. It does not add tenant checks. It does not
change machines, orders, vend jobs, inventory, or planogram slots.

## Paths

| Path | After R0a |
|---|---|
| `checkout_sessions/{sessionId}` | client read denied (catch-all) |
| `stripe_event_receipts/{eventId}` | client read denied |
| `machines/{machineId}/commands/{commandId}` | client read denied |
| `machines/{machineId}/activity/{activityId}` | client read denied |

Backend writes use `google.cloud.firestore` in `SellMateCloud`, which does not evaluate
security rules. Those writes keep working.

## Diff against the production-equivalent rules

`firebase/firestore.rules` is R0. `firebase/proposals/firestore.r0a.rules` is the proposal.
The behavioral change is the deletion of four `allow read: if true` blocks. Comment text
also changes. Nothing else moves.

```diff
       match /planogramSlots/{slotId} {
         allow read: if true;
       }
-      match /commands/{commandId} {
-        allow read: if true;
-      }
-      match /activity/{activityId} {
-        allow read: if true;
-      }
     }

     match /orders/{orderId} {
@@
     match /vend_jobs/{vendJobId} {
       allow read: if true;
     }
-    match /stripe_event_receipts/{eventId} {
-      allow read: if true;
-    }
-    match /checkout_sessions/{sessionId} {
-      allow read: if true;
-    }
```

Full file diff: `diff -u firebase/firestore.rules firebase/proposals/firestore.r0a.rules`.

## Exact command, after approval

From `sellmate-dashboard/`:

```bash
CONFIRM_RULES_DEPLOY=sellmate-bdd22 bash firebase/scripts/deploy-r0a.sh
```

That runs only:

```bash
firebase deploy --only firestore:rules --project sellmate-bdd22 --config firebase/firebase.r0a.json
```

`--only firestore:rules` deploys rules and does not deploy indexes, documents, or other
Firebase products. Do not use `--only firestore` (that includes indexes) or a bare
`firebase deploy`.

`firebase.json` still points at the current public rules. The proposal is selected only by
`firebase.r0a.json`. The default `.firebaserc` is `demo-sellmate`, so a deploy without
`--project sellmate-bdd22` does not target production. The script refuses to run unless
`CONFIRM_RULES_DEPLOY=sellmate-bdd22`.

## Before the deploy

The deploy script does the backup itself. It writes
`firebase/backups/firestore.rules.<UTC timestamp>` from the Firebase Rules API, then refuses
to continue unless that file still has exactly nine `allow read: if true` lines and one
catch-all deny. A ruleset that has already changed will not be overwritten.

Also confirm `npm run test:rules` is green on the commit you deploy.

## Smoke tests after deploy

Use the client SDK with the public web key, not the Admin SDK.

- Dashboard overview still lists machines, orders, and vend jobs.
- A machine page still lists inventory.
- Anonymous `get` of `checkout_sessions/{any}` returns permission denied.
- Anonymous `get` of `stripe_event_receipts/{any}` returns permission denied.
- Anonymous `get` of `machines/{id}/commands/{id}` and `activity/{id}` returns permission denied.
- A real or simulated purchase still creates a checkout session and a Stripe receipt
  (backend), and the Pi can still claim and complete a vend. Rules do not apply to those
  server writes.

## Monitoring

For 24 hours after deploy, watch Cloud Run for new errors on order create, payment start,
webhook receipt write, claim, and complete. Those paths write `checkout_sessions` and
`stripe_event_receipts` through the Admin SDK. A rules regression would not show up there.
Watch the dashboard for permission errors on machines, orders, vend jobs, or inventory.
Those would mean the deploy was not limited to the four paths.

## Rollback

Redeploy the timestamped file the script wrote under `firebase/backups/`. That file is the
rules that were live at deploy time, including their original comments. A copy read on
2026-10-18 is already at `firebase/backups/firestore.rules.live-20261018`.

```bash
# firebase.r0a.json points at the proposal. For rollback, point a temporary config's
# firestore.rules at the backup file, then:
firebase deploy --only firestore:rules --project sellmate-bdd22 --config <backup-config>
```

Rollback does not restore or delete documents. This deploy does not write documents.
