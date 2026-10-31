#!/usr/bin/env python3
"""Retention-window logic for the NEPSE Decode rolling data window
(Phase A). Stdlib only — no PyYAML, no pyarrow.

Window rule (config/retention.yaml):
  window_start(D) = first trading session on/after (D - window_years),
  Feb 29 safe (clamps to Feb 28). Trading sessions are regime-aware:
  Sun-Thu before 2026-04-06, Mon-Fri from 2026-04-06 onward, skipping
  dates listed as closed in the holidays file.

  WINDOW AMBIGUITY — RESOLVED by user decision 2026-10-31:
  window_years=3 is CONFIRMED (window starts 2023-10-31 on
  2026-10-31, 2023-11-01 on 2026-11-01). The charters' example dates
  (2024-10-31) were wrong. This code uses window_years from the
  config (3). See ops/RETENTION.md.

  PER-DATASET ACTUAL START (user decision 2026-10-31): the planner
  reports window_start per dataset as max(formula window_start,
  first real date in that dataset's rows). A dataset with shorter
  history (e.g. floorsheet/broker since 2026-07-15) therefore starts
  at its first real date, and the UI line must show that ACTUAL start
  per dataset — never the formula date alone. Buckets and the
  threshold are computed from the EFFECTIVE start.

  PHASE B GATE (user decision 2026-10-31, HARD, fail safe): live
  mode rolls ONLY datasets whose retention.yaml entry is explicitly
  marked `phase_b: allowed`. Every other dataset is refused by the
  `phase-b-gate` command (the workflow runs it in live mode only, so
  dry-run previews still work). No live roll or cron until GATE A
  (including the restore test) AND Phase B licensing allow archiving
  EACH dataset.

Row buckets for a dataset (reported by --plan, enforced by
--extract):
  expiring     date < threshold            -> moves to COLD
  buffer_kept  threshold <= date < window  -> stays in HOT (warm-up)
  retained     date >= window              -> stays in HOT (window)
where threshold = window_start - buffer_years for roll_rule
window_minus_buffer, else threshold = window_start (buffer_kept is
then always empty). Live mode REFUSES any dataset not listed in
config/retention.yaml, and REFUSES a kept set that would be empty.

Config parsing: the file is YAML, but this script is stdlib-only, so
it parses the restricted subset the config file actually uses:
2-space indent, `key: scalar` lines, nested maps, and `- key: value`
list items with following indented keys. Anything outside that
subset fails loudly instead of being misread.

CLI (every mode prints a JSON proof object as its LAST stdout line):
  window-start --date YYYY-MM-DD [--holidays PATH] [--config PATH]
  plan --dataset NAME --input FILE [--asof YYYY-MM-DD] [--config PATH]
  extract --dataset NAME --input FILE --kept-output FILE
          --expiring-dir DIR [--asof YYYY-MM-DD] [--config PATH]
  session-guard [--asof YYYY-MM-DD] [--holidays PATH] [--config PATH]
  phase-b-gate --dataset NAME [--config PATH]
  manifest-init --output FILE
  manifest-add --manifest FILE --dataset NAME --path PATH --rows N
               --sha256 HEX --window-start YYYY-MM-DD --asof YYYY-MM-DD
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
REGIME_SWITCH = dt.date(2026, 4, 6)  # Mon-Fri trading starts here
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def fail(msg):
    raise SystemExit(f"retention: {msg}")


def parse_date(s):
    if not s or not DATE_RE.match(s):
        fail(f"date must be YYYY-MM-DD, got {s!r}")
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        fail(f"invalid calendar date {s!r}")


def minus_years(d, years):
    """D minus N years, Feb 29 safe (clamps to Feb 28)."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # Feb 29 -> Feb 28
        return d.replace(year=d.year - years, day=28)


def is_trading_weekday(d):
    """Regime-aware weekday rule. Python weekday(): Mon=0 .. Sun=6."""
    if d < REGIME_SWITCH:
        return d.weekday() in (6, 0, 1, 2, 3)  # Sun-Thu
    return d.weekday() in (0, 1, 2, 3, 4)  # Mon-Fri


