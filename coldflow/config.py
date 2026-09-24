"""Settings loading. All settings live in coldflow.toml (see coldflow.example.toml)."""
from __future__ import annotations

import copy
import tomllib
from pathlib import Path

DEFAULTS: dict = {
    "company": {
        "name": "Your Agency LLC",
        "physical_address": "123 Main St, Suite 100, City, ST 00000, USA",
        "website": "https://example.com",
        "sender_signature": "{{sender_first_name}}\n{{company_name}}",
    },
    "sending": {
        "timezone": "America/New_York",
        "window_start": "08:00",
        "window_end": "17:00",
        "sending_days": ["mon", "tue", "wed", "thu", "fri"],
        "min_delay_seconds": 120,
        "max_delay_seconds": 360,
        "max_per_company_domain_per_day": 2,
        "new_lead_share": 0.6,
        "unsubscribe_line": "Not the right fit? Reply \"no thanks\" and I won't reach out again.",
    },
    "warmup": {
        "warmup_only_days": 14,
        "ramp_start": 5,
        "ramp_step": 2,
        "default_daily_cap": 30,
    },
    "health": {
        "max_bounce_rate": 0.03,
        "max_unsubscribe_rate": 0.02,
        "min_sends_for_health": 40,
        "lookback_days": 7,
    },
    "leads": {
        "skip_role_accounts": True,
        "skip_free_mail": True,
        "allow_catch_all": False,
        "check_mx": False,
    },
    "paths": {
        "db": "data/coldflow.db",
        "outbox": "data/outbox",
        "reports": "reports",
    },
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


class Settings(dict):
    """dict of sections, with paths resolved relative to the config file."""

    root: Path

    def path(self, key: str) -> Path:
        p = Path(self["paths"][key])
        return p if p.is_absolute() else self.root / p


def load_settings(path: str | Path | None = None) -> Settings:
    cfg_path = Path(path) if path else Path("coldflow.toml")
    data: dict = {}
    if cfg_path.exists():
        with cfg_path.open("rb") as fh:
            data = tomllib.load(fh)
    settings = Settings(_merge(DEFAULTS, data))
    settings.root = cfg_path.resolve().parent
    return settings
