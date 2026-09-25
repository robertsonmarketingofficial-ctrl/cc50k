"""Runs the collectors for one query in phases and reports progress after each source."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from . import collectors as C
from .core import Case, classify


def _run(case, net, name, fn, *args, on_update=None):
    case.cover(name, "running")
    if on_update:
        on_update(case)
    try:
        status, detail = fn(case, net, *args)
    except C.FetchError as e:
        status, detail = "failed", f"Couldn't reach the source ({e})"
    except Exception as e:  # a broken source must never sink the whole case
        status, detail = "failed", f"Unexpected response ({type(e).__name__})"
    case.cover(name, status, detail)
    if on_update:
        on_update(case)
    return status


def _parallel(case, net, jobs, on_update):
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda j: _run(case, net, j[0], j[1], *j[2:], on_update=on_update), jobs))


def domain_jobs(d):
    return [("Domain registry (RDAP)", C.rdap, d), ("DNS records", C.dns, d), ("Certificate logs", C.certificates, d),
            ("Internet Archive", C.wayback, d), ("Homepage", C.homepage, d)]


def investigate(raw: str, kind: str = "auto", fetcher=None, on_update=None, demo=False) -> Case:
    kind, q = classify(raw, kind)
    net = C.Net(fetcher or C.urllib_fetcher)
    case = Case(q, kind)
    case.demo = demo
    if kind == "domain":
        sld = q.split(".")[-2] if q.count(".") >= 1 else q
        _parallel(case, net, domain_jobs(q) + [
            ("Wikidata", C.wikidata, sld, "company", q),
            ("Hacker News", C.hn_mentions, q, True)], on_update)
        if case.wiki_title:
            _run(case, net, "Wikipedia", C.wikipedia, case.wiki_title, on_update=on_update)
    elif kind == "username":
        case.notes.append({"kind": "caution", "text": "Accounts with the same username on different sites are often different people. A match only counts as a link when the owner published it (a profile link or signed proof)."})
        _parallel(case, net, [(n, f, q) for n, f in C.USERNAME_COLLECTORS], on_update)
    else:
        want = {"company": "company", "person": "person"}.get(kind, "any")
        _run(case, net, "Wikidata", C.wikidata, q, want, on_update=on_update)
        found = bool(case.subject.get("source"))
        is_person = found and case.subject.get("type") == "person"
        if kind == "person" and not is_person:
            case.cover("Other sources", "skipped", "Only runs for public figures found in Wikidata")
            if not any(n["kind"] == "privacy" for n in case.notes):
                case.notes.append({"kind": "privacy", "text": "No public figure with this name was found, so no other sources were searched. This tool doesn't research private individuals."})
        else:
            # an unidentified name could belong to a private person: only the company registry is checked
            jobs = [("Hacker News", C.hn_mentions, case.subject["name"])] if found else []
            if case.wiki_title:
                jobs.append(("Wikipedia", C.wikipedia, case.wiki_title))
            if not is_person:
                jobs.append(("Legal-entity registry (GLEIF)", C.gleif, case.subject["name"] if found else q))
            if case.pivot_domain:
                jobs += domain_jobs(case.pivot_domain) if not is_person else [("Homepage", C.homepage, case.pivot_domain)]
            if not found:
                case.cover("Hacker News", "skipped", "Mentions are only searched once the name is identified")
            _parallel(case, net, jobs, on_update)
    case.finalise()
    if on_update:
        on_update(case)
    return case