# ---------------------------------------------------------------- holidays

def load_holidays(path):
    """Load closed dates from a holidays file. Accepts:
      * JSON: {"holidays": [{"date_ad": ..., "type": "closed"}, ...]}
      * JSON: {"YYYY-MM-DD": {...}} dict form
      * text: "YYYY-MM-DD: Holiday name" lines (nepse-holidays.txt)
    Returns (set_of_dates, source_description). Entries whose type is
    not "closed" are ignored. NOTE: the repo's own holidays file marks
    its per-date entries unverified — the roll logs which holidays it
    applied, and a real session (evidence) always wins over the file.
    """
    if not path or not os.path.exists(path):
        return set(), None
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    closed = set()
    text = raw.strip()
    if text.startswith("{"):
        data = json.loads(text)
        if isinstance(data, dict) and isinstance(data.get("holidays"), list):
            for e in data["holidays"]:
                if isinstance(e, dict) and e.get("type") == "closed" \
                        and e.get("date_ad"):
                    closed.add(parse_date(e["date_ad"]))
            return closed, f"{path} (json holidays list, {len(closed)} closed)"
        if isinstance(data, dict):
            for k, v in data.items():
                if DATE_RE.match(k) and isinstance(v, dict) \
                        and v.get("type", "closed") == "closed":
                    closed.add(parse_date(k))
            return closed, f"{path} (json dict, {len(closed)} closed)"
        fail(f"unrecognised holidays JSON shape in {path}")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\s*:", line)
        if m:
            closed.add(parse_date(m.group(1)))
    return closed, f"{path} (txt, {len(closed)} closed)"


def default_holidays():
    """First existing file wins: tools/nepse-holidays.json, then
    nepse-holidays.txt. Searches the cwd and the repo root above this
    script (ops/../). Returns (dates, source) or (empty, None)."""
    candidates = []
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [os.getcwd(), os.path.dirname(here)]
    for root in roots:
        candidates.append(os.path.join(root, "tools", "nepse-holidays.json"))
        candidates.append(os.path.join(root, "nepse-holidays.txt"))
    for path in candidates:
        if os.path.exists(path):
            return load_holidays(path)
    return set(), None


def resolve_holidays(explicit):
    if explicit:
        if not os.path.exists(explicit):
            fail(f"holidays file not found: {explicit}")
        return load_holidays(explicit)
    return default_holidays()


# ---------------------------------------------------------------- window math

def window_start(asof, holidays, window_years):
    """Returns (window_start, raw, holidays_applied). Scans forward
    from the raw date for the first trading session (max 21 days —
    longer than any real NEPSE closure run; beyond that, fail)."""
    raw = minus_years(asof, window_years)
    applied = []
    d = raw
    for _ in range(22):
        if is_trading_weekday(d) and d not in holidays:
            return d, raw, applied
        if d in holidays:
            applied.append(d.isoformat())
        d += dt.timedelta(days=1)
    fail(f"no trading session within 21 days after {raw} — "
         f"check the holidays file")


def today_npt():
    """Current date in Asia/Kathmandu. NPT is UTC+5:45 year-round
    (no DST), so a fixed offset is exact — no tzdata needed."""
    now_utc = dt.datetime.now(dt.timezone.utc)
    now_npt = now_utc + dt.timedelta(hours=5, minutes=45)
    return now_npt.date(), now_npt.strftime("%H:%M")


# ---------------------------------------------------------------- config

def _scalar(text):
    text = text.strip()
    if text in ("true", "True"):
        return True
    if text in ("false", "False"):
        return False
    if text in ("null", "Null", "~"):
        return None
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        pass
    if (text.startswith('"') and text.endswith('"')) or \
            (text.startswith("'") and text.endswith("'")):
        return text[1:-1]
    return text


