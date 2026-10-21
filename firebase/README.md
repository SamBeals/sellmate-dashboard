# Firestore rules under test

Local rules tests only. This folder does not deploy to production.
The deployment procedure, which is not approved to run, is `R0A_DEPLOYMENT.md`.

| File | Meaning |
|---|---|
| `firestore.rules` | Today's public-read behavior (R0). |
| `proposals/firestore.r0a.rules` | Proposed lockdown of four unused client paths. Not deployed. |
| `firebase.r0a.json` | Points a future deploy at the proposal. Rules only. No indexes. |
| `firestore.indexes.json` | Empty composite-index list, matching production on 2026-10-18. |

`.firebaserc` points at `demo-sellmate` only.

From `sellmate-dashboard/`:

```bash
npm run test:rules:clients   # source scan, no Java
npm run test:rules           # emulator. Downloads a JRE once if Java is missing
```

`npm run test:rules` calls `firebase/scripts/setup-emulator-jdk.sh`. The Firestore
emulator requires Java 21 or newer. Java 17, which is what this Mac has installed,
is not used. If no Java 21 is on `PATH`, the script downloads Eclipse Temurin 21
into `firebase/.tools/jdk` once. That directory is gitignored and reused on the next run.

The test command refuses `sellmate-bdd22`. It starts the Firestore emulator with
`--project demo-sellmate` and `--only firestore`.

R0 was reconstructed from the rules recorded in the 2026-10-18 audit, including the
`rules_version = '2'` wrapper. It is not a byte-for-byte export from the console. The
tests check which reads and writes succeed. `topologyAudit` stays denied by the catch-all.
