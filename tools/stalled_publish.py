#!/usr/bin/env python3
"""Shared stalled-publish record for script-first collectors (2026-10-29).

CONTRACT (failure-class 7): every collector archives its output locally
BEFORE attempting publish. If publish fails, the collector MUST leave a
VISIBLE stalled-publish record — a JSON file plus a loud
``STALLED-PUBLISH`` log line naming the archived output's path and the
session — and the NEXT run MUST pick that record up FIRST, before it
can claim success, with no duplicate publish.

No-duplicate rule: a stalled output is published at most once. The
pickup resolves a record as:
  - ``already-published``: its content hash (or trade-count/asof
    sentinel where a collector has no hash) already equals the last
    published value -> clear it, publish nothing.
  - ``covered-by-current``: its hash equals the new run's hash -> the
    new run's single publish covers it; clear on that publish's success.
  - ``published-stalled``: otherwise the stalled bytes are deployed
    first; on success the last-published marker advances to the stalled
    hash and the record clears.
  - ``retry-failed``: the stalled deploy failed again -> the record is
    KEPT and the run still attempts the current (newest) publish, so a
    persistently failing old payload never blocks fresh data; a
    successful current publish then clears the record as ``superseded``.
For full-snapshot collectors (performance, candles, broker-flow) the
newest output is a superset of the stalled one, so supersession is not
data loss: every trade/symbol in the stalled output is contained in
(or replaced by) the newer snapshot, and the supersession is logged.

This module only owns the record file. Each collector owns its deploy
call and wires record-on-failure + pickup-on-next-run around it; the
job runner (.sh) is never edited from this lane.
"""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta

NPT = timezone(timedelta(hours=5, minutes=45))


def content_hash(content_bytes):
    return hashlib.sha256(content_bytes).hexdigest()


def now_iso():
    return datetime.now(NPT).isoformat(timespec="seconds")


def record_stalled(path, archive_path, session, content_hash_value,
                   extra=None):
    """Write the stalled record + loud log line. Returns the record."""
    record = {
        "status": "STALLED",
        "created_at": now_iso(),
        "archive_path": archive_path,
        "session": session,
        "content_hash": content_hash_value,
    }
    if extra:
        record.update(extra)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(record, f, indent=1)
    print("STALLED-PUBLISH: publish failed; stalled record=%s "
          "archive=%s session=%s hash=%s"
          % (path, archive_path, session, (content_hash_value or "")[:16]),
          file=sys.stderr, flush=True)
    return record


def load_stalled(path):
    """Return the stalled record dict, or None (missing/corrupt -> None)."""
    try:
        with open(path) as f:
            record = json.load(f)
        return record if isinstance(record, dict) else None
    except Exception:
        return None


def clear_stalled(path, reason):
    """Delete the record file (both it and any sibling payload the caller
    tracks) and log the reason. Returns True if a record was cleared."""
    if not os.path.exists(path):
        return False
    try:
        os.remove(path)
    except OSError:
        pass
    print("STALLED-PUBLISH CLEARED (%s): %s" % (reason, path), flush=True)
    return True


def resolve_stalled(record, last_published_value, current_hash):
    """Classify a stalled record without side effects.

    last_published_value: the collector's last-published hash/sentinel.
    current_hash: this run's output hash (or None if not comparable).
    Returns one of: already-published | covered-by-current |
    publish-stalled | no-record.
    """
    if not record:
        return "no-record"
    stalled_hash = record.get("content_hash")
    if stalled_hash and last_published_value is not None \
            and str(stalled_hash) == str(last_published_value):
        return "already-published"
    if stalled_hash and current_hash and stalled_hash == current_hash:
        return "covered-by-current"
    return "publish-stalled"
