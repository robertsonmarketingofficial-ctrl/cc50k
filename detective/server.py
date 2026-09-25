"""Tiny local web server: the dashboard page plus a Server-Sent Events endpoint that streams the case."""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .core import Refused
from .investigate import investigate

STATIC = Path(__file__).parent / "static"
CACHE_SECONDS = 15 * 60


class App:
    def __init__(self, fetcher=None, demo=False):
        self.fetcher, self.demo = fetcher, demo
        self.cache, self.lock = {}, threading.Lock()


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "InternetDetective/0.1"

        def log_message(self, fmt, *args):
            pass

        def _send(self, code, body, ctype):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                             "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path in ("/", "/index.html"):
                return self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
            if u.path == "/api/health":
                return self._send(200, json.dumps({"ok": True, "demo": app.demo}), "application/json")
            if u.path == "/api/investigate":
                return self._stream(parse_qs(u.query))
            self._send(404, "Not found", "text/plain")

        def _event(self, name, payload):
            self.wfile.write(f"event: {name}\ndata: {json.dumps(payload)}\n\n".encode())
            self.wfile.flush()

        def _stream(self, qs):
            q, kind = (qs.get("q") or [""])[0], (qs.get("type") or ["auto"])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            key = (q.strip().lower(), kind)
            with app.lock:
                hit = app.cache.get(key)
            if hit and time.time() - hit[0] < CACHE_SECONDS:
                return self._event("done", dict(hit[1], cached=True))
            last = [0.0]
            wlock = threading.Lock()

            def update(case):
                t = time.monotonic()
                if t - last[0] < 0.15:
                    return
                last[0] = t
                with wlock:
                    try:
                        self._event("update", case.to_dict())
                    except OSError:
                        pass
            try:
                case = investigate(q, kind, fetcher=app.fetcher, on_update=update, demo=app.demo)
            except Refused as e:
                return self._event("refused", {"message": str(e)})
            except ValueError as e:
                return self._event("invalid", {"message": str(e)})
            result = case.to_dict()
            with app.lock:
                app.cache[key] = (time.time(), result)
            with wlock:
                self._event("done", result)

    return Handler


def serve(host="127.0.0.1", port=8787, demo=False, fetcher=None):
    if demo:
        from . import demo as demo_mod
        fetcher = demo_mod.fetcher
    httpd = ThreadingHTTPServer((host, port), make_handler(App(fetcher, demo)))
    return httpd
