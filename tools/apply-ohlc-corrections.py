#!/usr/bin/env python3
"""Re-apply tape-verified OHLC corrections to the local warehouse.

The warehouse (~/workspace/nepse-data-archive/ohlc-db/ per-symbol files and
ohlc-YYYY-MM.json monthly files) is local-only, not git-tracked. The daily
updater (tools/update-ohlc-archive.js) and the p21 backfill merge are both
fill-missing-only, so they never overwrite an existing bar on this machine —
but a warehouse rebuilt from scratch (fresh machine, or monthly archives
re-fetched from the feed) would restore the feed's bars or drop gap-fill
rows. This script deterministically re-applies the corrections recorded in
tools/ohlc-corrections.json (git-tracked, deployed with the site) to both
stores, so any rebuild converges back to the verified bars.

Semantics (deliberately narrow):
- Only the fields listed per entry are enforced. Fields NOT listed are
  never touched — in particular the 2026-10-27 opens, which the overlay
  omits on purpose (warehouse previous-close proxies vs tape first trades;
  see the overlay's open_note).
- Existing bar: overlay fields overwrite, all other fields preserved.
- Missing bar: appended with the overlay fields only (monthly rows also
  get symbol + ltp=close when close is present).
- Nothing is ever deleted: no bars, dates, or symbols are removed.
- ohlc-db bars use `turnover`; monthly rows use `amount` (same value).
  Monthly rows also carry `ltp`, kept equal to close when close is overlaid.
- Files are written only when their content actually changed (atomic
  temp-file + replace), so re-runs are byte-stable no-ops.

Usage:
  python3 tools/apply-ohlc-corrections.py [--dry-run]
      [--warehouse-dir DIR] [--archive-dir DIR] [--overlay FILE]
      [--skip-db] [--skip-monthly]

Exit 0 on success (including dry-run), 2 on validation/IO failure.
"""

import argparse
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OVERLAY = os.path.join(HERE, "ohlc-corrections.json")
DEFAULT_WAREHOUSE = os.path.expanduser("~/workspace/nepse-data-archive/ohlc-db")
DEFAULT_ARCHIVE = os.path.expanduser("~/workspace/nepse-data-archive")

ALLOWED_FIELDS = {"open", "high", "low", "close", "volume", "turnover"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    return 2


def load_overlay(path):
    with open(path) as f:
        doc = json.load(f)
    if doc.get("format") != "nd-ohc-corrections-v1":
        return None, f"unsupported overlay format: {doc.get('format')!r}"
    entries = doc.get("entries")
    if not isinstance(entries, list) or not entries:
        return None, "overlay has no entries"
    for e in entries:
        if not isinstance(e, dict):
            return None, f"entry is not an object: {e!r}"
        if not isinstance(e.get("symbol"), str) or not e["symbol"]:
            return None, f"entry missing symbol: {e!r}"
        if not DATE_RE.match(e.get("date", "")):
            return None, f"entry has bad date: {e!r}"
        fields = e.get("fields")
        if not isinstance(fields, dict) or not fields:
            return None, f"entry has no fields: {e!r}"
        for k, v in fields.items():
            if k not in ALLOWED_FIELDS:
                return None, f"entry {e['symbol']} {e['date']} has unknown field {k!r}"
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                return None, f"entry {e['symbol']} {e['date']} field {k} is not numeric: {v!r}"
    return entries, None


def load_json(path, default):
    if not os.path.exists(path):
        return default, True
    with open(path) as f:
        return json.load(f), False


def detect_compact(path):
    """Detect JS-style compact separators (no spaces) vs Python default.

    Monthly files alternate writers (JS updater = compact, Python backfill
    = default). Rewriting in the file's existing style keeps diffs minimal.
    """
    try:
        with open(path, "rb") as f:
            raw = f.read(4096)
    except OSError:
        return False
    return b'":' in raw and b'": ' not in raw


def dump_json(path, obj):
    # Preserve the file's existing separator style (see detect_compact).
    seps = (",", ":") if detect_compact(path) else None
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".ohlc-corr-", dir=d)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, separators=seps) if seps else json.dump(obj, f)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def sym_file(warehouse_dir, symbol):
    return os.path.join(warehouse_dir, symbol.replace("/", "-") + ".json")


