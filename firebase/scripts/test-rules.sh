#!/bin/bash
# Run the Firestore rules suite against the local emulator only.
# Refuses the production project id. Does not deploy anything.
set -euo pipefail

DASHBOARD_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DASHBOARD_DIR"

if [ "${GCLOUD_PROJECT:-}" = "sellmate-bdd22" ] || [ "${FIREBASE_PROJECT:-}" = "sellmate-bdd22" ]; then
  echo "Refusing to run rules tests with project sellmate-bdd22." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$DASHBOARD_DIR/firebase/scripts/setup-emulator-jdk.sh"
echo "Using Java $($JAVA_HOME/bin/java -version 2>&1 | head -1)"

exec firebase emulators:exec \
  --config firebase/firebase.json \
  --project demo-sellmate \
  --only firestore \
  "tsx --test firebase/tests/rules.test.ts"
