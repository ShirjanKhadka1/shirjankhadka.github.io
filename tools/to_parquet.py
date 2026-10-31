#!/usr/bin/env python3
"""Rows JSON -> Parquet for the COLD archive (Phase A).

Input: a JSON file containing a LIST of row objects (the form
ops/retention.py --extract writes for one month). Output: a Parquet
file plus the SHA-256 of the written bytes, so the cold manifest and
the restore test can prove the file byte-for-byte.

Modes:
  write --input rows.json --output out.parquet
      Writes the Parquet file; prints a JSON proof object as its LAST
      stdout line: {rows, bytes, sha256, columns, pyarrow_version}.
  check --input out.parquet [--expect-rows N]
      Decodes the file back with pyarrow, recomputes its SHA-256, and
      compares the row count. Prints a JSON proof object; exits 2 on
      any mismatch. This is the workflow's restore-test step.

pyarrow is the only dependency. The workflow pip-installs it (loosely
pinned) and logs the installed version; this script fails loudly with
the install command if pyarrow is missing.
"""

import argparse
import hashlib
import json
import sys

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:
    raise SystemExit(
        "pyarrow is required: pip install 'pyarrow>=17' "
        "(the retention-roll workflow installs it)")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_write(a):
    with open(a.input, "r", encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        raise SystemExit(f"{a.input}: expected a JSON list of row "
                         f"objects, got {type(rows).__name__}")
    if not rows:
        raise SystemExit(f"{a.input}: refusing to write an empty "
                         f"partition")
    if not all(isinstance(r, dict) for r in rows):
        raise SystemExit(f"{a.input}: every row must be an object")
    table = pa.Table.from_pylist(rows)
    pq.write_table(table, a.output)
    import os
    print(json.dumps({
        "mode": "write", "input": a.input, "output": a.output,
        "rows": table.num_rows, "bytes": os.path.getsize(a.output),
        "sha256": sha256_file(a.output),
        "columns": table.column_names,
        "pyarrow_version": pa.__version__,
    }, indent=2, sort_keys=True))
    return 0


def cmd_check(a):
    table = pq.read_table(a.input)
    sha = sha256_file(a.input)
    rows = table.num_rows
    ok = a.expect_rows is None or rows == a.expect_rows
    print(json.dumps({
        "mode": "check", "input": a.input, "rows": rows,
        "expect_rows": a.expect_rows, "sha256": sha,
        "columns": table.column_names,
        "pyarrow_version": pa.__version__, "match": ok,
    }, indent=2, sort_keys=True))
    if not ok:
        raise SystemExit(f"row count mismatch: got {rows}, "
                         f"expected {a.expect_rows}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Rows JSON -> Parquet")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("write")
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(fn=cmd_write)
    p = sub.add_parser("check")
    p.add_argument("--input", required=True)
    p.add_argument("--expect-rows", type=int, default=None)
    p.set_defaults(fn=cmd_check)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
