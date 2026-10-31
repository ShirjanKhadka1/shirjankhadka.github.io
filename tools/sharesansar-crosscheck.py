#!/usr/bin/env python3
"""ShareSansar cross-check comparator (wave-2 implementation of the wave-1 draft).

Cross-check ONLY, per Phase B (docs/sources/sharesansar.md, CROSS-CHECK ONLY)
and the ShareSansar terms disclaimer ("not necessarily real-time or accurate",
"provided by a third party", no republication licence granted).

What this script does:
  * Fetches at most 4 public, no-login data pages (market, datewise-indices,
    today-share-price, one optional company page) with an identifying
    User-Agent, >=5 s spacing, and an abort on 429/403 or on any robots.txt
    change that disallows the paths. The robots.txt gate fetch is one
    additional request, not a data page, so a full run makes at most
    5 HTTP requests in total.
  * Compares the latest-session figures found there against a PRIMARY-source
    JSON file supplied by the caller (--primary). ShareSansar NEVER wins:
    a mismatch is logged for human resolution from the primary source.
  * Writes exactly one file: an internal discrepancy log (default path is a
    local, unpublished log location -- never data/, never the publish
    manifest, never a site page).

What this script NEVER does (by construction, not by comment):
  * No --publish/--write-data option exists. There is no code path that writes
    site data, touches the manifest, opens a PR, or dispatches a workflow.
  * No floorsheet, broker-flow derivation, NAV, AGM/dividend-table, news-list,
    history, or monthly-series fetching: those mechanisms are undetermined
    (wave-1 REPORT.md section 6) and are not in this script.
  * No SS Pro, no login, no key/token, no unofficial wrapper library.

Default mode is --dry-run: it prints the URLs it WOULD fetch and the checks
it WOULD run, and fetches nothing. Pass --live to fetch (weekdays post-close
only; see .github/workflows/sharesansar-crosscheck.yml).

Wave-2 change vs the wave-1 draft: the extractors parse raw HTML tables
with the stdlib html.parser (header-driven column lookup), because the
draft's pipe patterns only matched a text-dump rendering and live table
cells span multiple source lines. A shape that still does not parse
reports UNVERIFIED, never a guessed value.

Primary-file format (caller-supplied, primary source is authoritative):
    {"as_of": "2026-10-30",
     "nepse_close": 2690.15,
     "symbols": {"ACLBSL": {"close": 854.00}}}
Only fields present in the primary file are compared; absent fields are
skipped, never filled from ShareSansar.

Standard library only. No dependencies.
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser

BASE = "https://www.sharesansar.com"
PAGES = {
    "market": BASE + "/market",
    "datewise_indices": BASE + "/datewise-indices",
    "today_share_price": BASE + "/today-share-price",
}
UA = "NepseDecode-crosscheck/1.0 (cross-check only; contact via repo)"
TIMEOUT_S = 20
MIN_SPACING_S = 5.0


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            if resp.status != 200:
                raise SystemExit(f"ABORT: {url} returned HTTP {resp.status}")
            return resp.read().decode("utf-8", "replace")
    except SystemExit:
        raise
    except Exception as exc:  # 403/429/transport: stop, never retry aggressively
        raise SystemExit(f"ABORT: fetch failed for {url}: {exc}")


def check_robots_allows() -> None:
    """Abort unless robots.txt still carries the empty Disallow seen 2026-10-31."""
    text = fetch(BASE + "/robots.txt")
    if "Disallow:" not in text:
        raise SystemExit("ABORT: robots.txt shape changed; re-review terms before fetching")
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Disallow:") and line[len("Disallow:"):].strip():
            raise SystemExit(f"ABORT: robots.txt now disallows a path ({line}); stop and re-review")


class _TableParser(HTMLParser):
    """Collect every <table> as a list of rows (lists of cell texts)."""

    def __init__(self):
        super().__init__()
        self.tables = []
        self._table = None
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None
        elif tag == "tr" and self._table is not None and self._row is not None:
            self._table.append(self._row)
            self._row = None
        elif tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _tables(page_html: str):
    parser = _TableParser()
    parser.feed(page_html)
    return parser.tables


def _num(cell: str):
    try:
        return float(cell.strip().replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _close_from_tables(tables, first_cell: str):
    """Header-driven Close lookup: header row must contain "Close"; the
    key column is the "Symbol" column when one exists (today-share-price
    leads with an "S.No" column), else column 0 (indices table). The
    data row's key cell must equal first_cell. None otherwise."""
    for table in tables:
        close_idx = None
        key_idx = 0
        for row in table:
            if not row:
                continue
            if close_idx is None:
                lowered = [c.lower() for c in row]
                if "close" in lowered:
                    close_idx = lowered.index("close")
                    key_idx = lowered.index("symbol") if "symbol" in lowered else 0
                continue
            if key_idx < len(row) and row[key_idx] == first_cell and close_idx < len(row):
                return _num(row[close_idx])
    return None


