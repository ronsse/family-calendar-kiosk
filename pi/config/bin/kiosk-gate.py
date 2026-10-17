#!/usr/bin/env python3
"""Loopback gate: the only URL Chromium ever loads.

Chromium points at http://127.0.0.1:<port>/ instead of straight at the wall app
on homeserver. While the app answers, the gate 302s there and the wall behaves
exactly as if Chromium had gone there itself. While it does not, the gate serves
a local page -- a live clock plus the last-known-good screenshot -- instead of
Chromium's "This site can't be reached".

Why a gate and not the obvious alternatives (ADR-0003). The reasoning was
written against Home Assistant and survives the move to our own app unchanged,
because every premise is about the transport rather than about HA:
  * A file:// start page cannot 302 to the app and cannot load a runtime PNG
    without --allow-file-access-from-files.
  * A service worker caching the SPA is impossible here: the app is plain HTTP
    on a non-localhost origin, so the page is not a secure context and the SW
    registration is refused. (Our own app could send permissive frame headers
    where HA sent X-Frame-Options: SAMEORIGIN, but framing would not fix the
    secure-context problem, and it would hide the real URL from the snapshot
    script's DevTools check.)
  * A real reverse proxy would have to forward the SSE stream and the device
    token, coupling this disposable Pi to the app's transport details.

It also now carries the DEVICE TOKEN. `/api/wall/*` needs
`Authorization: Device <token>`, and the credential belongs on the Pi rather
than in HTML that anything on the LAN can fetch. The gate appends it to the
redirect as a URL FRAGMENT, which browsers never send to a server: it reaches
the bundle, and it reaches no access log. The bundle scrubs it out of the
address bar with history.replaceState on first paint.

Bind address is the guardrail: 127.0.0.1 only. This is a kid-facing wall, and
the gate is not a LAN service. Standard library only -- no pip on the Pi.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import quote

PORT = int(os.environ.get("KIOSK_GATE_PORT", "18765"))
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://homeserver:8124/")
DEVICE_TOKEN = os.environ.get("WALL_DEVICE_TOKEN", "").strip()
SHARE_DIR = os.environ.get("KIOSK_SHARE_DIR", os.path.expanduser("~/.local/share/kiosk"))
FALLBACK_HTML = os.environ.get("KIOSK_FALLBACK_HTML", os.path.join(SHARE_DIR, "fallback", "index.html"))
SNAPSHOT = os.environ.get("KIOSK_LAST_GOOD", os.path.join(SHARE_DIR, "last-good.png"))
# Overridable so the gate can be exercised off-Pi without installing anything.
PROBE = os.environ.get("KIOSK_PROBE", os.path.expanduser("~/.local/bin/kiosk-probe.sh"))

# Chromium's meta-refresh hits this every 30s while we are down; re-probing on
# every asset request would hammer the app as it comes back up.
_CACHE_SECONDS = 5.0
_last_probe = (0.0, False)


def redirect_target() -> str:
    """DASHBOARD_URL with the device token appended as a fragment parameter.

    A fragment and not a query string, on purpose: RFC 7231 has the browser keep
    the Location header's fragment, and a fragment is never put on the wire in
    the request that follows. So the token crosses from the Pi into the page
    without appearing in the app's access log, in a proxy's request line, or in
    any HTML the app serves to whoever else is on the LAN.

    An empty token yields a URL with no `dt=`. That is a supported state and a
    visible one: the wall renders the offline card, never a login form.

    The fragment ALSO carries this gate's own origin, as `gate=`. The page needs
    somewhere to ask for clock evidence and cannot know the port on its own: it is
    served by homeserver, while the gate is on this Pi's loopback at a port that
    `kiosk.env` may change. Baking the default into the web bundle would work
    until somebody moved it and then degrade in silence, which is the shape of
    failure this whole wall is written to avoid. Telling the page where the gate
    is means a moved port keeps working and a missing one is honestly absent.

    It is not a secret -- 127.0.0.1 and a port number -- and it rides the fragment
    only because there is already a fragment going the same way.
    """
    base, _, fragment = DASHBOARD_URL.partition("#")
    parts = [p for p in fragment.split("&")
             if p and not p.startswith("dt=") and not p.startswith("gate=")]
    parts.append("gate=" + quote("http://127.0.0.1:%d" % PORT, safe=""))
    if DEVICE_TOKEN:
        parts.append("dt=" + quote(DEVICE_TOKEN, safe=""))
    return base + "#" + "&".join(parts)


def dashboard_up() -> bool:
    global _last_probe
    now = time.monotonic()
    ts, value = _last_probe
    if now - ts < _CACHE_SECONDS:
        return value
    try:
        ok = subprocess.run([PROBE], timeout=10).returncode == 0
    except Exception:
        ok = False
    _last_probe = (now, ok)
    return ok


def render_fallback() -> bytes:
    try:
        with open(FALLBACK_HTML, "r", encoding="utf-8") as fh:
            html = fh.read()
    except OSError:
        # Last resort. If even the fallback file is gone the wall still must not
        # show a browser error, so serve something legible from memory.
        html = (
            "<!doctype html><meta charset=utf-8>"
            "<style>html,body{margin:0;height:100%;background:#101418;color:#fff;"
            "font:600 64px/1.3 system-ui,sans-serif;display:grid;place-items:center}</style>"
            "<meta http-equiv=refresh content=30>"
            "<div>Dashboard will come back on its own.</div>"
        )

    has_snapshot = os.path.isfile(SNAPSHOT) and os.path.getsize(SNAPSHOT) > 0
    if has_snapshot:
        saved = datetime.fromtimestamp(os.path.getmtime(SNAPSHOT)).strftime("%a %-I:%M %p")
    else:
        saved = ""

    html = html.replace("__HAS_SNAPSHOT__", "true" if has_snapshot else "false")
    html = html.replace("__SAVED_AT__", saved)
    return html.encode("utf-8")



# ---------------------------------------------------------------------------
# Clock evidence
# ---------------------------------------------------------------------------
#
# The wall alternates between an information board and a playful full-bleed picture, and a
# time box chooses. That gate FAILS CLOSED: unless the clock can be PROVEN right it shows the
# board, because this Pi 5 has NO hardware RTC and boots believing whatever the filesystem last
# remembered -- or 1970. Getting that wrong puts a picture on the wall at 6:00 AM on a school
# day, which is the prime invariant failing while looking bright and confident.
#
# The browser cannot read any of this itself, so the gate reports it. The gate is the right
# home rather than a new service for three reasons: it is ALREADY the loopback origin Chromium
# talks to, it already restarts forever, and it is already installed by setup.sh -- so this
# costs no new unit, no new port and no new thing to remember about a disposable Pi.
#
# **It answers with the network down**, which is the whole reason it beats the server-stamp
# evidence the wall falls back to. That is the post-power-cut case the time box exists for.
#
# Measured on this box rather than assumed (2026-08-26 and again 2026-08-27):
#
#   NTPSynchronized   `timedatectl show -p NTPSynchronized --value`. Backed by the kernel's
#                     STA_UNSYNC flag, so it is a real sync claim and not "holds a plausible
#                     date", which is what an RTC-less Pi has one second after power-on.
#   synced this boot  EXISTENCE of /run/systemd/timesync/synchronized. /run is tmpfs, so the
#                     marker CANNOT survive a reboot -- boot-scoped by construction, with no
#                     arithmetic and nothing to cache wrongly.
#   last sync         the OLDER of that marker's mtime and /var/lib/systemd/timesync/clock's.
#                     Neither is a documented API: `timedatectl timesync-status` carries no
#                     last-sync timestamp at all. Measured 25h after boot they were TEN MINUTES
#                     apart; measured again the next day, FOUR MILLISECONDS. So they are
#                     normally written together and can diverge, and taking the older is the
#                     conservative read -- guessing young fails OPEN, and this gate exists to
#                     fail closed.
#   floor             mtime of /var/lib/systemd/timesync/clock. timesyncd's own persistent
#                     floor, which it refuses to set the clock below at boot.
#
# Everything is re-read PER REQUEST. The staleness ceiling means the verdict flips with time,
# so a value read once at start is wrong by breakfast.

MARKER = "/run/systemd/timesync/synchronized"
CLOCK_FILE = "/var/lib/systemd/timesync/clock"


def _mtime_ms(path):
    """Epoch ms, or None. Never raises: a missing file is evidence, not an error."""
    try:
        return int(os.stat(path).st_mtime * 1000)
    except OSError:
        return None


def _ntp_synchronised():
    try:
        out = subprocess.run(
            ["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
            capture_output=True, text=True, timeout=3,
        )
        return out.stdout.strip() == "yes"
    except (OSError, subprocess.SubprocessError):
        # Cannot ask -> cannot claim. The wall reads a false here as "show the board", which
        # is the correct answer when the thing that would prove the clock is unavailable.
        return False


def clock_evidence():
    marker_ms = _mtime_ms(MARKER)
    clock_ms = _mtime_ms(CLOCK_FILE)
    candidates = [m for m in (marker_ms, clock_ms) if m is not None]
    return {
        "osSynchronised": _ntp_synchronised(),
        # Existence, not mtime. The file is in tmpfs; if it is there, a sync landed since boot.
        "syncedSinceBoot": marker_ms is not None,
        "lastSyncAtMs": min(candidates) if candidates else None,
        "nowMs": int(time.time() * 1000),
        "lastShutdownAtMs": clock_ms,
    }


class Gate(BaseHTTPRequestHandler):
    server_version = "kiosk-gate/1.0"

    def log_message(self, fmt, *args):  # noqa: A003 - silence per-request logging
        pass

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # Never let Chromium cache the gate itself, or a stale 302 outlives an outage.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/health":
            up = dashboard_up()
            body = b'{"dashboard":"up"}\n' if up else b'{"dashboard":"down"}\n'
            self._send(200, body, "application/json")
            return

        if path == "/clock":
            # CORS, because the page asking is served by the wall app on homeserver while this
            # endpoint is on the Pi's own loopback. The bind address is still 127.0.0.1, so
            # "*" here widens nothing that is reachable: nothing off this box can connect at
            # all, and the payload is five numbers about a clock -- no household data, no
            # token, nothing a child or a guest could not read off the screen anyway.
            body = (json.dumps(clock_evidence()) + "\n").encode("utf-8")
            self._send(200, body, "application/json", {"Access-Control-Allow-Origin": "*"})
            return

        if path == "/last-good.png":
            try:
                with open(SNAPSHOT, "rb") as fh:
                    body = fh.read()
            except OSError:
                self._send(404, b"no snapshot\n", "text/plain; charset=utf-8")
                return
            self._send(200, body, "image/png")
            return

        if path != "/":
            self._send(404, b"not found\n", "text/plain; charset=utf-8")
            return

        if dashboard_up():
            self._send(302, b"redirecting\n", "text/plain; charset=utf-8",
                       {"Location": redirect_target()})
            return

        self._send(200, render_fallback(), "text/html; charset=utf-8")


def main():
    os.makedirs(SHARE_DIR, exist_ok=True)
    HTTPServer(("127.0.0.1", PORT), Gate).serve_forever()


if __name__ == "__main__":
    main()
