#!/usr/bin/env python3
"""Abort a deploy if live rules are not the known public-read set.

The only allows expected in production today are public reads of machines,
inventory, planogramSlots, commands, activity, orders, vend_jobs,
stripe_event_receipts, and checkout_sessions, plus the catch-all deny.
"""

from __future__ import annotations

import sys
from pathlib import Path

PUBLIC_READS = 9
CATCH_ALL = "allow read, write: if false;"
PUBLIC_READ = "allow read: if true;"


def allow_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip().startswith("allow ")]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_live_rules.py RULES_FILE", file=sys.stderr)
        return 2
    lines = allow_lines(Path(sys.argv[1]).read_text())
    public = [line for line in lines if line == PUBLIC_READ]
    catch_all = [line for line in lines if line == CATCH_ALL]
    other = [line for line in lines if line not in (PUBLIC_READ, CATCH_ALL)]
    if other or len(public) != PUBLIC_READS or len(catch_all) != 1:
        print("Refusing to deploy. Live rules do not match the expected public-read set.", file=sys.stderr)
        print(f"public reads: {len(public)} (expected {PUBLIC_READS})", file=sys.stderr)
        print(f"catch-all denies: {len(catch_all)} (expected 1)", file=sys.stderr)
        if other:
            print("unexpected allow lines:", file=sys.stderr)
            for line in other:
                print(f"  {line}", file=sys.stderr)
        return 1
    print("Live rules match the expected public-read set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
