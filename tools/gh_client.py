#!/usr/bin/env python3
"""Shared GitHub API client for deploy helpers (P0: SEE THE FAILURES).

Every request is logged: method, path, calling job step, attempt number,
HTTP status, response body (truncated), x-github-request-id, and the
x-ratelimit-* headers. Credentials are NEVER logged: authentication comes
from the dynamic_credentials surrogate and no Authorization header is ever
emitted or printed; Bearer tokens in logged text are redacted defensively.

Retry policy (the whole point):
  * Retryable, with exponential backoff + jitter: timeouts, connection
    errors, HTTP 5xx, HTTP 429 (honors Retry-After when present).
  * 4xx other than 429: NEVER retried — fail fast. The raised GhApiError
    carries the response body, request id and rate-limit headers, and its
    str() includes them, so every existing `fail(f"...: {e}")` call site
    now reports the exact failing call instead of a bare
    "HTTP Error 422: Unprocessable Entity".
  * One documented exception lives in the CALLER, not here: the parallel
    pusher retries tree-POST 422s ("input too large / request timed
    out" is transient on GitHub's side, proven 2026-10-14). The client
    itself never retries a 4xx.

Failure visibility for tail-based logs: on a terminal failure the client
prints a GH-CLIENT-FAILURE block as its LAST stderr output, so builders
that capture only the tail of a helper's output still see the exact call
plus body. job_summary() formats the per-run totals and every failure
for the job summary / alert.

Drop-in: api(method, path, data=None, step="", retries=2) mirrors the
old gh_api.api signature (full API path, e.g.
"/repos/OWNER/NAME/git/refs/heads/main"). `retries` counts EXTRA
attempts after the first (default 2 = 3 total); pass retries=0 for a
single attempt when the caller owns the retry loop (parallel pusher).

Thread-safe: the parallel pusher uploads blobs from 12 workers; logging
and the call record are lock-guarded.
"""
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

API_BASE = "https://api.github.com"
DEFAULT_TIMEOUT = 60
BODY_LOG_MAX = 2000      # chars of response body kept in logs/summary
BODY_SNIPPET_MAX = 300   # chars shown for successful responses
BACKOFF_BASE = 2.0
BACKOFF_CAP = 60.0
RETRY_AFTER_CAP = 120

_LOCK = threading.Lock()
_BEARER_RE = re.compile(r"(Bearer\s+)[^\s\"']+")


def _redact(text):
    if not text:
        return ""
    return _BEARER_RE.sub(r"\1[REDACTED]", text)


def _rate_limit(headers):
    out = {}
    if headers is None:
        return out
    for key in ("x-ratelimit-limit", "x-ratelimit-remaining",
                "x-ratelimit-reset", "x-ratelimit-used"):
        value = headers.get(key)
        if value is not None:
            out[key] = value
    return out


class GhApiError(Exception):
    """A GitHub API failure with everything needed to classify it.

    status: HTTP status int, or 0 for a network failure (timeout,
    connection error) after all retries. body: response body (truncated
    to BODY_LOG_MAX) or the network error text. request_id: the
    x-github-request-id header when GitHub supplied one.
    """

    def __init__(self, method, path, step, status, body, request_id=None,
                 rate_limit=None, attempts=1):
        self.method = method
        self.path = path
        self.step = step
        self.status = status
        self.body = body or ""
        self.request_id = request_id
        self.rate_limit = rate_limit or {}
        self.attempts = attempts
        super().__init__(self._format())

    def _format(self):
        if self.status:
            where = f"HTTP {self.status}"
        else:
            where = "network failure"
        rid = self.request_id or "n/a"
        return (f"GH API {self.method} {self.path} [{self.step}] -> "
                f"{where} (request {rid}, {self.attempts} attempt(s)): "
                f"{_redact(self.body[:1000])}")


