"""SQLite storage. One file holds leads, inboxes, campaigns, the send queue and events."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    company TEXT DEFAULT '',
    title TEXT DEFAULT '',
    website TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    city TEXT DEFAULT '',
    country TEXT DEFAULT '',
    custom TEXT DEFAULT '{}',
    source TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS suppression (
    value TEXT PRIMARY KEY,          -- an email address or a bare domain
    kind TEXT NOT NULL,              -- 'email' | 'domain'
    reason TEXT DEFAULT '',
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inboxes (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    from_name TEXT NOT NULL,
    domain TEXT NOT NULL,
    provider TEXT DEFAULT 'google',
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    username TEXT NOT NULL,
    password_env TEXT NOT NULL,      -- name of env var holding the app password
    auth TEXT NOT NULL DEFAULT 'password',  -- 'password' (app password) | 'oauth' (Microsoft XOAUTH2)
    daily_cap INTEGER NOT NULL DEFAULT 30,
    warmup_start TEXT NOT NULL,      -- ISO date warmup began
    status TEXT NOT NULL DEFAULT 'active',
    paused_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    file TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    inbox_id INTEGER REFERENCES inboxes(id),
    step INTEGER NOT NULL DEFAULT 0,            -- index of the next step to send
    next_send_date TEXT,                        -- NULL until first scheduled
    status TEXT NOT NULL DEFAULT 'pending',     -- pending|active|replied|bounced|unsubscribed|completed|stopped
    thread_message_id TEXT DEFAULT '',
    thread_subject TEXT DEFAULT '',
    UNIQUE (campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_enr_status ON enrollments(status, next_send_date);

CREATE TABLE IF NOT EXISTS sends (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    inbox_id INTEGER NOT NULL REFERENCES inboxes(id),
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    step INTEGER NOT NULL,
    variant INTEGER NOT NULL DEFAULT 0,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',      -- queued|sending|sent|failed|skipped
    attempts INTEGER NOT NULL DEFAULT 0,
    subject TEXT DEFAULT '',
    message_id TEXT DEFAULT '',
    error TEXT DEFAULT '',
    sent_at TEXT,
    UNIQUE (enrollment_id, step)
);
CREATE INDEX IF NOT EXISTS idx_sends_day ON sends(scheduled_for, status);

-- Where each inbox's IMAP sweep left off, so only new mail is read.
CREATE TABLE IF NOT EXISTS imap_state (
    inbox_id INTEGER PRIMARY KEY REFERENCES inboxes(id),
    uidvalidity INTEGER NOT NULL,
    last_uid INTEGER NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,                         -- reply|interested|not_interested|unsubscribe|bounce|auto_reply
    lead_id INTEGER REFERENCES leads(id),
    inbox_id INTEGER REFERENCES inboxes(id),
    source_message_id TEXT UNIQUE,
    from_addr TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    snippet TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


# Columns added after v1.0; older databases get them on first connect.
MIGRATIONS = [
    ("inboxes", "auth", "TEXT NOT NULL DEFAULT 'password'"),
    ("sends", "attempts", "INTEGER NOT NULL DEFAULT 0"),
]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, column, decl in MIGRATIONS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.commit()


def is_suppressed(conn: sqlite3.Connection, email: str) -> bool:
    email = email.lower()
    domain = email.rsplit("@", 1)[-1]
    row = conn.execute(
        "SELECT 1 FROM suppression WHERE (kind='email' AND value=?) OR (kind='domain' AND value=?)",
        (email, domain),
    ).fetchone()
    return row is not None


def suppress(conn: sqlite3.Connection, value: str, reason: str) -> None:
    value = value.strip().lower().lstrip("@")
    kind = "email" if "@" in value else "domain"
    conn.execute(
        "INSERT OR IGNORE INTO suppression (value, kind, reason) VALUES (?, ?, ?)",
        (value, kind, reason),
    )