def apply_db(warehouse_dir, entries, dry_run):
    """Apply overlay to ohlc-db per-symbol files. Returns (changed, created, checked)."""
    changed, created, checked = [], [], 0
    by_sym = {}
    for e in entries:
        by_sym.setdefault(e["symbol"], []).append(e)
    for sym, es in sorted(by_sym.items()):
        path = sym_file(warehouse_dir, sym)
        doc, missing = load_json(path, None)
        if missing:
            doc = {"symbol": sym, "bars": [],
                   "provenance": {"sources": {}, "bar_count": 0, "date_range": []}}
            created_flag = True
        else:
            created_flag = False
        bars = doc.setdefault("bars", [])
        by_date = {b.get("date"): b for b in bars if isinstance(b, dict)}
        touched = False
        for e in es:
            bar = by_date.get(e["date"])
            if bar is None:
                bar = {"date": e["date"]}
                bar.update(e["fields"])
                bars.append(bar)
                by_date[e["date"]] = bar
                touched = True
            else:
                for k, v in e["fields"].items():
                    if bar.get(k) != v:
                        bar[k] = v
                        touched = True
        bars.sort(key=lambda b: b.get("date", ""))
        prov = doc.setdefault("provenance", {})
        prov["sources"] = dict(prov.get("sources", {}))
        prov["sources"]["corrections"] = len(es)
        prov["bar_count"] = len(bars)
        prov["date_range"] = [bars[0]["date"], bars[-1]["date"]] if bars else []
        overlay_dates = {e["date"] for e in es}
        prov["corrections_only"] = bool(bars) and all(
            b.get("date") in overlay_dates for b in bars)
        if not prov["corrections_only"]:
            prov.pop("corrections_only", None)
        if touched or created_flag or missing:
            checked += 1
            if dry_run:
                (created if created_flag else changed).append(path)
            else:
                dump_json(path, doc)
                (created if created_flag else changed).append(path)
        else:
            checked += 1
    return changed, created, checked


def apply_monthly(archive_dir, entries, dry_run):
    """Apply overlay to ohlc-YYYY-MM.json monthly files."""
    changed, created, checked = [], [], 0
    by_month = {}
    for e in entries:
        by_month.setdefault(e["date"][:7], []).append(e)
    for ym, es in sorted(by_month.items()):
        path = os.path.join(archive_dir, f"ohlc-{ym}.json")
        doc, missing = load_json(path, None)
        if missing:
            doc = {"asof": ym + "-01",
                   "archive": "Nepse Decode proprietary OHLC archive", "data": {}}
            created_flag = True
        else:
            created_flag = False
        data = doc.setdefault("data", {})
        touched = False
        for e in es:
            rows = data.setdefault(e["symbol"], [])
            row = next((r for r in rows if r.get("date") == e["date"]), None)
            if row is None:
                row = {"date": e["date"], "symbol": e["symbol"]}
                for k, v in e["fields"].items():
                    row["amount" if k == "turnover" else k] = v
                if "close" in e["fields"]:
                    row["ltp"] = e["fields"]["close"]
                rows.append(row)
                touched = True
            else:
                for k, v in e["fields"].items():
                    mk = "amount" if k == "turnover" else k
                    if row.get(mk) != v:
                        row[mk] = v
                        touched = True
                if "close" in e["fields"] and row.get("ltp") != e["fields"]["close"]:
                    row["ltp"] = e["fields"]["close"]
                    touched = True
            rows.sort(key=lambda r: r.get("date", ""))
        latest = doc.get("asof", ym + "-01")
        for rows in data.values():
            for r in rows:
                if r.get("date", "") > latest:
                    latest = r["date"]
        if doc.get("asof") != latest:
            doc["asof"] = latest
            touched = True
        if touched or created_flag or missing:
            checked += 1
            if dry_run:
                (created if created_flag else changed).append(path)
            else:
                dump_json(path, doc)
                (created if created_flag else changed).append(path)
        else:
            checked += 1
    return changed, created, checked


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--warehouse-dir", default=DEFAULT_WAREHOUSE)
    ap.add_argument("--archive-dir", default=DEFAULT_ARCHIVE)
    ap.add_argument("--overlay", default=DEFAULT_OVERLAY)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-db", action="store_true")
    ap.add_argument("--skip-monthly", action="store_true")
    args = ap.parse_args(argv)

    entries, err = load_overlay(args.overlay)
    if err:
        return fail(err)
    print(f"overlay: {args.overlay} ({len(entries)} entries, "
          f"{len({e['symbol'] for e in entries})} symbols)")

    total_changed, total_created = [], []
    if not args.skip_db:
        if not os.path.isdir(args.warehouse_dir):
            return fail(f"warehouse dir missing: {args.warehouse_dir}")
        ch, cr, n = apply_db(args.warehouse_dir, entries, args.dry_run)
        total_changed += ch
        total_created += cr
        print(f"ohlc-db: {n} symbol files checked, {len(ch)} updated, {len(cr)} created")
        for p in ch + cr:
            print(f"  {'created' if p in cr else 'updated'}: {p}")
    if not args.skip_monthly:
        if not os.path.isdir(args.archive_dir):
            return fail(f"archive dir missing: {args.archive_dir}")
        ch, cr, n = apply_monthly(args.archive_dir, entries, args.dry_run)
        total_changed += ch
        total_created += cr
        print(f"monthly: {n} month files checked, {len(ch)} updated, {len(cr)} created")
        for p in ch + cr:
            print(f"  {'created' if p in cr else 'updated'}: {p}")
    if args.dry_run:
        print("dry-run: no files written")
    else:
        print(f"done: {len(total_changed)} updated, {len(total_created)} created, "
              "0 deleted (applier never deletes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
