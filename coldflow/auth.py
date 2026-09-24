"""Inbox authentication: app passwords (env vars) or OAuth2/XOAUTH2 for Microsoft 365.

Microsoft is retiring password-based SMTP AUTH, so Microsoft inboxes should use `auth = oauth`.
One-time setup per inbox: `python -m coldflow auth login --email you@domain.com` (device-code
sign-in in any browser). Refresh tokens are kept in data/tokens.json (file mode 600) and renewed
automatically; they stay valid as long as the inbox is used at least every 90 days.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

MS_SCOPES = ("https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All "
             "offline_access")
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"


class AuthError(RuntimeError):
    pass


def _post(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:  # OAuth errors come back as 400 with a JSON body
        try:
            return json.loads(exc.read())
        except Exception:
            raise AuthError(f"HTTP {exc.code} from {url}") from exc


class TokenStore:
    """JSON file of {email: {refresh_token, access_token, expires_at}}."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def load(self) -> dict:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text() or "{}")

    def get(self, email: str) -> dict | None:
        return self.load().get(email.lower())

    def put(self, email: str, record: dict) -> None:
        with self._lock:
            data = self.load()
            data[email.lower()] = record
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2))
            os.chmod(tmp, 0o600)
            tmp.replace(self.path)


def _endpoints(ms_cfg: dict) -> tuple[str, str]:
    base = f"https://login.microsoftonline.com/{ms_cfg.get('tenant') or 'organizations'}/oauth2/v2.0"
    return f"{base}/devicecode", f"{base}/token"


def _client_id(ms_cfg: dict) -> str:
    cid = ms_cfg.get("client_id", "")
    if not cid:
        raise AuthError("Set [oauth_microsoft] client_id in coldflow.toml (see playbook/02_infrastructure_setup.md)")
    return cid


def _save_token(store: TokenStore, email: str, tok: dict, old_refresh: str = "", now=time.time) -> dict:
    record = {
        "refresh_token": tok.get("refresh_token") or old_refresh,
        "access_token": tok["access_token"],
        "expires_at": now() + int(tok.get("expires_in", 3600)),
    }
    store.put(email, record)
    return record


def device_login(email: str, ms_cfg: dict, store: TokenStore, post: Callable = _post,
                 log=print, sleep=time.sleep) -> None:
    """Interactive one-time sign-in. Sign in as `email` on the page it prints."""
    device_url, token_url = _endpoints(ms_cfg)
    cid = _client_id(ms_cfg)
    start = post(device_url, {"client_id": cid, "scope": MS_SCOPES})
    if "device_code" not in start:
        raise AuthError(start.get("error_description") or str(start))
    log(f"[{email}] {start.get('message') or 'Go to ' + start['verification_uri'] + ' and enter ' + start['user_code']}")
    interval = int(start.get("interval", 5))
    deadline = time.time() + int(start.get("expires_in", 900))
    while time.time() < deadline:
        sleep(interval)
        tok = post(token_url, {"grant_type": DEVICE_GRANT, "client_id": cid, "device_code": start["device_code"]})
        if "access_token" in tok:
            _save_token(store, email, tok)
            log(f"[{email}] signed in; token saved to {store.path}")
            return
        err = tok.get("error")
        if err == "slow_down":
            interval += 5
        elif err != "authorization_pending":
            raise AuthError(tok.get("error_description") or str(tok))
    raise AuthError("Sign-in timed out; run the command again.")


def access_token(email: str, ms_cfg: dict, store: TokenStore, post: Callable = _post, now=time.time) -> str:
    rec = store.get(email)
    if not rec or not rec.get("refresh_token"):
        raise AuthError(f"No OAuth token for {email}. Run: python -m coldflow auth login --email {email}")
    if rec.get("access_token") and rec.get("expires_at", 0) - 120 > now():
        return rec["access_token"]
    _, token_url = _endpoints(ms_cfg)
    tok = post(token_url, {"grant_type": "refresh_token", "client_id": _client_id(ms_cfg),
                           "refresh_token": rec["refresh_token"], "scope": MS_SCOPES})
    if "access_token" not in tok:
        raise AuthError(f"Token refresh failed for {email}: {tok.get('error_description') or tok}")
    return _save_token(store, email, tok, rec["refresh_token"], now)["access_token"]


def xoauth2(user: str, token: str) -> str:
    return f"user={user}\x01auth=Bearer {token}\x01\x01"


def secret_for(inbox, settings) -> str:
    """The app password, or a fresh OAuth access token, for this inbox."""
    if (inbox["auth"] or "password") == "oauth":
        return access_token(inbox["email"], settings.get("oauth_microsoft", {}), TokenStore(settings.path("tokens")))
    password = os.environ.get(inbox["password_env"])
    if not password:
        raise AuthError(f"env var {inbox['password_env']} is not set")
    return password


def smtp_login(server, inbox, secret: str) -> None:
    if (inbox["auth"] or "password") == "oauth":
        server.ehlo()
        # Initial response carries the token; on a challenge (error) reply with an empty line.
        server.auth("XOAUTH2", lambda challenge=None: "" if challenge else xoauth2(inbox["username"], secret))
    else:
        server.login(inbox["username"], secret)


def imap_login(imap, auth: str, username: str, secret: str) -> None:
    if auth == "oauth":
        imap.authenticate("XOAUTH2", lambda _: xoauth2(username, secret).encode())
    else:
        imap.login(username, secret)
