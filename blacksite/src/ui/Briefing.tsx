import { useState } from "react";
import { audio } from "../game/audio";
import { FACILITIES, GADGETS, MISSION_TEXT, WEAPONS } from "../game/catalog";
import { favouriteEntrance } from "../game/facility";
import type { Contract, EntranceId, SaveGame } from "../game/types";
import { facilityIntel } from "../game/world";
import { FacilityMap } from "./Hub";

const ENTRANCES: { id: EntranceId; name: string; note: string }[] = [
  { id: "main", name: "Main entrance", note: "Floodlit front doors into reception, with a camera outside. Fast, exposed." },
  { id: "dock", name: "Loading dock", note: "Roller door left open for deliveries. Cover everywhere, and sightlines everywhere." },
  { id: "maint", name: "Maintenance hatch", note: "Unlit side door. Padlocked, so it takes a few seconds, but nobody watches it. Yet." },
];

export default function Briefing({ save, contract, persist, onBack, onDeploy }: { save: SaveGame; contract: Contract; persist: (s: SaveGame) => SaveGame; onBack: () => void; onDeploy: (c: Contract, e: EntranceId) => void }) {
  const m = save.facilities[contract.facility];
  const fav = favouriteEntrance(m);
  const [entry, setEntry] = useState<EntranceId>(m.lastEntry && !m.postedGuards.includes(m.lastEntry) ? m.lastEntry : "dock");
  const f = FACILITIES[contract.facility];
  const lo = save.loadout;
  void persist;
  const warnings = (e: EntranceId) => {
    const out: { text: string; tone: string }[] = [];
    const uses = m.entryUse[e];
    if (m.postedGuards.includes(e)) out.push({ text: "Guard posted inside because of your habits", tone: "red" });
    else if (m.extraCams.includes(e)) out.push({ text: "Camera installed after your last visits", tone: "amber" });
    if (m.chief.status === "spared" && fav === e) out.push({ text: `${m.chief.name} will be waiting here`, tone: "red" });
    if (uses >= 1 && !m.extraCams.includes(e)) out.push({ text: "You've used this recently. Keep it up and they'll notice", tone: "dim" });
    return out;
  };
  return (
    <div className="screen fade-in">
      <div className="hub-main" style={{ padding: "28px 7vw 40px" }}>
        <div className="between" style={{ marginBottom: 18 }}>
          <button className="btn ghost small" onClick={onBack}>← Contracts</button>
          <span className="label">Briefing · {contract.client}</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className={"tag" + (contract.story ? " amber" : "")}>{contract.story ? "Lead" : MISSION_TEXT[contract.type].label}</span>
          <span className="label">{f.name} · {f.place}</span>
        </div>
        <h2 className="h1" style={{ fontSize: 40, margin: "8px 0 6px" }}>{contract.title}</h2>
        <p className="sub" style={{ fontSize: 16 }}>{contract.brief}</p>
        <div className="brief">
          <div>
            <FacilityMap save={save} facility={contract.facility} />
            <div className="label" style={{ margin: "18px 0 8px" }}>Choose your way in</div>
            <div className="entry">
              {ENTRANCES.map(e => (
                <button key={e.id} className={entry === e.id ? "on" : ""} onClick={() => { audio.play("ui"); setEntry(e.id); }}>
                  <div className="between"><b>{e.name}</b>{m.entryUse[e.id] > 0 && <span className="label">used recently</span>}</div>
                  <div className="dim" style={{ fontSize: 13.5 }}>{e.note}</div>
                  {warnings(e.id).map((w, i) => <div key={i} className={w.tone} style={{ fontSize: 13, marginTop: 3 }}>▸ {w.text}</div>)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label">Intelligence</div>
            {facilityIntel(save, contract.facility).map((l, i) => <div key={i} className={"intel-line " + (l.tone ?? "")}><i /><div><b>{l.label}.</b> <span className="dim">{l.detail}</span></div></div>)}
            <div className="intel-line"><i /><div><b>Zero hour at 00:00.</b> <span className="dim">You go in at 23:47. At midnight the second shift arrives. Be gone by then, or don't be seen.</span></div></div>
            <div className="label" style={{ margin: "20px 0 6px" }}>Payment</div>
            <div className="between"><span>Contract</span><span className="pay">₵{contract.payout.toLocaleString()}</span></div>
            {contract.optionals.map(o => <div key={o.id} className="between dim" style={{ fontSize: 14, padding: "3px 0" }}><span>{o.label}</span><span className="mono">+₵{o.bonus}</span></div>)}
            <div className="dim2" style={{ fontSize: 13, marginTop: 6 }}>Anything else you carry out is yours to fence. If you don't make it, you lose what you're carrying.</div>
            <div className="label" style={{ margin: "20px 0 6px" }}>Loadout</div>
            <div className="dim" style={{ fontSize: 14 }}>
              {[lo.primary ? WEAPONS[lo.primary].name : null, WEAPONS[lo.secondary ?? "p226"].name, ...lo.gadgets.filter(g => save.owned.includes(g)).map(g => GADGETS[g].name), lo.armor && save.owned.includes("armor") ? "Armour" : null, save.owned.includes("bypass") ? "Bypass kit" : null].filter(Boolean).join(" · ")}
            </div>
            <div className="row" style={{ marginTop: 26, gap: 12 }}>
              <button className="btn primary" style={{ padding: "14px 30px", fontSize: 18 }} onClick={() => { audio.play("uiConfirm"); onDeploy(contract, entry); }} autoFocus>Deploy</button>
              <span className="dim2" style={{ fontSize: 13 }}>via {ENTRANCES.find(e => e.id === entry)!.name.toLowerCase()}</span>
            </div>
            {!save.seenTutorial && (
              <div className="card" style={{ marginTop: 22 }}>
                <div className="label">Field notes</div>
                <p>No prep phase: you go straight in. Press <span className="kbd">5</span> to throw a drone and scout, and click guards to mark them. Pick your gun in the Loadout tab. Stay out of sightlines, lean with <span className="kbd">Q</span>/<span className="kbd">E</span>, sneak behind guards and press <span className="kbd">F</span> to take them down. Aim at heads. Everything you do today will be remembered.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
