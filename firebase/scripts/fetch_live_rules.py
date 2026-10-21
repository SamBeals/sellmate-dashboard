#!/usr/bin/env python3
"""Write the currently deployed Firestore rules for sellmate-bdd22 to a file.

Uses the Firebase Rules API. Does not deploy or modify rules.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = "sellmate-bdd22"


def token() -> str:
    # Firebase CLI credentials, the same account `firebase deploy` uses.
    # A plain gcloud token is not granted the Rules API on this project.
    firebase_bin = shutil.which("firebase")
    if not firebase_bin:
        raise SystemExit("firebase CLI is not installed")
    lib_dir = Path(firebase_bin).resolve().parents[1]
    script = f"""
const auth = require({json.dumps(str(lib_dir / "auth.js"))});
const {{ getAccessToken }} = require({json.dumps(str(lib_dir / "apiv2.js"))});
const account = auth.getGlobalDefaultAccount();
if (!account) {{
  process.stderr.write("firebase CLI is not logged in");
  process.exit(1);
}}
auth.setActiveAccount({{}}, account);
getAccessToken()
  .then((token) => process.stdout.write(token))
  .catch((error) => {{
    process.stderr.write((error && error.message) || "firebase auth failed");
    process.exit(1);
  }});
"""
    result = subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        detail = (result.stderr or "").strip() or "firebase CLI is not logged in"
        raise SystemExit(f"Failed to get a Firebase CLI token: {detail}")
    return result.stdout.strip()


def get_json(url: str, auth: str) -> dict:
    # curl uses the system certificate store. The Python.org 3.14 install on
    # this Mac does not, so urllib fails verification before any request is sent.
    # The bearer token stays in a config file so a curl failure cannot print it.
    config = Path("/tmp") / f"sellmate-rules-fetch-{os.getpid()}.curl"
    try:
        config.write_text(f'header = "Authorization: Bearer {auth}"\n')
        config.chmod(0o600)
        result = subprocess.run(
            ["curl", "-fsS", "--config", str(config), url],
            capture_output=True,
            text=True,
        )
    finally:
        config.unlink(missing_ok=True)
    if result.returncode != 0:
        detail = (result.stderr or "").strip() or f"curl exited {result.returncode}"
        raise SystemExit(f"Failed to read live Firestore rules: {detail}")
    return json.loads(result.stdout)


def live_rules_text(auth: str) -> str:
    releases = get_json(
        f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases",
        auth,
    )
    firestore = [
        release
        for release in releases.get("releases", [])
        if "cloud.firestore" in release.get("name", "")
    ]
    if not firestore:
        raise SystemExit(f"No Firestore rules release found for {PROJECT}")
    firestore.sort(key=lambda release: release.get("createTime", ""))
    latest = firestore[-1]
    ruleset = latest["rulesetName"]
    document = get_json(f"https://firebaserules.googleapis.com/v1/{ruleset}", auth)
    files = document.get("source", {}).get("files", [])
    if not files or "content" not in files[0]:
        raise SystemExit(f"Ruleset {ruleset} has no source")
    return files[0]["content"]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: fetch_live_rules.py OUTPUT_FILE", file=sys.stderr)
        return 2
    destination = Path(sys.argv[1])
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = live_rules_text(token())
    if not text.endswith("\n"):
        text += "\n"
    destination.write_text(text)
    print(f"Wrote live Firestore rules for {PROJECT} to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