def parse_subset_yaml(path):
    """Parse the restricted YAML subset described in the docstring.
    Returns a nested dict. Fails on tabs, flow collections, anchors,
    and anything it cannot represent exactly."""
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    root = {}
    stack = [(-1, root)]  # (indent, container)

    def current_container(indent):
        while stack and stack[-1][0] >= indent:
            stack.pop()
        return stack[-1][1]

    for lineno, raw in enumerate(lines, 1):
        if "\t" in raw:
            fail(f"{path}:{lineno}: tabs are not allowed")
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent % 2 != 0:
            fail(f"{path}:{lineno}: indent must be a multiple of 2")
        container = current_container(indent)
        if stripped.startswith("- "):
            # List item: must be inside a list container.
            if not isinstance(container, list):
                fail(f"{path}:{lineno}: list item outside a list")
            item_text = stripped[2:]
            if ":" not in item_text:
                # Bare scalar item (e.g. an exemptions entry).
                container.append(_scalar(item_text))
                continue
            k, _, v = item_text.partition(":")
            item = {}
            v = v.strip()
            if v:
                item[k.strip()] = _scalar(v)
            container.append(item)
            stack.append((indent, item))
            continue
        if ":" not in stripped:
            fail(f"{path}:{lineno}: cannot parse line {stripped!r}")
        k, _, v = stripped.partition(":")
        k, v = k.strip(), v.strip()
        if not isinstance(container, dict):
            fail(f"{path}:{lineno}: key outside a map")
        if v == "":
            # Nested block: decide list vs map by peeking ahead.
            nested = None
            for nxt in lines[lineno:]:
                s = nxt.strip()
                if not s or s.startswith("#"):
                    continue
                nested = "list" if s.startswith("- ") else "map"
                break
            container[k] = [] if nested == "list" else {}
            stack.append((indent, container[k]))
        elif v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            container[k] = [_scalar(x) for x in inner.split(",")] \
                if inner else []
        else:
            container[k] = _scalar(v)
    return root


def load_config(path):
    if not path:
        path = "config/retention.yaml"
    if not os.path.exists(path):
        here = os.path.dirname(os.path.abspath(__file__))
        alt = os.path.join(os.path.dirname(here), "config",
                           "retention.yaml")
        path = alt if os.path.exists(alt) else path
    if not os.path.exists(path):
        fail(f"config not found: {path}")
    cfg = parse_subset_yaml(path)
    for key in ("window_years", "buffer_years", "datasets"):
        if key not in cfg:
            fail(f"config {path} is missing required key {key!r}")
    if not isinstance(cfg["window_years"], int) or cfg["window_years"] < 1:
        fail("window_years must be a positive integer")
    if not isinstance(cfg["buffer_years"], int) or cfg["buffer_years"] < 0:
        fail("buffer_years must be a non-negative integer")
    if not isinstance(cfg["datasets"], list) or not cfg["datasets"]:
        fail("config datasets must be a non-empty list")
    table = {}
    for ds in cfg["datasets"]:
        for req in ("name", "hot_path", "shape", "roll_rule"):
            if req not in ds:
                fail(f"dataset entry missing {req!r}: {ds}")
        if ds["shape"] not in ("rows_array", "entries_list"):
            fail(f"dataset {ds['name']}: unknown shape {ds['shape']!r}")
        if ds["shape"] == "entries_list" and "date_field" not in ds:
            fail(f"dataset {ds['name']}: entries_list needs date_field")
        if ds["roll_rule"] not in ("window", "window_minus_buffer"):
            fail(f"dataset {ds['name']}: unknown roll_rule "
                 f"{ds['roll_rule']!r}")
        table[ds["name"]] = ds
    cfg["_table"] = table
    return cfg


def get_dataset(cfg, name):
    ds = cfg["_table"].get(name)
    if ds is None:
        fail(f"dataset {name!r} is NOT in config/retention.yaml — "
             f"live mode refuses datasets outside the table; add it "
             f"with its shape, date field, roll rule, and a "
             f"builder-window-aware confirmation first")
    return ds


# ---------------------------------------------------------------- datasets

