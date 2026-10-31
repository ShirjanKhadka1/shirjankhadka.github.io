#!/usr/bin/env python3
"""Chukul floorsheet collector (maintained repo code for a witnessed call).

Formalizes the call our own collector already uses in production
(tools/collect-eod.py, fetch_chukul_day) and that the staged floorsheet
data itself cites as its source (data branch
nepse-floorsheet/data/<date>/manifest.json: "Chukul floorsheet bydate
(public API)"):

    GET https://chukul.com/api/data/v2/floorsheet/bydate/
        ?date={YYYY-MM-DD}&page={n}&size={1000|500}

with ONLY a User-Agent header -- no token, no session, no key.

LICENCE GAP, STATED PLAINLY: no terms/licence has been found for
chukul.com and no permission has been obtained. This script is NOT
implemented under a licence; it exists under the owner's 2026-10-31
runs=free order (public no-auth endpoint, no ban found) and is
consistent with existing production use (the broker/floorsheet
pipelines already pull this endpoint server-side). If permission-first
is wanted, revert this script + its workflow; no site data is touched
by either.

BEHAVIOUR (binding):
  * Retries with backoff on TRANSPORT errors only (3 tries, 2/8/20 s).
  * Shape-asserts every page: the response must be a dict with a `data`
    list and `last_page`; every row must carry transaction, quantity,
    amount, buyer and seller keys. A shape failure aborts with NO
    output file (never a partial publish).
  * Dedupe by transaction (first wins); duplicates are counted, not
    silently dropped from the totals.
  * STOP LOUD on any 401/403, any CAPTCHA signal, or any new-gate
    signal: exit code 2, message starting "GATE:", never a silent
    continue, never a retry of a gate.
  * Pacing: 1 s between pages, single-threaded, one date per run.
    No intraday loop, no bulk backfill in this script (one --date).

WHAT THIS SCRIPT NEVER DOES (by construction, not by comment):
  * No data-branch write, no git operation, no Publish dispatch, no
    manifest edit. Staging is a separate, explicit step owned by the
    pipeline that calls it -- and the data branch ALREADY stages this
    exact dataset under nepse-floorsheet/data/ (see
    .github/workflows/chukul-floorsheet-verify.yml: the workflow runs
    this collector in VERIFY mode against that staging instead of
    writing a second copy).
  * No derived-signal or broker-flow republication logic: it collects
    raw rows only. Signals/entries/exits stay ours, computed elsewhere.

Modes:
  * Default: fetch the date, assert shapes, dedupe, write the rows
    JSON to --out (only after the full fetch succeeds).
  * --dry-run: print the fetch plan, fetch nothing, write nothing.
  * --verify-against MANIFEST: additionally compare totals against a
    day-manifest JSON (the staged nepse-floorsheet/data/<date>/
    manifest.json shape: trades, turnover, symbols) and write a small
    verification report to --report. A totals mismatch exits 3 -- a
    lead for human resolution, never a silent overwrite.

Standard library only. No dependencies.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "https://chukul.com/api/data/v2/floorsheet/bydate/"
UA = {"User-Agent": "NepseDecode-chukul-collector/1.0 (contact via repo)"}
TIMEOUT_S = 60
PAGE_TRIES = 3
PAGE_BACKOFF = (2, 8, 20)
PAGE_PACE_S = 1.0
PAGE_CAP = 300
ROW_KEYS = ("transaction", "quantity", "amount", "buyer", "seller")


class GateSignal(Exception):
    """A 401/403, CAPTCHA, or other new-gate signal: stop, loudly."""


class ShapeError(Exception):
    """Response or row shape is not the witnessed one: abort, no output."""


def _is_gate(status, body_text, content_type):
    if status in (401, 403):
        return True
    if "captcha" in body_text.lower():
        return True
    if content_type and "text/html" in content_type and "captcha" in body_text.lower():
        return True
    return False


def fetch_page(date_str, page, size):
    """One page, with transport-only retries. Raises GateSignal/ShapeError."""
    url = f"{BASE}?date={date_str}&page={page}&size={size}"
    last_exc = None
    for attempt in range(PAGE_TRIES):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                if resp.status in (401, 403):
                    raise GateSignal(f"GATE: {url} returned HTTP {resp.status}")
                try:
                    data = json.loads(raw.decode("utf-8", "replace"))
                except ValueError:
                    text = raw.decode("utf-8", "replace")
                    if _is_gate(resp.status, text, ctype):
                        raise GateSignal(f"GATE: non-JSON gate response from {url}")
                    raise ShapeError(f"page {page}: response is not JSON")
                if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                    text = raw.decode("utf-8", "replace")
                    if _is_gate(resp.status, text, ctype):
                        raise GateSignal(f"GATE: gate-shaped response from {url}")
                    raise ShapeError(f"page {page}: response lacks a 'data' list")
                if data.get("last_page") is None:
                    raise ShapeError(f"page {page}: response lacks 'last_page'")
                return data
        except GateSignal:
            raise
        except ShapeError:
            raise
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", "replace")
            except Exception:
                pass
            if _is_gate(exc.code, body, exc.headers.get("Content-Type", "")):
                raise GateSignal(f"GATE: {url} returned HTTP {exc.code}")
            last_exc = exc
        except Exception as exc:  # transport errors only: retry with backoff
            last_exc = exc
        if attempt < PAGE_TRIES - 1:
            time.sleep(PAGE_BACKOFF[attempt])
    raise ShapeError(f"page {page}: transport failed after {PAGE_TRIES} tries: {last_exc}")


def assert_row(row, page):
    if not isinstance(row, dict):
        raise ShapeError(f"page {page}: row is not an object: {row!r:.120}")
    for key in ROW_KEYS:
        if key not in row:
            raise ShapeError(f"page {page}: row lacks '{key}': {row!r:.120}")
    try:
        float(row.get("quantity") or 0)
        float(row.get("amount") or 0)
    except (TypeError, ValueError):
        raise ShapeError(f"page {page}: non-numeric quantity/amount: {row!r:.120}")


def collect(date_str):
    """Fetch one full session date. Returns (rows, stats)."""
    probe = fetch_page(date_str, 1, 1000)
    probe_rows = probe["data"]
    size = 1000 if len(probe_rows) == 1000 else 500
    print(f"probe page=1 size=1000 -> {len(probe_rows)} rows, page size {size}")

    rows, seen = [], set()
    duplicates = 0
    page, last_page = 1, None
    while True:
        data = fetch_page(date_str, page, size) if page != 1 else probe
        prs = data["data"]
        last_page = int(data["last_page"])
        fresh = 0
        for row in prs:
            assert_row(row, page)
            tx = str(row.get("transaction"))
            if tx in seen:
                duplicates += 1
                continue
            seen.add(tx)
            rows.append(row)
            fresh += 1
        print(f"page {page}/{last_page}: rows={len(prs)} fresh={fresh}")
        if not prs or page >= last_page:
            break
        page += 1
        if page > PAGE_CAP:
            raise ShapeError(f"page cap {PAGE_CAP} hit; aborting, no output")
        time.sleep(PAGE_PACE_S)
    stats = {"pages": page, "size": size, "last_page": last_page,
             "duplicates_dropped": duplicates}
    return rows, stats


def totals(rows):
    symbols = set()
    qty = 0.0
    amount = 0.0
    for row in rows:
        symbols.add(row.get("symbol"))
        qty += float(row.get("quantity") or 0)
        amount += float(row.get("amount") or 0)
    return {"trades": len(rows), "quantity": qty, "turnover": round(amount, 2),
            "symbols": len([s for s in symbols if s is not None])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", required=True, help="Session date YYYY-MM-DD")
    ap.add_argument("--out", default=None,
                    help="Rows JSON output path (written only on full success)")
    ap.add_argument("--report", default=None,
                    help="Small verification-report JSON path (with --verify-against)")
    ap.add_argument("--verify-against", default=None,
                    help="Day-manifest JSON to compare totals against")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the fetch plan; fetch nothing, write nothing")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        print(f"invalid --date: {args.date!r}", file=sys.stderr)
        return 1

    if args.dry_run:
        print("DRY RUN -- nothing fetched, nothing written.")
        print(f"Would fetch: {BASE}?date={args.date}&page=1&size=1000, "
              "then paginate to last_page (size 1000, else 500), "
              "1 s between pages, User-Agent header only.")
        print(f"Would write rows ONLY to: {args.out or '(no --out given)'}")
        print("Would NEVER write to the data branch, git, or Publish.")
        return 0

    try:
        rows, stats = collect(args.date)
    except GateSignal as exc:
        print(str(exc), file=sys.stderr)
        print("STOPPED LOUD: do not retry a gate, do not continue silently.",
              file=sys.stderr)
        return 2
    except ShapeError as exc:
        print(f"ABORT (shape/transport): {exc}", file=sys.stderr)
        return 1

    if not rows:
        print(f"ABORT: zero rows returned for {args.date}; no output written",
              file=sys.stderr)
        return 1

    tots = totals(rows)
    print(f"collected {args.date}: {tots['trades']} trades, "
          f"{tots['symbols']} symbols, turnover {tots['turnover']:.2f}, "
          f"{stats['pages']} pages, {stats['duplicates_dropped']} duplicates dropped")

    verify = None
    exit_code = 0
    if args.verify_against:
        with open(args.verify_against, encoding="utf-8") as fh:
            manifest = json.load(fh)
        mismatches = []
        for key, ours in (("trades", tots["trades"]),
                          ("turnover", tots["turnover"]),
                          ("symbols", tots["symbols"])):
            theirs = manifest.get(key)
            if theirs is None:
                continue
            if key == "turnover":
                ok = abs(float(theirs) - float(ours)) <= 0.01
            else:
                ok = int(theirs) == int(ours)
            if not ok:
                mismatches.append({"field": key, "collected": ours,
                                   "staged_manifest": theirs})
        verify = {"manifest": args.verify_against, "mismatches": mismatches,
                  "match": not mismatches}
        if mismatches:
            print(f"VERIFY MISMATCH vs staged manifest: {mismatches}",
                  file=sys.stderr)
            exit_code = 3
        else:
            print("VERIFY MATCH: collected totals agree with the staged manifest")

    if args.out:
        payload = {"source": "chukul floorsheet bydate (public API, no-auth, UA only)",
                   "date": args.date, "pages": stats["pages"],
                   "size": stats["size"], "last_page": stats["last_page"],
                   "duplicates_dropped": stats["duplicates_dropped"],
                   "totals": tots, "rows": rows}
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        print(f"Wrote rows (local only, never staged by this script): {args.out}")

    if args.report:
        report = {"source": "chukul floorsheet bydate (public API, no-auth, UA only)",
                  "date": args.date, "pages": stats["pages"],
                  "totals": tots,
                  "duplicates_dropped": stats["duplicates_dropped"],
                  "verify": verify}
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False)
        print(f"Wrote verification report: {args.report}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
