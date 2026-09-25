import { useEffect, useMemo, useState } from "react";
import { audio } from "../game/audio";
import type { IncidentReport, SaveGame } from "../game/types";

type Block = { kind: "h" | "meta" | "sec" | "ln" | "txt" | "cons" | "rule"; a?: string; b?: string; tone?: string };

export default function Report({ report: r, fresh, save, onContinue }: { report: IncidentReport; fresh: boolean; save: SaveGame; onContinue: () => void }) {
  const blocks = useMemo<Block[]>(() => {
    const b: Block[] = [];
    b.push({ kind: "meta", a: "FACILITY", b: r.facilityName.toUpperCase() });
    b.push({ kind: "meta", a: "DATE", b: r.date });
    b.push({ kind: "meta", a: "CLASSIFICATION", b: r.outcome === "killed" ? "INTRUSION · SUBJECT DECEASED" : r.response.startsWith("NONE") ? "POST-INCIDENT DISCOVERY" : "ACTIVE INTRUSION" });
    b.push({ kind: "meta", a: "SUBJECT", b: "UNIDENTIFIED" });
    b.push({ kind: "rule" });
    b.push({ kind: "sec", a: "SEQUENCE OF EVENTS" });
    for (const l of r.lines) b.push({ kind: "ln", a: l.t, b: l.text, tone: l.tone });
    b.push({ kind: "rule" });
    b.push({ kind: "sec", a: "PROPERTY RECOVERED BY SUBJECT" });
    if (!r.recovered.length) b.push({ kind: "txt", a: r.outcome === "killed" ? "NONE. ALL ITEMS RETAINED BY FACILITY." : "NONE REPORTED." });
    for (const it of r.recovered) b.push({ kind: "txt", a: `${it.name}${it.rare ? "  [FLAGGED]" : ""}`, b: it.value ? `EST. ₵${it.value.toLocaleString()}` : "", tone: it.rare ? "amber" : undefined });
    b.push({ kind: "sec", a: "SECURITY RESPONSE" });
    b.push({ kind: "txt", a: r.response, tone: r.response.includes("LOCKDOWN") ? "red" : undefined });
    b.push({ kind: "sec", a: "PERSONNEL" });
    b.push({ kind: "txt", a: r.casualties.kills || r.casualties.kos ? `${r.casualties.kills} FATALIT${r.casualties.kills === 1 ? "Y" : "IES"} · ${r.casualties.kos} INCAPACITATED` : "NO PERSONNEL HARMED" });
    if (r.consequences.length) {
      b.push({ kind: "rule" });
      b.push({ kind: "sec", a: "CORRECTIVE ACTIONS" });
      for (const c of r.consequences) b.push({ kind: "cons", a: c.text, b: c.cause });
    }
    return b;
  }, [r]);

  const [shown, setShown] = useState(fresh ? 0 : blocks.length);
  const done = shown >= blocks.length;
  useEffect(() => {
    if (done) { if (fresh) setTimeout(() => audio.play("stamp"), 150); return; }
    const blk = blocks[shown];
    const delay = blk.kind === "sec" || blk.kind === "rule" ? 260 : blk.kind === "cons" ? 520 : 150;
    const t = setTimeout(() => { setShown(s => s + 1); audio.play("typeTick"); }, delay);
    return () => clearTimeout(t);
  }, [shown, done]);
  useEffect(() => {
    const skip = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "Enter" || e.code === "Escape") { e.preventDefault(); if (!done) setShown(blocks.length); else if (e.code !== "Escape") onContinue(); } };
    window.addEventListener("keydown", skip); return () => window.removeEventListener("keydown", skip);
  }, [done]);

  const stamp = r.outcome === "extracted" ? { t: "EXTRACTED", c: "green" } : r.outcome === "partial" ? { t: "PARTIAL", c: "amber" } : r.outcome === "killed" ? { t: "SUBJECT DOWN", c: "red" } : { t: "ABORTED", c: "amber" };
  const mins = Math.floor(r.duration / 60), secs = Math.floor(r.duration % 60);
  return (
    <div className="screen report-wrap fade-in" onClick={() => !done && setShown(blocks.length)}>
      <div className="report" role="document">
        <div className="between"><h1>BLACKSITE INCIDENT REPORT</h1><span>#{String(r.number).padStart(5, "0")}</span></div>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#6b685e" }}>INTERNAL · DO NOT DISTRIBUTE · REVIEWED BY <span className="redact">XXXXXXXX</span></div>
        <hr className="rule" />
        {blocks.slice(0, shown).map((b, i) => {
          switch (b.kind) {
            case "meta": return <div key={i} className="meta"><span>{b.a}</span><span>{b.b}</span></div>;
            case "rule": return <hr key={i} className="rule" />;
            case "sec": return <div key={i} className="sec">{b.a}</div>;
            case "ln": return <div key={i} className={"ln " + (b.tone ?? "")}><span>{b.a}</span><span>{b.b?.toUpperCase()}</span></div>;
            case "txt": return <div key={i} className={"between " + (b.tone ? `ln ${b.tone}` : "")} style={{ display: "flex" }}><span>{b.a}</span><span>{b.b}</span></div>;
            case "cons": return <div key={i} className="consequence"><b>{b.a?.toUpperCase()}</b><small>Cause: {b.b}</small></div>;
          }
        })}
        {!done && <span className="cursor" />}
        <div className={"stamp " + stamp.c + (done ? " show" : "")}>{stamp.t}</div>
      </div>
      {done && (
        <div className="debrief" onClick={e => e.stopPropagation()}>
          <div className="between"><div className="label">OVERWATCH debrief</div><div className="label">{mins}m {String(secs).padStart(2, "0")}s on site</div></div>
          <div style={{ margin: "10px 0" }}>
            {r.breakdown.length === 0 && <div className="money-line"><span>No payment</span><span>₵0</span></div>}
            {r.breakdown.map((l, i) => <div key={i} className="money-line"><span>{l.label}</span><span className={l.amount < 0 ? "red" : ""}>{l.amount < 0 ? "−" : "+"}₵{Math.abs(l.amount).toLocaleString()}</span></div>)}
            <div className="money-line total"><span>Balance</span><span>₵{save.credits.toLocaleString()}</span></div>
            {r.rep > 0 && <div className="money-line"><span>Reputation</span><span>+{r.rep}</span></div>}
          </div>
          {r.unlocks.length > 0 && <div style={{ margin: "12px 0" }}>{r.unlocks.map((u, i) => <div key={i} className="unlock">{u}</div>)}</div>}
          {r.consequences.length > 0 && <p className="dim" style={{ fontSize: 14 }}>The facility has changed because of what you did. It'll be different next time you go back.</p>}
          {r.outcome === "killed" && <p className="dim" style={{ fontSize: 14 }}>You're alive: this was the operative OVERWATCH sent in your name. Your equipment is safe. Lie low, pick another contract, and they'll cool off.</p>}
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onContinue} autoFocus>{fresh ? "Back to the safehouse" : "Back to records"}</button>
        </div>
      )}
    </div>
  );
}
