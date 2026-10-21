#!/usr/bin/env python3
"""Fail if a SellMate client reads collections the R0a proposal would lock.

Backend Admin SDK writes are reported and do not fail the check: security rules
do not apply to them.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CLIENT_DIRS = [
    ROOT / "sellmate-dashboard" / "app",
    ROOT / "sellmate-dashboard" / "components",
    ROOT / "sellmate-dashboard" / "lib",
    ROOT / "SellMateKioskApp",
    ROOT / "pi-touchscreen",
    ROOT / "sellmate-pi",
    ROOT / "sellmate-theme-studio",
]
EXTENSIONS = {".py", ".kt", ".kts", ".ts", ".tsx", ".js", ".jsx", ".qml"}
SKIP_DIRS = {
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "__pycache__",
    ".gradle",
}
DOC_NAMES = ("checkout_sessions", "stripe_event_receipts")
SUBCOLLECTION = re.compile(
    r"""\.collection\(\s*['\"](?:commands|activity)['\"]"""
    r"""|collection\(\s*['\"](?:commands|activity)['\"]"""
)


def iter_files(directory: Path):
    if not directory.exists():
        print(f"MISSING {directory.relative_to(ROOT)}")
        return
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix in EXTENSIONS:
            yield path


def main() -> int:
    hits: list[str] = []
    scanned = 0
    for directory in CLIENT_DIRS:
        for path in iter_files(directory):
            scanned += 1
            text = path.read_text(encoding="utf-8", errors="replace")
            rel = path.relative_to(ROOT)
            for name in DOC_NAMES:
                if name in text:
                    hits.append(f"{rel}: contains {name}")
            if SUBCOLLECTION.search(text):
                hits.append(f"{rel}: Firestore collection commands or activity")

    backend = ROOT / "SellMateCloud" / "main.py"
    backend_text = backend.read_text(encoding="utf-8")
    admin_ok = all(name in backend_text for name in DOC_NAMES)
    print(f"scanned_client_files {scanned}")
    print(
        "backend_admin_writes "
        + ("present" if admin_ok else "MISSING — unexpected")
    )
    if hits:
        print("CLIENT_READS_FOUND")
        for hit in hits:
            print(hit)
        return 1
    print("no client reads of checkout_sessions, stripe_event_receipts, commands, or activity")
    return 0 if admin_ok else 1


if __name__ == "__main__":
    sys.exit(main())
