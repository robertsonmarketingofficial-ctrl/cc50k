"""Tiny template language: {{field}} and {{field|fallback}}. Missing fields never leak braces."""
from __future__ import annotations

import json
import re
import sqlite3

# Fallbacks may contain tokens themselves: {{icebreaker|Saw you in {{city|your area}}.}}
# The fallback can't contain braces, so each pass resolves the innermost tokens first.
TOKEN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^{}]*))?\}\}")


def lead_context(lead: sqlite3.Row | dict, inbox: sqlite3.Row | dict | None, company: dict) -> dict:
    ctx = {k: lead[k] for k in lead.keys()} if not isinstance(lead, dict) else dict(lead)
    try:
        ctx.update(json.loads(ctx.pop("custom", "{}") or "{}"))
    except json.JSONDecodeError:
        pass
    ctx["company_name"] = company.get("name", "")
    ctx["website_url"] = company.get("website", "")
    if inbox is not None:
        from_name = inbox["from_name"]
        ctx["sender_name"] = from_name
        ctx["sender_first_name"] = from_name.split()[0] if from_name else ""
        ctx["sender_email"] = inbox["email"]
    return ctx


def render(text: str, ctx: dict) -> str:
    def sub(m: re.Match) -> str:
        value = ctx.get(m.group(1))
        if value is None or str(value).strip() == "":
            return (m.group(2) or "").strip()
        return str(value).strip()

    for _ in range(3):
        rendered = TOKEN.sub(sub, text)
        if rendered == text:
            break
        text = rendered
    return text


def missing_fields(text: str, ctx: dict) -> list[str]:
    """Fields used without a fallback that are empty for this lead."""
    return [
        m.group(1) for m in TOKEN.finditer(text)
        if m.group(2) is None and not str(ctx.get(m.group(1)) or "").strip()
    ]
