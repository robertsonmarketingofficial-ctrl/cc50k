"""Campaign definitions (TOML files in campaigns/) and lead enrollment."""
from __future__ import annotations

import hashlib
import re
import sqlite3
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Variant:
    subject: str
    body: str


@dataclass
class Step:
    day: int                      # days after the first email
    variants: list[Variant]
    new_thread: bool = False      # False = reply in the same thread ("Re: ...")


@dataclass
class Campaign:
    name: str
    steps: list[Step]
    description: str = ""
    filters: dict = field(default_factory=dict)

    def edit_markers(self) -> list[str]:
        """[[PLACEHOLDERS]] left in the copy. Live sending refuses to run while any remain."""
        text = "\n".join(v.subject + "\n" + v.body for s in self.steps for v in s.variants)
        return sorted(set(re.findall(r"\[\[[^\]]+\]\]", text)))

    def variant_for(self, step_idx: int, lead_id: int) -> tuple[int, Variant]:
        variants = self.steps[step_idx].variants
        h = int(hashlib.sha1(f"{self.name}:{step_idx}:{lead_id}".encode()).hexdigest(), 16)
        i = h % len(variants)
        return i, variants[i]


def load_campaign(path: str | Path) -> Campaign:
    with open(path, "rb") as fh:
        data = tomllib.load(fh)
    steps = []
    for i, s in enumerate(data.get("steps", [])):
        if "variants" in s:
            variants = [Variant(v.get("subject", ""), v["body"]) for v in s["variants"]]
        else:
            variants = [Variant(s.get("subject", ""), s["body"])]
        if i == 0 and not all(v.subject for v in variants):
            raise ValueError(f"{path}: the first step needs a subject on every variant")
        steps.append(Step(day=int(s.get("day", 0)), variants=variants, new_thread=bool(s.get("new_thread", False))))
    if not steps:
        raise ValueError(f"{path}: campaign has no steps")
    if steps[0].day != 0 or any(b.day <= a.day for a, b in zip(steps, steps[1:])):
        raise ValueError(f"{path}: step days must start at 0 and strictly increase")
    return Campaign(
        name=data["name"], steps=steps, description=data.get("description", ""),
        filters=data.get("filters", {}),
    )


def register(conn: sqlite3.Connection, path: str | Path) -> Campaign:
    camp = load_campaign(path)
    conn.execute(
        "INSERT INTO campaigns (name, file) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET file=excluded.file",
        (camp.name, str(Path(path).resolve())),
    )
    conn.commit()
    return camp


def campaign_by_name(conn: sqlite3.Connection, name: str) -> tuple[int, Campaign]:
    row = conn.execute("SELECT id, file FROM campaigns WHERE name=?", (name,)).fetchone()
    if not row:
        raise KeyError(f"Unknown campaign {name!r}. Run: coldflow campaign add <file>")
    return row["id"], load_campaign(row["file"])


FILTER_COLUMNS = {"industry", "country", "city", "title", "source", "domain"}


def enroll(conn: sqlite3.Connection, name: str, limit: int | None = None, filters: dict | None = None) -> int:
    """Add fresh leads (status 'new', never enrolled anywhere) to a campaign."""
    cid, camp = campaign_by_name(conn, name)
    where, params = ["l.status='new'", "NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.lead_id=l.id)"], []
    for col, value in {**camp.filters, **(filters or {})}.items():
        if col not in FILTER_COLUMNS:
            raise ValueError(f"Can't filter on {col!r}; use one of {sorted(FILTER_COLUMNS)}")
        values = value if isinstance(value, list) else [value]
        where.append(f"LOWER(l.{col}) IN ({','.join('?' * len(values))})")
        params += [str(v).lower() for v in values]
    where.append("""NOT EXISTS (SELECT 1 FROM suppression s
                    WHERE (s.kind='email' AND s.value=l.email) OR (s.kind='domain' AND s.value=l.domain))""")
    sql = f"SELECT l.id FROM leads l WHERE {' AND '.join(where)} ORDER BY l.id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    ids = [r["id"] for r in conn.execute(sql, params)]
    conn.executemany("INSERT OR IGNORE INTO enrollments (campaign_id, lead_id) VALUES (?, ?)", [(cid, i) for i in ids])
    conn.executemany("UPDATE leads SET status='active' WHERE id=?", [(i,) for i in ids])
    conn.commit()
    return len(ids)
