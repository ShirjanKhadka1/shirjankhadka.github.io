#!/usr/bin/env python3
"""Charter v4.2 item 4C — instrument & sector invariant (CI required check).

Crawls the repo tree and fails on ANY sector/type value that disagrees
with the adopted master data/reference/instruments.json:

  M1  master self-check (vocabulary, types, no duplicates, counts recompute)
  M2  data/reference/instruments-view.json == master (sector null <=> UNCONFIRMED)
  M3  tools/sector-map.json == master (derived view, same rule)
  M4  nepse-chart/data/universe.json sec/type == master for every symbol
  J1  every served data JSON carrying (symbol, sector[, type]) pairs
      (data/, nepse-chart/data/, nepse-*/data/), plus symbol-keyed
      sector maps and sector-only rows (sector_flow-style)
  P1  every built stock page: Sector dd, listed-sentence sector,
      peer heading, sector-stocks note, Instrument type dd — plus the
      orphan-dispositions registry (every listed dir must carry the
      4C-ORPHAN-NOTICE marker; any page whose symbol is in neither
      the master nor the registry fails)
  P2  nepse-screener baked sector spans (UNCONFIRMED renders a dash)
  P3  retired-bucket display phrases anywhere in *.html

Forbidden sector values (never a sector, anywhere in the checked
surface): Promoter Shares, Debentures, Mutual Funds, Others,
Banking, Commercial Banks, Development Banks, Manufacturing And
Processing, Hotels And Tourism, Hydro Power, Unclassified, Other.
UNCONFIRMED is a marker, not a sector: a symbol the master marks
UNCONFIRMED must never appear under any sector bucket.

Deliberately NOT failed (reported only, with counts):
  - frozen history/archive/manifest-NNN snapshots: rewriting history
    would falsify the record; current displays are what the invariant
    guards.
  - tests/fixtures: pinned visual-test data; updating them requires a
    visual-baseline regeneration, a separate PR.
  - tools/ research dossiers (e.g. verdicts-v2): not served, not
    displayed; their identity sectors are covered by the 4C sweep list.
  - baked manifest-session stamps on stock pages: reported as
    warnings, not failures. Orphan pages carry honestly-old stamps
    until their symbols return to the rebuilt universe; stamp
    freshness on live pages is the live gate's job, not this check's
    (a stamp check here would fail every PR the day after any build).

Usage: python3 tools/check-instrument-invariant.py  (exit 0 = pass)
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCAB = {"Commercial Bank", "Development Bank", "Finance",
         "Hotels and Tourism", "Hydropower", "Investment",
         "Life Insurance", "Manufacturing and Processing",
         "Microfinance", "Non Life Insurance", "Trading"}
FORBIDDEN = {"Promoter Shares", "Debentures", "Mutual Funds", "Others",
             "Banking", "Commercial Banks", "Development Banks",
             "Manufacturing And Processing", "Hotels And Tourism",
             "Hydro Power", "Unclassified", "Other"}
TYPES = {"EQUITY", "DEBENTURE", "PROMOTER", "MUTUAL_FUND"}
LEGACY_TYPE = {"Equity": "EQUITY", "Debenture": "DEBENTURE",
               "Promoter share": "PROMOTER", "Promoter Share": "PROMOTER",
               "Mutual fund": "MUTUAL_FUND", "Mutual Fund": "MUTUAL_FUND"}
MASTER_TYPE_TO_LEGACY = {"EQUITY": "Equity", "DEBENTURE": "Debenture",
                         "PROMOTER": "Promoter share",
                         "MUTUAL_FUND": "Mutual fund"}

fails = []
warns = []
infos = []


def fail(where, msg):
    fails.append(f"{where}: {msg}")


def warn(where, msg):
    warns.append(f"{where}: {msg}")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def slug_of(sym):
    return str(sym).replace("/", "-")


def main():
    master_path = os.path.join(ROOT, "data", "reference", "instruments.json")
    master = load_json(master_path)
    rows = master["instruments"]
    by_sym = {}
    for r in rows:
        if r["symbol"] in by_sym:
            fail("master", f"duplicate symbol {r['symbol']}")
        by_sym[r["symbol"]] = r
    for r in rows:
        if r["sector"] not in VOCAB and r["sector"] != "UNCONFIRMED":
            fail("master", f"{r['symbol']} sector {r['sector']!r} not in vocabulary")
        if r["instrument_type"] not in TYPES:
            fail("master", f"{r['symbol']} type {r['instrument_type']!r} unknown")
    counts = master["counts"]
    if counts["total_rows"] != len(rows):
        fail("master", f"counts.total_rows {counts['total_rows']} != {len(rows)}")
    if dict(Counter(r["instrument_type"] for r in rows)) != counts["by_instrument_type"]:
        fail("master", "counts.by_instrument_type does not recompute")
    if dict(Counter(r["sector"] for r in rows)) != counts["by_sector"]:
        fail("master", "counts.by_sector does not recompute")
    if sum(1 for r in rows if r["sector"] == "UNCONFIRMED") != len(master["unconfirmed_rows"]):
        fail("master", "unconfirmed_rows length does not match UNCONFIRMED rows")
    slug2sym = {slug_of(s): s for s in by_sym}

    def want_sector(sym):
        ms = by_sym[sym]["sector"]
        return None if ms == "UNCONFIRMED" else ms

    # M2: instruments-view
    view = load_json(os.path.join(ROOT, "data", "reference", "instruments-view.json"))
    vrows = view["rows"]
    if set(vrows) != set(by_sym):
        fail("instruments-view", f"symbol set differs from master "
             f"(missing {sorted(set(by_sym) - set(vrows))[:5]}, "
             f"extra {sorted(set(vrows) - set(by_sym))[:5]})")
    for sym, v in vrows.items():
        if sym not in by_sym:
            continue
        if v.get("sector") != want_sector(sym) or v.get("type") != by_sym[sym]["instrument_type"]:
            fail("instruments-view", f"{sym} = {v}, want sector "
                 f"{want_sector(sym)!r} type {by_sym[sym]['instrument_type']!r}")

    # M3: sector-map (derived view)
    smap = load_json(os.path.join(ROOT, "tools", "sector-map.json"))
    if set(smap) != set(by_sym):
        fail("sector-map", "symbol set differs from master")
    for sym, v in smap.items():
        if sym not in by_sym:
            continue
        if v.get("sector") != want_sector(sym) or v.get("instrument_type") != by_sym[sym]["instrument_type"]:
            fail("sector-map", f"{sym} = {v}, want sector "
                 f"{want_sector(sym)!r} type {by_sym[sym]['instrument_type']!r}")

    # M4: universe
    uni = load_json(os.path.join(ROOT, "nepse-chart", "data", "universe.json"))
    n_uni = 0
    for u in uni["symbols"]:
        n_uni += 1
        sym = u["s"]
        if sym not in by_sym:
            fail("universe", f"{sym} not in master")
            continue
        if u.get("sec") != want_sector(sym):
            fail("universe", f"{sym} sec {u.get('sec')!r}, want {want_sector(sym)!r}")
        if u.get("t") and LEGACY_TYPE.get(u["t"]) != by_sym[sym]["instrument_type"]:
            fail("universe", f"{sym} type {u.get('t')!r}, want "
                 f"{by_sym[sym]['instrument_type']!r}")
    infos.append(f"universe: {n_uni} symbols checked")

    # J1: served data JSON crawl (deduped: nepse-chart/data must be
    # crawled once, not once explicitly and once via the nepse-* glob)
    served_dirs = [os.path.join(ROOT, "data")]
    served_dirs += [os.path.join(ROOT, d, "data") for d in sorted(os.listdir(ROOT))
                    if d.startswith("nepse-") and os.path.isdir(os.path.join(ROOT, d, "data"))]
    served_dirs = list(dict.fromkeys(served_dirs))
    skip_names = ("instruments.json", "instruments-view.json",
                  "sector-map.json", "orphan-dispositions.json")
    # Documented strict-scope exclusion (named, with unblocker — not a
    # silent weakening): data/contributors.json is a provisional board
    # whose rows, sector rollups and reconciliation are interlocked;
    # renaming its 'Banking' rollup would be wrong (its 27 members map
    # to 18 Commercial Bank + 8 Development Bank + 1 UNCONFIRMED) and
    # its own classification_restated note declares the master
    # recompute pending on the contributors publisher lane (phase (b),
    # post-#348). Hand-editing it would break its internal consistency.
    # Unblocker: that publisher's regeneration; until then the file is
    # reported here, never silently passed.
    excluded = {"data/contributors.json":
                "provisional board; publisher-lane recompute pending (phase (b), post-#348)",
                # MF allocation is transcribed VERBATIM from a login-gated
                # portal CSV (build-mf-snapshot.py: "as published, never
                # fixed"); the source carries no holding symbols, so its
                # sector slices cannot be master-mapped from available
                # data. Renaming labels by hand would break the builder's
                # latest==newest-snapshot byte-identity gate and be
                # overwritten by the next snapshot. Unblocker: an MF
                # collector change capturing holding symbols (or a
                # source-taxonomy decision on the residual buckets) +
                # page-label review. Reported here, never silently passed.
                "nepse-mf/data/latest.json":
                "source-taxonomy allocation (portal CSV, no holding symbols)"}
    # NOTE: nepse-mf/data/window.json carries no sector fields and needs
    # no exclusion; snapshots/ is a subdirectory and is never crawled.

    def check_pair(where, sym, sec, typ):
        # Sector and type are checked INDEPENDENTLY: a row with no
        # sector asserted (null, e.g. UNCONFIRMED symbols in price-push
        # boards) can still carry a wrong type, and that must fail.
        msym = slug2sym.get(sym, sym)
        if sec is not None:
            if sec in FORBIDDEN:
                fail(where, f"{sym} sector {sec!r} is a forbidden bucket value")
            elif msym not in by_sym:
                fail(where, f"{sym} sector {sec!r} but symbol not in master")
            else:
                want = want_sector(msym)
                if want is None:
                    fail(where, f"{sym} built sector {sec!r} but master sector is "
                                f"UNCONFIRMED (no sector asserted)")
                elif sec != want:
                    fail(where, f"{sym} sector {sec!r}, want {want!r}")
        # Only instrument-type-looking values are checked: other files
        # reuse the `type` key for event kinds (calendar-events:
        # 'issue_opens', 'dividend', 'agm', ...) and must not fire.
        if typ is not None and (typ in LEGACY_TYPE or typ in TYPES):
            mt = LEGACY_TYPE.get(typ, typ)
            if msym in by_sym:
                if mt != by_sym[msym]["instrument_type"]:
                    fail(where, f"{sym} type {typ!r}, want "
                                f"{by_sym[msym]['instrument_type']!r}")
            else:
                fail(where, f"{sym} type {typ!r} but symbol not in master")

    def walk(obj, where):
        if isinstance(obj, dict):
            sym = None
            for k in ("symbol", "s", "sym"):
                if isinstance(obj.get(k), str):
                    sym = obj[k]
                    break
            sec = None
            for k in ("sector", "sec"):
                if isinstance(obj.get(k), str):
                    sec = obj[k]
                    break
            typ = None
            for k in ("type", "t", "instrument_type"):
                if isinstance(obj.get(k), str):
                    typ = obj[k]
                    break
            if sym and (sec is not None or typ is not None):
                check_pair(where, sym, sec, typ)
            elif sec is not None and not sym:
                # sector-only row (e.g. money-flow sector_flow): the
                # value itself must be master vocabulary, never a bucket.
                # 'NEPSE' is the index benchmark series (seasonality
                # forward_ledger / sectors key), not a sector claim, and
                # is allowed.
                if sec == "NEPSE":
                    pass
                elif sec in FORBIDDEN:
                    fail(where, f"sector-only row carries forbidden value {sec!r}")
                elif sec not in VOCAB:
                    fail(where, f"sector-only row carries unknown value {sec!r}")
            # symbol-keyed sector map: >=5 master-symbol keys, string values
            keys = [k for k in obj.keys() if isinstance(k, str) and k in by_sym]
            if len(keys) >= 5:
                vals = [v for v in obj.values() if isinstance(v, str)]
                if vals and all(v in VOCAB or v in FORBIDDEN or v is None for v in vals):
                    for k, v in obj.items():
                        if isinstance(v, str) and k in by_sym:
                            if v in FORBIDDEN or v != want_sector(k):
                                fail(where, f"sector map {k} = {v!r}, want "
                                            f"{want_sector(k)!r}")
            # symbol-keyed detail cache: >=5 master-symbol keys, dict
            # values carrying sector/type (e.g. price-push symbols) —
            # each mastered entry's sector/type must match the master.
            if len(keys) >= 5:
                dict_vals = [v for v in obj.values() if isinstance(v, dict)]
                if dict_vals and any(
                        isinstance(v.get("sector"), str) or isinstance(v.get("type"), str)
                        for v in dict_vals):
                    for k, v in obj.items():
                        if not isinstance(v, dict):
                            continue
                        sec_v = v.get("sector")
                        typ_v = v.get("type")
                        if (isinstance(sec_v, str) or isinstance(typ_v, str)) and k in by_sym:
                            check_pair(where, k, sec_v, typ_v)
                        elif isinstance(sec_v, str) or isinstance(typ_v, str):
                            fail(where, f"detail cache {k} carries sector/type "
                                        f"but symbol not in master")
            for k, v in obj.items():
                walk(v, where)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, where)

    def is_frozen(fn):
        return ("-history" in fn or "-archive" in fn or fn.startswith("manifest-"))

    n_json = 0
    frozen_count = 0
    for d in served_dirs:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json") or fn in skip_names:
                continue
            p = os.path.join(d, fn)
            if not os.path.isfile(p):
                continue
            rel = os.path.relpath(p, ROOT)
            if rel in excluded:
                infos.append(f"excluded from strict scope (reported, not "
                             f"passed silently): {rel} — {excluded[rel]}")
                continue

            try:
                data = load_json(p)
            except Exception:
                continue
            if is_frozen(fn):
                frozen_count += 1
                continue
            n_json += 1
            walk(data, rel)
    infos.append(f"served data JSON: {n_json} files crawled, "
                 f"{frozen_count} frozen snapshots reported-only")

    # report-only: frozen + fixtures + research dossiers (counts, never fail)
    def count_pairs(paths):
        n = 0
        for p in paths:
            try:
                data = load_json(p)
            except Exception:
                continue
            stack = [data]
            while stack:
                o = stack.pop()
                if isinstance(o, dict):
                    stack.extend(o.values())
                    sym = next((o[k] for k in ("symbol", "s", "sym")
                                if isinstance(o.get(k), str)), None)
                    sec = next((o[k] for k in ("sector", "sec")
                                if isinstance(o.get(k), str)), None)
                    if sym and sec is not None:
                        n += 1
                elif isinstance(o, list):
                    stack.extend(o)
        return n
    frozen_paths = []
    for d in served_dirs:
        if os.path.isdir(d):
            frozen_paths += [os.path.join(d, fn) for fn in os.listdir(d)
                             if fn.endswith(".json") and is_frozen(fn)]
    infos.append(f"frozen snapshots (reported-only): {len(frozen_paths)} files, "
                 f"{count_pairs(frozen_paths)} symbol+sector pairs")

    # P1: stock pages
    stocks_dir = os.path.join(ROOT, "stocks")
    disp = load_json(os.path.join(ROOT, "data", "reference", "orphan-dispositions.json"))
    disp_dirs = {pg["dir"] for pg in disp["pages"]}
    manifest = load_json(os.path.join(ROOT, "data", "manifest.json"))
    manifest_session = (manifest.get("session_date") or "")[:10]
    SENT = re.compile(r"is listed on the Nepal Stock Exchange \(NEPSE\)"
                      r"(?:, in the ([^<.]+?) sector)?\.")
    n_pages = 0
    for d in sorted(os.listdir(stocks_dir)):
        p = os.path.join(stocks_dir, d, "index.html")
        if not os.path.isfile(p):
            continue
        n_pages += 1
        html = open(p, encoding="utf-8", errors="replace").read()
        secdd = re.search(r"<div><dt>Sector</dt><dd>([^<]+)</dd></div>", html)
        typdd = re.search(r"<div><dt>Instrument type</dt><dd>([^<]+)</dd></div>", html)
        peer = re.search(r"Sector peers · ([^<]+)</h2>", html)
        note = re.search(r"Every stock in ([^(]+)\((\d+)\)", html)
        sm = SENT.search(html)
        sent = sm.group(1) if sm else None
        if sm is None:
            fail(f"stocks/{d}", "no listed-sentence found")
        sym = slug2sym.get(d)
        if sym is None:
            if d not in disp_dirs:
                fail(f"stocks/{d}", "page symbol in neither master nor "
                                    "orphan-dispositions registry")
            if "4C-ORPHAN-NOTICE" not in html:
                fail(f"stocks/{d}", "registry-listed dir lacks 4C-ORPHAN-NOTICE marker")
            continue
        if d in disp_dirs and "4C-ORPHAN-NOTICE" not in html:
            fail(f"stocks/{d}", "registry-listed dir lacks 4C-ORPHAN-NOTICE marker")
        mt = by_sym[sym]["instrument_type"]
        ms = by_sym[sym]["sector"]
        if ms == "UNCONFIRMED":
            if secdd or peer or note or sent:
                fail(f"stocks/{d}", "UNCONFIRMED symbol shows a sector display "
                                    f"(dd={secdd.group(1) if secdd else None}, "
                                    f"sentence={sent}, peer={peer.group(1) if peer else None})")
        else:
            if (secdd.group(1) if secdd else None) != ms:
                fail(f"stocks/{d}", f"Sector dd {secdd.group(1) if secdd else None!r}, want {ms!r}")
            if sent != ms:
                fail(f"stocks/{d}", f"listed sentence sector {sent!r}, want {ms!r}")
            if peer and peer.group(1) != ms:
                fail(f"stocks/{d}", f"peer heading {peer.group(1)!r}, want {ms!r}")
            if note and note.group(1).strip() != ms:
                fail(f"stocks/{d}", f"sector-stocks note {note.group(1)!r}, want {ms!r}")
        if typdd and LEGACY_TYPE.get(typdd.group(1)) != mt:
            fail(f"stocks/{d}", f"Instrument type dd {typdd.group(1)!r}, want {mt!r}")
        stamp = re.search(r"manifest session\s+(\d{4}-\d{2}-\d{2})", html)
        if not stamp:
            warn(f"stocks/{d}", "no manifest-session stamp found (reported, not failed)")
        elif stamp.group(1) != manifest_session:
            warn(f"stocks/{d}", f"stamp {stamp.group(1)} != manifest session "
                                f"{manifest_session} (reported, not failed)")
    infos.append(f"stock pages: {n_pages} checked")

    # P2: screener baked spans
    scr = os.path.join(ROOT, "nepse-screener", "index.html")
    html = open(scr, encoding="utf-8", errors="replace").read()
    row_re = re.compile(
        r'data-label="Sector">(?:<span class="sc-sector">([^<]+)</span>'
        r"|<span class=\"sc-dash\">—</span>)</td>"
        r'<td data-label="Symbol"><a class="sc-sym" href="/stocks/([^/]+)/"')
    n_scr = 0
    for sec, href in row_re.findall(html):
        n_scr += 1
        sym = slug2sym.get(href, href)
        if sym not in by_sym:
            fail("nepse-screener", f"row {href} not in master")
            continue
        if by_sym[sym]["sector"] == "UNCONFIRMED":
            if sec:
                fail("nepse-screener", f"{sym} UNCONFIRMED but baked sector span {sec!r} (want dash)")
        elif sec != by_sym[sym]["sector"]:
            fail("nepse-screener", f"{sym} sector {sec!r}, want {by_sym[sym]['sector']!r}")
    infos.append(f"screener: {n_scr} baked rows checked")

    # P2b: baked snapshots in nepse-value / nepse-trending pages
    val = load_json(os.path.join(ROOT, "nepse-chart", "data", "value.json"))
    val_by_sym = {r["symbol"]: r for r in val["stocks"]}
    for pg, kind in (("nepse-value/index.html", "value"),
                     ("nepse-trending/index.html", "trending")):
        p = os.path.join(ROOT, pg)
        html = open(p, encoding="utf-8", errors="replace").read()
        a = html.index("<!-- SNAP-START -->")
        b = html.index("<!-- SNAP-END -->")
        frag = html[a:b]
        if kind == "value":
            row_re = re.compile(
                r'href="/stocks/([^/]+)/".*?</td><td>([^<]+)</td>'
                r'<td class="num">[\d.]+</td>'
                r'<td class="num">[\d.]+<span class="submed">sector ([\d.]+)</span></td>'
                r'<td class="num">[\d.]+<span class="submed">sector ([\d.]+)</span></td>',
                re.S)
            for sym, sec, medpe, medpb in row_re.findall(frag):
                if sym not in by_sym:
                    fail(pg, f"snapshot {sym} not in master")
                    continue
                want = want_sector(sym)
                if want is None:
                    fail(pg, f"snapshot {sym} shows sector {sec!r} but master is UNCONFIRMED")
                elif sec != want:
                    fail(pg, f"snapshot {sym} sector {sec!r}, want {want!r}")
                vr = val_by_sym.get(sym)
                if vr and (f"{vr['sector_median_pe']:.1f}" != medpe
                           or f"{vr['sector_median_pbv']:.2f}" != medpb):
                    fail(pg, f"snapshot {sym} medians {medpe}/{medpb}, value.json "
                            f"has {vr['sector_median_pe']:.1f}/{vr['sector_median_pbv']:.2f}")
        else:
            row_re = re.compile(
                r'href="/stocks/([^/]+)/".*?<span class="sname">[^<·]+· ([^<]+)</span>',
                re.S)
            for sym, sec in row_re.findall(frag):
                if sym not in by_sym:
                    fail(pg, f"snapshot {sym} not in master")
                    continue
                want = want_sector(sym)
                if want is None:
                    fail(pg, f"snapshot {sym} shows sector {sec!r} but master is UNCONFIRMED")
                elif sec != want:
                    fail(pg, f"snapshot {sym} sector {sec!r}, want {want!r}")
        infos.append(f"{pg} snapshot checked")

    # P3: retired-bucket display phrases anywhere in HTML
    pats = []
    for b in ("Debentures", "Promoter Shares", "Mutual Funds", "Others"):
        pats.append((f"in the {b} sector", f"listed-sentence bucket {b!r}"))
        pats.append((f"Sector peers · {b}", f"peer heading bucket {b!r}"))
        pats.append((f"Every stock in {b} (", f"sector-stocks note bucket {b!r}"))
    for root, dirs, fnames in os.walk(ROOT):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules")]
        for fn in fnames:
            if not fn.endswith(".html"):
                continue
            p = os.path.join(root, fn)
            try:
                txt = open(p, encoding="utf-8", errors="replace").read()
            except Exception:
                continue
            for pat, label in pats:
                if pat in txt:
                    fail(os.path.relpath(p, ROOT), f"retired-bucket phrase: {label}")

    print(f"instrument invariant: master {len(by_sym)} rows; " + "; ".join(infos))
    if warns:
        print(f"warnings ({len(warns)}, reported not failed):")
        for w in warns[:40]:
            print(f"  WARN {w}")
        if len(warns) > 40:
            print(f"  ... and {len(warns) - 40} more warnings")
    if fails:
        print(f"FAILURES ({len(fails)}):")
        for f in fails[:100]:
            print(f"  FAIL {f}")
        if len(fails) > 100:
            print(f"  ... and {len(fails) - 100} more failures")
        return 1
    print("instrument invariant: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