def load_dataset_rows(input_path, ds):
    """Returns (rows, original_doc) where rows is a list of dicts each
    carrying _date (a date object) plus its payload fields."""
    with open(input_path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    rows = []
    if ds["shape"] == "rows_array":
        raw_rows = doc.get("rows") if isinstance(doc, dict) else None
        if not isinstance(raw_rows, list):
            fail(f"{input_path}: rows_array dataset needs a 'rows' list")
        fields = ds.get("row_fields") or \
            ["date", "open", "high", "low", "close", "volume"]
        for r in raw_rows:
            if not isinstance(r, list) or not r:
                fail(f"{input_path}: bad row {str(r)[:80]}")
            yyyymmdd = r[0]
            if isinstance(yyyymmdd, int):
                s = f"{yyyymmdd:08d}"
            else:
                s = str(yyyymmdd)
            if not re.match(r"^\d{8}$", s):
                fail(f"{input_path}: bad row date {yyyymmdd!r}")
            d = dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
            row = {"_date": d, "date": d.isoformat()}
            for i, field in enumerate(fields[1:], start=1):
                row[field] = r[i] if i < len(r) else None
            rows.append(row)
    else:
        entries = doc.get("entries") if isinstance(doc, dict) else None
        if not isinstance(entries, list):
            fail(f"{input_path}: entries_list dataset needs 'entries'")
        field = ds["date_field"]
        for e in entries:
            if not isinstance(e, dict) or field not in e:
                fail(f"{input_path}: entry missing {field!r}: "
                     f"{str(e)[:80]}")
            row = dict(e)
            row["_date"] = parse_date(str(e[field]))
            rows.append(row)
    return rows, doc


def bucket_rows(rows, ws, threshold):
    expiring, buffer_kept, retained = [], [], []
    for r in rows:
        d = r["_date"]
        if d < threshold:
            expiring.append(r)
        elif d < ws:
            buffer_kept.append(r)
        else:
            retained.append(r)
    return expiring, buffer_kept, retained


def plan_counts(rows, ws, threshold):
    expiring, buffer_kept, retained = bucket_rows(rows, ws, threshold)
    def span(bucket):
        if not bucket:
            return None
        ds = sorted(r["_date"] for r in bucket)
        return {"first": ds[0].isoformat(), "last": ds[-1].isoformat()}
    return {
        "total": len(rows),
        "expiring": len(expiring),
        "buffer_kept": len(buffer_kept),
        "retained": len(retained),
        "expiring_span": span(expiring),
        "buffer_span": span(buffer_kept),
        "retained_span": span(retained),
    }


def rebuild_kept_doc(doc, ds, kept_rows):
    """Rebuild the original document shape with only kept rows."""
    if ds["shape"] == "rows_array":
        fields = ds.get("row_fields") or \
            ["date", "open", "high", "low", "close", "volume"]
        out_rows = []
        for r in kept_rows:
            yyyymmdd = int(r["_date"].strftime("%Y%m%d"))
            out_rows.append([yyyymmdd] +
                            [r.get(f) for f in fields[1:]])
        out = dict(doc)
        out["rows"] = out_rows
        if out_rows:
            out["from"] = kept_rows[0]["_date"].isoformat()
            out["to"] = kept_rows[-1]["_date"].isoformat()
        return out
    out = dict(doc)
    out["entries"] = [{k: v for k, v in row.items() if k != "_date"}
                      for row in kept_rows]
    return out


def public_row(row):
    return {k: v for k, v in row.items() if k != "_date"}


# ---------------------------------------------------------------- manifest

def manifest_init():
    return {"version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "cold_branch": "cold",
            "datasets": {}}


def load_manifest(path):
    if not os.path.exists(path):
        fail(f"manifest not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        m = json.load(f)
    if not isinstance(m, dict) or "datasets" not in m:
        fail(f"manifest {path} is not a cold manifest")
    return m


def save_manifest(path, manifest):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def manifest_add(manifest, dataset, part_path, rows, sha256,
                 window_start_s, asof):
    if not SHA_RE.match(sha256 or ""):
        fail(f"sha256 must be 64 hex chars, got {sha256!r}")
    if not isinstance(rows, int) or rows < 0:
        fail(f"rows must be a non-negative integer, got {rows!r}")
    parts = manifest["datasets"].setdefault(dataset, {"partitions": []})
    for p in parts["partitions"]:
        if p["path"] == part_path:
            if p["sha256"] == sha256 and p["rows"] == rows:
                return {"added": False, "reason": "already-present",
                        "path": part_path}
            fail(f"manifest conflict: {part_path} already recorded "
                 f"with a different sha/rows — refusing to overwrite")
    parts["partitions"].append({
        "path": part_path, "rows": rows, "sha256": sha256,
        "window_start": window_start_s, "asof": asof,
        "written_at": dt.datetime.now(dt.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    parts["partitions"].sort(key=lambda p: p["path"])
    return {"added": True, "path": part_path, "rows": rows,
            "sha256": sha256}


# ---------------------------------------------------------------- CLI

def cmd_window_start(a):
    cfg = load_config(a.config)
    asof = parse_date(a.date)
    holidays, source = resolve_holidays(a.holidays)
    ws, raw, applied = window_start(asof, holidays, cfg["window_years"])
    print(json.dumps({
        "asof": asof.isoformat(), "window_years": cfg["window_years"],
        "raw": raw.isoformat(), "window_start": ws.isoformat(),
        "holidays_source": source, "holidays_applied": applied,
        "regime_switch": REGIME_SWITCH.isoformat(),
    }, indent=2, sort_keys=True))
    return 0


def cmd_session_guard(a):
    cfg = load_config(a.config)
    asof = parse_date(a.date) if a.date else today_npt()[0]
    holidays, source = resolve_holidays(a.holidays)
    today, hhmm = today_npt()
    # Live rolls run nightly after FINAL. Refuse only when the roll
    # date's own session could still be open: a future roll date, or
    # today when today is a session day and it is before 16:00 NPT.
    # A past session day is already final, so it passes.
    if asof > today:
        reason = "roll date is in the future"
        refused = True
    elif asof == today and is_trading_weekday(today) \
            and today not in holidays and hhmm < "16:00":
        reason = ("today is a trading day before 16:00 NPT — a live "
                  "roll must run nightly after FINAL, never during "
                  "or just after a session")
        refused = True
    else:
        reason = None
        refused = False
    if refused:
        print(json.dumps({
            "guard": "REFUSED", "asof": asof.isoformat(),
            "npt_now": hhmm, "reason": reason,
        }, indent=2, sort_keys=True))
        return 2
    print(json.dumps({
        "guard": "OK", "asof": asof.isoformat(), "npt_now": hhmm,
        "is_session_day": is_trading_weekday(asof)
        and asof not in holidays,
        "holidays_source": source,
    }, indent=2, sort_keys=True))
    return 0


def _plan_common(a):
    cfg = load_config(a.config)
    ds = get_dataset(cfg, a.dataset)
    asof = parse_date(a.asof) if a.asof else today_npt()[0]
    holidays, source = resolve_holidays(a.holidays)
    ws_formula, raw, applied = window_start(
        asof, holidays, cfg["window_years"])
    rows, _doc = load_dataset_rows(a.input, ds)
    # Per-dataset ACTUAL start (user decision 2026-10-31):
    # effective = max(formula window, first real date in the rows).
    # A young dataset starts at its first real date; an old dataset
    # is unaffected (its first date precedes the formula window).
    first_date = min((r["_date"] for r in rows), default=None)
    ws = max(ws_formula, first_date) if first_date else ws_formula
    threshold = (minus_years(ws, cfg["buffer_years"])
                 if ds["roll_rule"] == "window_minus_buffer" else ws)
    counts = plan_counts(rows, ws, threshold)
    return cfg, ds, asof, ws, threshold, counts, {
        "dataset": a.dataset, "hot_path": ds["hot_path"],
        "roll_rule": ds["roll_rule"],
        "asof": asof.isoformat(), "window_years": cfg["window_years"],
        "buffer_years": cfg["buffer_years"], "raw": raw.isoformat(),
        "window_start_formula": ws_formula.isoformat(),
        "first_date": first_date.isoformat() if first_date else None,
        "window_start": ws.isoformat(),
        "threshold": threshold.isoformat(),
        "holidays_source": source, "holidays_applied": applied,
        **counts,
    }


def cmd_phase_b_gate(a):
    cfg = load_config(a.config)
    ds = get_dataset(cfg, a.dataset)
    # HARD gate: only an explicit `phase_b: allowed` passes. Anything
    # else (pending, missing, any other value) refuses live mode.
    if ds.get("phase_b") == "allowed":
        print(json.dumps({"gate": "OK", "dataset": a.dataset,
                          "phase_b": "allowed"}, indent=2, sort_keys=True))
        return 0
    print(json.dumps({
        "gate": "REFUSED", "dataset": a.dataset,
        "phase_b": ds.get("phase_b"),
        "reason": "live mode rolls ONLY datasets explicitly marked "
                  "phase_b: allowed in config/retention.yaml. No live "
                  "roll or cron until GATE A (including the restore "
                  "test) AND Phase B licensing allow archiving EACH "
                  "dataset.",
    }, indent=2, sort_keys=True))
    return 2


def cmd_plan(a):
    _cfg, _ds, _asof, _ws, _thr, _c, report = _plan_common(a)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


def cmd_extract(a):
    cfg, ds, asof, ws, threshold, counts, report = _plan_common(a)
    rows, doc = load_dataset_rows(a.input, ds)
    expiring, buffer_kept, retained = bucket_rows(rows, ws, threshold)
    kept = buffer_kept + retained
    kept.sort(key=lambda r: r["_date"])
    if not kept:
        fail("refusing a roll that would leave HOT empty — "
             "kept set is empty; check window_years and the input")
    kept_doc = rebuild_kept_doc(doc, ds, kept)
    with open(a.kept_output, "w", encoding="utf-8") as f:
        f.write(json.dumps(kept_doc, indent=2, sort_keys=True) + "\n")
    os.makedirs(a.expiring_dir, exist_ok=True)
    by_month = {}
    for r in sorted(expiring, key=lambda r: r["_date"]):
        by_month.setdefault(r["_date"].strftime("%Y-%m"), []).append(r)
    month_files = {}
    for month, mrows in sorted(by_month.items()):
        path = os.path.join(a.expiring_dir, f"{month}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps([public_row(r) for r in mrows],
                               indent=2, sort_keys=True) + "\n")
        month_files[month] = {"file": path, "rows": len(mrows)}
    report["kept_output"] = a.kept_output
    report["expiring_dir"] = a.expiring_dir
    report["expiring_months"] = month_files
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


def cmd_manifest_init(a):
    save_manifest(a.output, manifest_init())
    print(json.dumps({"manifest": a.output, "status": "initialized",
                      "datasets": {}}, indent=2, sort_keys=True))
    return 0


def cmd_manifest_add(a):
    m = load_manifest(a.manifest)
    result = manifest_add(m, a.dataset, a.path, a.rows, a.sha256,
                          a.window_start, a.asof)
    if result["added"]:
        save_manifest(a.manifest, m)
    result["manifest"] = a.manifest
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def main():
    ap = argparse.ArgumentParser(description="Retention-window logic")
    ap.add_argument("--config", default=None)
    ap.add_argument("--holidays", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("window-start")
    p.add_argument("--date", required=True)
    p.set_defaults(fn=cmd_window_start)

    p = sub.add_parser("session-guard")
    p.add_argument("--date", default=None)
    p.set_defaults(fn=cmd_session_guard)

    p = sub.add_parser("phase-b-gate")
    p.add_argument("--dataset", required=True)
    p.set_defaults(fn=cmd_phase_b_gate)

    p = sub.add_parser("plan")
    p.add_argument("--dataset", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--asof", default=None)
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser("extract")
    p.add_argument("--dataset", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--kept-output", required=True)
    p.add_argument("--expiring-dir", required=True)
    p.add_argument("--asof", default=None)
    p.set_defaults(fn=cmd_extract)

    p = sub.add_parser("manifest-init")
    p.add_argument("--output", required=True)
    p.set_defaults(fn=cmd_manifest_init)

    p = sub.add_parser("manifest-add")
    p.add_argument("--manifest", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--path", required=True)
    p.add_argument("--rows", type=int, required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--window-start", required=True)
    p.add_argument("--asof", required=True)
    p.set_defaults(fn=cmd_manifest_add)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
