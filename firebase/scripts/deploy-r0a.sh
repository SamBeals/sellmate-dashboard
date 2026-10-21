#!/bin/bash
# Deploy ONLY the proposed Firestore rules to sellmate-bdd22.
# Backs up the rules that are actually deployed, then deploys firestore:rules.
# Does not deploy indexes, documents, or any other Firebase product.
#
# Refuses to run unless:
#   CONFIRM_RULES_DEPLOY=sellmate-bdd22
set -euo pipefail

PROJECT="sellmate-bdd22"
DASHBOARD_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DASHBOARD_DIR"

if [ "${CONFIRM_RULES_DEPLOY:-}" != "$PROJECT" ]; then
  echo "Refusing to deploy. Pass CONFIRM_RULES_DEPLOY=${PROJECT} after approval." >&2
  exit 1
fi

if [ "${FIREBASE_PROJECT:-$PROJECT}" != "$PROJECT" ]; then
  echo "Refusing to deploy. FIREBASE_PROJECT must be ${PROJECT}." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="firebase/backups/firestore.rules.${STAMP}"
mkdir -p firebase/backups

python3 firebase/scripts/fetch_live_rules.py "$BACKUP"
python3 firebase/scripts/check_live_rules.py "$BACKUP"

echo "Backed up the currently deployed rules to ${BACKUP}"
echo "Deploying firestore:rules only to ${PROJECT}"

firebase deploy \
  --only firestore:rules \
  --project "$PROJECT" \
  --config firebase/firebase.r0a.json

echo "Deployed. Rollback file: ${BACKUP}"