class Client:
    """One GitHub API client; holds the per-run call record."""

    def __init__(self, log_file=None):
        self.calls = []
        self.log_file = log_file or os.environ.get("GH_CLIENT_LOG_FILE")

    def _emit(self, line):
        with _LOCK:
            print(line, file=sys.stderr, flush=True)
            if self.log_file:
                try:
                    with open(self.log_file, "a") as fh:
                        fh.write(line + "\n")
                except OSError:
                    pass

    def _record(self, entry):
        with _LOCK:
            self.calls.append(entry)

    def _backoff(self, attempt, retry_after=None):
        if retry_after is not None:
            try:
                wait = min(float(retry_after), RETRY_AFTER_CAP)
            except (TypeError, ValueError):
                wait = BACKOFF_BASE * (2 ** (attempt - 1))
        else:
            wait = BACKOFF_BASE * (2 ** (attempt - 1))
        return min(wait, BACKOFF_CAP) + random.uniform(0, 1)

    def request(self, method, path, data=None, step="", retries=2,
                timeout=DEFAULT_TIMEOUT):
        """Perform one GitHub API call with logging + retry policy.

        Returns the parsed JSON body (None for an empty body). Raises
        GhApiError on a 4xx (fail fast, no retry) or when retries are
        exhausted on a retryable error. The path is the FULL API path
        ("/repos/OWNER/NAME/..."); the surrogate credential is attached
        per attempt, never logged.
        """
        total = 1 + max(0, retries)
        last_error = None
        for attempt in range(1, total + 1):
            body = None
            headers = {"Accept": "application/vnd.github+json",
                       "User-Agent": "nepse-decode-gh-client/1.0"}
            if data is not None:
                headers["Content-Type"] = "application/json"
                body = json.dumps(data).encode()
            req = urllib.request.Request(API_BASE + path, data=body,
                                         headers=headers, method=method)
            add_surrogate_to_request(req, "custom.github",
                                     allowed_hosts=["api.github.com"])
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read()
                    status = resp.status
                    request_id = resp.headers.get("x-github-request-id")
                    rate_limit = _rate_limit(resp.headers)
                if not raw.strip():
                    parsed = None
                    snippet = ""
                else:
                    try:
                        parsed = json.loads(raw.decode("utf-8"))
                    except ValueError:
                        raise GhApiError(
                            method, path, step, status,
                            f"UNPARSABLE BODY: {raw[:500]!r}",
                            request_id, rate_limit, attempt)
                    snippet = raw.decode("utf-8", "replace")[:BODY_SNIPPET_MAX]
                entry = {"step": step, "method": method, "path": path,
                         "attempt": attempt, "status": status,
                         "request_id": request_id,
                         "rate_limit": rate_limit, "ok": True}
                self._record(entry)
                self._emit(
                    f"gh-client [{time.strftime('%H:%M:%S', time.gmtime())}Z] "
                    f"step={step} attempt={attempt}/{total} {method} {path} "
                    f"-> {status} request_id={request_id or 'n/a'} "
                    f"ratelimit_remaining={rate_limit.get('x-ratelimit-remaining', 'n/a')} "
                    f"body_len={len(raw)} body={_redact(snippet)!r}")
                return parsed
            except GhApiError:
                raise
            except urllib.error.HTTPError as e:
                raw_body = e.read().decode("utf-8", "replace")
                request_id = e.headers.get("x-github-request-id") \
                    if e.headers else None
                rate_limit = _rate_limit(e.headers)
                retryable = e.code == 429 or e.code >= 500
                entry = {"step": step, "method": method, "path": path,
                         "attempt": attempt, "status": e.code,
                         "request_id": request_id,
                         "rate_limit": rate_limit, "ok": False,
                         "body": raw_body[:BODY_LOG_MAX]}
                self._record(entry)
                self._emit(
                    f"gh-client [{time.strftime('%H:%M:%S', time.gmtime())}Z] "
                    f"step={step} attempt={attempt}/{total} {method} {path} "
                    f"-> HTTP {e.code} request_id={request_id or 'n/a'} "
                    f"ratelimit_remaining={rate_limit.get('x-ratelimit-remaining', 'n/a')} "
                    f"body={_redact(raw_body[:BODY_LOG_MAX])!r}")
                if not retryable or attempt == total:
                    entry["terminal"] = True
                    self._emit_failure_block(method, path, step, e.code,
                                             raw_body, request_id)
                    raise GhApiError(method, path, step, e.code, raw_body,
                                     request_id, rate_limit, attempt)
                retry_after = e.headers.get("Retry-After") \
                    if e.headers else None
                time.sleep(self._backoff(attempt, retry_after))
                last_error = e
            except (urllib.error.URLError, TimeoutError, ConnectionError,
                    OSError) as e:
                # Network failure (timeout, reset, RemoteDisconnected):
                # retryable. HTTPError is a URLError subclass, handled
                # above first — this branch never sees an HTTP status.
                entry = {"step": step, "method": method, "path": path,
                         "attempt": attempt, "status": 0,
                         "request_id": None, "rate_limit": {},
                         "ok": False, "body": str(e)[:500]}
                self._record(entry)
                self._emit(
                    f"gh-client [{time.strftime('%H:%M:%S', time.gmtime())}Z] "
                    f"step={step} attempt={attempt}/{total} {method} {path} "
                    f"-> NETWORK {type(e).__name__}: {str(e)[:300]}")
                if attempt == total:
                    entry["terminal"] = True
                    self._emit_failure_block(method, path, step, 0,
                                             str(e), None)
                    raise GhApiError(method, path, step, 0, str(e),
                                     None, {}, attempt)
                time.sleep(self._backoff(attempt))
                last_error = e
        # Unreachable: every path above returns or raises.
        raise GhApiError(method, path, step, 0, str(last_error), None, {},
                         total)

    def _emit_failure_block(self, method, path, step, status, body,
                            request_id):
        self._emit(
            "GH-CLIENT-FAILURE "
            f"method={method} path={path} step={step} status={status} "
            f"request_id={request_id or 'n/a'} "
            f"body={_redact(body[:BODY_LOG_MAX])!r}")

    def job_summary(self):
        """Per-run summary: totals plus every TERMINAL failure.

        Retried attempts that later succeeded are not failures: only the
        attempt that raised (terminal=True) is listed, so a flaky 500
        that recovered does not pollute the alert."""
        total = len(self.calls)
        failed = [c for c in self.calls if c.get("terminal")]
        lines = [f"gh-client job summary: {total} request(s), "
                 f"{len(failed)} terminal failure(s)"]
        for c in failed:
            body = _redact(c.get("body", "")[:BODY_LOG_MAX])
            lines.append(
                f"  FAIL {c['method']} {c['path']} [{c['step']}] "
                f"-> HTTP {c['status']} "
                f"(request {c.get('request_id') or 'n/a'}): {body!r}")
        return "\n".join(lines)


_DEFAULT = Client()


def api(method, path, data=None, step="", retries=2, timeout=DEFAULT_TIMEOUT):
    """Drop-in replacement for gh_api.api with logging + retry policy."""
    return _DEFAULT.request(method, path, data=data, step=step,
                            retries=retries, timeout=timeout)


def job_summary():
    return _DEFAULT.job_summary()


def print_summary():
    print(_DEFAULT.job_summary(), file=sys.stderr, flush=True)