def extract_nepse_close(market_html: str):
    """NEPSE Index Close from the /market indices table (header: Index,
    Open, High, Low, Close, ... per wave-1 REPORT.md section 2, T1).
    None when the shape is not recognised -- a shape change is a signal
    to stop and re-verify, never a licence to guess.
    """
    return _close_from_tables(_tables(market_html), "NEPSE Index")


def extract_symbol_close(today_html: str, symbol: str):
    """One symbol's Close from today-share-price (header: Symbol, Conf.,
    Open, High, Low, Close, ... per wave-1 REPORT.md section 2, T3).
    None when the header or the row is not recognised.
    """
    return _close_from_tables(_tables(today_html), symbol)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--live", action="store_true", help="Actually fetch (default is dry-run)")
    ap.add_argument("--primary", required=True, help="Primary-source JSON file (authoritative)")
    ap.add_argument("--symbol", default=None, help="Optional single symbol to spot-check (e.g. ACLBSL)")
    ap.add_argument("--out", default="./sharesansar-crosscheck-log.json",
                    help="Internal discrepancy log path (must NOT be under any published data tree)")
    args = ap.parse_args()

    with open(args.primary, encoding="utf-8") as fh:
        primary = json.load(fh)

    urls = dict(PAGES)
    if args.symbol:
        urls["company"] = f"{BASE}/company/{args.symbol}"

    if not args.live:
        print("DRY RUN -- nothing fetched, nothing written.")
        print("Would fetch (in order, >=5 s apart):")
        for name, url in urls.items():
            print(f"  {name}: {url}")
        print("Would compare against primary file:", args.primary)
        print("Would write discrepancy log ONLY to:", args.out)
        print("ShareSansar figures would NEVER overwrite primary figures.")
        return 0

    print("CROSS-CHECK ONLY -- ShareSansar is not a primary source (see REPORT.md).")
    check_robots_allows()
    time.sleep(MIN_SPACING_S)

    pages = {}
    for name, url in urls.items():
        pages[name] = fetch(url)
        time.sleep(MIN_SPACING_S)

    discrepancies = []
    notes = []

    nepse_close = extract_nepse_close(pages["market"])
    if nepse_close is None:
        notes.append("market indices table shape not recognised; NEPSE close UNVERIFIED (not a mismatch)")
    elif "nepse_close" in primary and abs(nepse_close - float(primary["nepse_close"])) > 0.005:
        discrepancies.append({"field": "nepse_close", "sharesansar": nepse_close,
                              "primary": primary["nepse_close"],
                              "resolution": "primary source settles; investigate, do not adopt ShareSansar figure"})

    if args.symbol and "symbols" in primary and args.symbol in primary["symbols"]:
        want = primary["symbols"][args.symbol].get("close")
        got = extract_symbol_close(pages["today_share_price"], args.symbol)
        if got is None:
            notes.append(f"{args.symbol} row/close not recognised in today-share-price; UNVERIFIED (not a mismatch)")
        elif want is not None and abs(got - float(want)) > 0.005:
            discrepancies.append({"field": f"{args.symbol}.close", "sharesansar": got, "primary": want,
                                  "resolution": "primary source settles; investigate, do not adopt ShareSansar figure"})

    log = {
        "source": "sharesansar (CROSS-CHECK ONLY)",
        "as_of_primary": primary.get("as_of"),
        "pages_fetched": list(urls.values()),
        "discrepancies": discrepancies,
        "notes": notes,
        "warning": "Discrepancies are leads only. Never publish ShareSansar figures as site data.",
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=2, ensure_ascii=False)
    print(f"Wrote discrepancy log (internal only): {args.out}")
    print(f"Discrepancies: {len(discrepancies)}; notes: {len(notes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
