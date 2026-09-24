"""Checks MX, SPF, DKIM and DMARC for sending domains. Needs `pip install dnspython`."""
from __future__ import annotations

DKIM_SELECTORS = {"google": ["google"], "microsoft": ["selector1", "selector2"], "zoho": ["zmail", "zoho"]}


def _txt(resolver, name: str) -> list[str]:
    try:
        return [b"".join(r.strings).decode() for r in resolver.resolve(name, "TXT", lifetime=5)]
    except Exception:
        return []


def check_domain(domain: str, provider: str = "google") -> dict:
    try:
        import dns.resolver  # type: ignore
    except ImportError as exc:
        raise RuntimeError("dns-check needs dnspython: pip install dnspython") from exc
    res = dns.resolver.Resolver()
    out: dict = {"domain": domain}
    try:
        out["mx"] = sorted(str(r.exchange).rstrip(".") for r in res.resolve(domain, "MX", lifetime=5))
    except Exception:
        out["mx"] = []
    spf = [t for t in _txt(res, domain) if t.lower().startswith("v=spf1")]
    out["spf"] = spf[0] if spf else ""
    dmarc = [t for t in _txt(res, f"_dmarc.{domain}") if t.lower().startswith("v=dmarc1")]
    out["dmarc"] = dmarc[0] if dmarc else ""
    out["dkim"] = ""
    for sel in DKIM_SELECTORS.get(provider, ["google", "selector1", "default"]):
        recs = _txt(res, f"{sel}._domainkey.{domain}")
        if any("p=" in r for r in recs):
            out["dkim"] = sel
            break
        try:  # Microsoft publishes DKIM as CNAMEs
            res.resolve(f"{sel}._domainkey.{domain}", "CNAME", lifetime=5)
            out["dkim"] = sel
            break
        except Exception:
            pass
    problems = []
    if not out["mx"]:
        problems.append("no MX record (replies can't arrive)")
    if not out["spf"]:
        problems.append("no SPF record")
    elif out["spf"].count("include:") > 8:
        problems.append("SPF has many includes; watch the 10-lookup limit")
    if not out["dkim"]:
        problems.append("DKIM not found for the usual selectors")
    if not out["dmarc"]:
        problems.append("no DMARC record")
    out["problems"] = problems
    out["ok"] = not problems
    return out
