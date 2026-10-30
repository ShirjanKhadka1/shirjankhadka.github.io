#!/usr/bin/env python3
"""Unit tests for the publisher CLOSE-mode guards (gate-rules item a).

Pure-function tests: parse_tape, close_check, main_holds_todays_close,
close_open_prs_post_bell (with network helpers stubbed). No GitHub calls,
no clock dependence beyond a frozen npt_now.

Run: python3 tools/test-publish-intraday-gate.py
(The module under test must sit next to this file as
publish-intraday-batch.py; when run from ~/workspace/gate-rules the
work copy is used instead — see __main__ below.)
"""
import importlib.util
import json
import os
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone

# Stub dynamic_credentials so the module imports anywhere (its real
# implementation only matters for live GitHub calls, which tests never make).
stub = types.ModuleType("dynamic_credentials")
stub.add_surrogate_to_request = lambda req, *a, **k: None
stub.read_json_response = lambda r: json.loads(r.read().decode())
sys.modules.setdefault("dynamic_credentials", stub)

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [
    os.path.join(HERE, "publish-intraday-batch.py"),
    os.path.join(HERE, "tools_publish-intraday-batch.py"),
]
MOD_PATH = next((p for p in CANDIDATES if os.path.exists(p)), None)
assert MOD_PATH, f"publisher module not found next to {__file__}"
spec = importlib.util.spec_from_file_location("pub_gate", MOD_PATH)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

NPT = timezone(timedelta(hours=5, minutes=45))
FROZEN_NOW = datetime(2026, 10, 30, 15, 5, tzinfo=NPT)  # Fri, post-bell


def tape(market, session, asof_utc, n=200, close=None):
    d = {"asof": asof_utc, "market": market, "session_date": session,
         "quotes": [{"symbol": f"S{i}"} for i in range(n)]}
    if close is not None:
        d["close"] = close
    return json.dumps(d).encode()


class TestTapeGuards(unittest.TestCase):
    def setUp(self):
        self._orig_npt_now = pub.npt_now
        pub.npt_now = lambda: FROZEN_NOW

    def tearDown(self):
        pub.npt_now = self._orig_npt_now

    def test_parse_tape_full(self):
        t = pub.parse_tape(tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00", 348, True))
        self.assertEqual(t["market"], "CLOSED")
        self.assertEqual(t["session_date"], "2026-10-30")
        self.assertEqual(t["n_quotes"], 348)
        self.assertTrue(t["close"])

    def test_parse_tape_session_fallback(self):
        d = json.loads(tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00"))
        del d["session_date"]
        t = pub.parse_tape(json.dumps(d).encode())
        self.assertEqual(t["session_date"], "2026-10-30")  # asof NPT date

    def test_close_check_qualifies(self):
        staged = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00")
        main = tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)
        self.assertIsNone(pub.close_check(staged, main))

    def test_close_check_qualifies_over_intraday(self):
        staged = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00")
        main = tape("OPEN", "2026-10-30", "2026-10-30T08:45:00+00:00")
        self.assertIsNone(pub.close_check(staged, main))

    def test_close_check_open_rejected(self):
        staged = tape("OPEN", "2026-10-30", "2026-10-30T08:45:00+00:00")
        main = tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)
        r = pub.close_check(staged, main)
        self.assertIn("not CLOSED", r)

    def test_close_check_validated_close_wins(self):
        # THE essential guard: staged fetch-time asof (09:20Z) is LATER than
        # the validated close's session asof (09:15Z), so asof comparison
        # alone would wrongly let the provisional overwrite the validated.
        staged = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00")
        main = tape("CLOSED", "2026-10-30", "2026-10-30T09:15:00+00:00", close=True)
        r = pub.close_check(staged, main)
        self.assertIn("already holds today's close", r)

    def test_close_check_stale_session_rejected(self):
        staged = tape("CLOSED", "2026-10-29", "2026-10-30T09:20:00+00:00")
        main = tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)
        r = pub.close_check(staged, main)
        self.assertIn("session_date", r)

    def test_close_check_quote_floor(self):
        staged = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00", n=100)
        main = tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)
        r = pub.close_check(staged, main)
        self.assertIn("floor", r)

    def test_close_check_future_rejected(self):
        # Same NPT date as frozen now (15:05 NPT = 09:20Z) but 30 min in the
        # future, so the date guard passes and the clock-sanity guard fires.
        # (A 2099 asof would trip the date guard first — also rejected, but
        # that tests the wrong guard, so the future guard gets its own case
        # with a frozen datetime.now.)
        class _FrozenDT(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 10, 30, 9, 20, tzinfo=timezone.utc)
        orig = pub.datetime
        pub.datetime = _FrozenDT
        try:
            staged = tape("CLOSED", "2026-10-30", "2026-10-30T09:50:00+00:00")
            main = tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)
            r = pub.close_check(staged, main)
            self.assertIn("future", r)
        finally:
            pub.datetime = orig

    def test_close_check_identical_bytes(self):
        raw = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00")
        self.assertIn("equal main bytes", pub.close_check(raw, raw))

    def test_main_holds_todays_close(self):
        self.assertTrue(pub.main_holds_todays_close(
            tape("CLOSED", "2026-10-30", "2026-10-30T09:15:00+00:00", close=True)))
        self.assertFalse(pub.main_holds_todays_close(
            tape("OPEN", "2026-10-30", "2026-10-30T08:45:00+00:00")))
        self.assertFalse(pub.main_holds_todays_close(
            tape("CLOSED", "2026-10-29", "2026-10-29T09:15:00+00:00", close=True)))
        self.assertFalse(pub.main_holds_todays_close(b"not json"))

    def test_handoff_post_bell(self):
        open_raw = tape("OPEN", "2026-10-30", "2026-10-30T08:45:00+00:00")
        close_raw = tape("CLOSED", "2026-10-30", "2026-10-30T09:20:00+00:00")
        by_sha = {"sha-open": open_raw, "sha-close": close_raw}
        closed = []
        pub.get_branch_file = lambda sha, path: by_sha[sha]
        pub.close_pr = lambda pr: closed.append(pr["number"])
        try:
            prs = [{"number": 1, "head": {"sha": "sha-open"}},
                   {"number": 2, "head": {"sha": "sha-close"}}]
            standing = pub.close_open_prs_post_bell(prs)
            self.assertEqual([p["number"] for p in standing], [2])
            self.assertEqual(closed, [1])
        finally:
            del pub.get_branch_file, pub.close_pr

    def test_handoff_pre_bell_untouched(self):
        pub.npt_now = lambda: datetime(2026, 10, 30, 14, 0, tzinfo=NPT)
        calls = []
        pub.get_branch_file = lambda sha, path: (_ for _ in ()).throw(AssertionError("must not read"))
        pub.close_pr = lambda pr: calls.append(pr["number"])
        try:
            prs = [{"number": 1, "head": {"sha": "sha-open"}}]
            self.assertEqual(pub.close_open_prs_post_bell(prs), prs)
            self.assertEqual(calls, [])
        finally:
            del pub.get_branch_file, pub.close_pr


if __name__ == "__main__":
    unittest.main(verbosity=2)
