import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { FACILITIES, GADGETS, MISSION_TEXT, REP_TIERS, TIER_NAMES, UNLOCKS, WEAPONS, packCapacity, repTier } from "../game/catalog";
import { generateLevel } from "../game/facility";
import { drawMap } from "../game/render";
import type { Contract, FacilityId, GadgetId, IncidentReport, SaveGame, WeaponId } from "../game/types";
import { decodeExplored, facilityIntel, nightLabel } from "../game/world";

type Tab = "contracts" | "loadout" | "supplier" | "intel" | "records";
const TABS: { id: Tab; label: string }[] = [
  { id: "contracts", label: "Contracts" }, { id: "loadout", label: "Loadout" }, { id: "supplier", label: "Supplier" }, { id: "intel", label: "Intel" }, { id: "records", label: "Records" },
];

export default function Hub(props: { save: SaveGame; initialTab?: string; persist: (s: SaveGame) => SaveGame; onContract: (c: Contract) => void; onReport: (r: IncidentReport) => void; onMenu: () => void; onSettings: () => void }) {
  const { save } = props;
  const [tab, setTab] = useState<Tab>((props.initialTab as Tab) ?? "contracts");
  const tier = repTier(save.rep);
  const next = REP_TIERS[tier + 1];
  const affordable = UNLOCKS.filter(u => !save.owned.includes(u.id) && u.cost > 0 && u.rep <= tier && save.credits >= u.cost).length;
  const news = save.news.slice(-8).reverse();
  const go = (t: Tab) => { audio.play("ui"); setTab(t); };

  return (
    <div className="screen fade-in">
      <div className="hub">
        <header className="hub-top">
          <div className="hub-brand">Blacksite <span>·</span> Safehouse</div>
          <div className="label">{nightLabel(save.runs)}</div>
          <div className="hub-stats">
            <div className="stat"><span className="label">Credits</span><b>₵{save.credits.toLocaleString()}</b></div>
            <div className="stat" title={next ? `${next - save.rep} reputation to the next tier` : "Maximum tier"}>
              <span className="label">Reputation</span><b>{TIER_NAMES[tier]} <span className="dim2" style={{ fontSize: 12 }}>{next ? `${save.rep}/${next}` : save.rep}</span></b>
            </div>
            <div className="stat"><span className="label">Operations</span><b>{save.runs}</b></div>
            <button className="btn ghost small" onClick={props.onSettings}>Settings</button>
            <button className="btn ghost small" onClick={props.onMenu}>Menu</button>
          </div>
        </header>
        <div className="hub-body">
          <nav className="hub-nav" aria-label="Safehouse">
            {TABS.map(t => (
              <button key={t.id} className={"hub-tab" + (tab === t.id ? " on" : "")} onClick={() => go(t.id)} onMouseEnter={() => audio.play("uiHover")}>
                {t.label}
                {t.id === "supplier" && affordable > 0 && <span className="badge">{affordable}</span>}
                {t.id === "contracts" && save.contracts.some(c => c.story) && <span className="badge">!</span>}
              </button>
            ))}
          </nav>
          <main className="hub-main">
            {tab === "contracts" && <Contracts save={save} onPick={props.onContract} />}
            {tab === "loadout" && <LoadoutTab save={save} persist={props.persist} />}
            {tab === "supplier" && <Supplier save={save} persist={props.persist} />}
            {tab === "intel" && <Intel save={save} />}
            {tab === "records" && <Records save={save} onOpen={props.onReport} />}
          </main>
        </div>
        <footer className="ticker" aria-label="World news">
          <b>WORLD</b>
          <div style={{ overflow: "hidden", flex: 1 }}>
            <span className="ticker-track">{[...news, ...news].map((n, i) => <span key={i} style={{ marginRight: 48 }}>{n.text}</span>)}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Contracts({ save, onPick }: { save: SaveGame; onPick: (c: Contract) => void }) {
  return (
    <>
      <h2 className="h1">Contracts</h2>
      <p className="sub">Offers refresh after every operation. Facilities you've made nervous pay hazard rates, and they're more dangerous. Each contract is a single night.</p>
      <div className="grid3">
        {save.contracts.map(c => {
          const m = save.facilities[c.facility];
          const f = FACILITIES[c.facility];
          return (
            <article key={c.id} className={"card hover" + (c.story ? " story" : "")} onClick={() => onPick(c)} onMouseEnter={() => audio.play("uiHover")} tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") onPick(c); }}>
              <div className="between">
                <span className={"tag" + (c.story ? " amber" : "")}>{c.story ? "Lead" : MISSION_TEXT[c.type].label}</span>
                <span className="label">{f.short}</span>
              </div>
              <h3>{c.title}</h3>
              <div className="label" style={{ marginBottom: 6 }}>{c.client}</div>
              <p>{c.brief}</p>
              <div className="hr" />
              <div className="between">
                <div>
                  <div className="pay">₵{c.payout.toLocaleString()}</div>
                  <div className="label">+{c.rep} rep · {c.optionals.length} bonus objectives</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={"tag" + (m.heat >= 3 ? " red" : m.heat >= 1 ? " amber" : "")}>Security {m.heat}</div>
                  <div className="label" style={{ marginTop: 4 }}>{m.visits ? `Visited ${m.visits}×` : "Unknown site"}</div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function LoadoutTab({ save, persist }: { save: SaveGame; persist: (s: SaveGame) => SaveGame }) {
  const lo = save.loadout;
  const set = (patch: Partial<SaveGame["loadout"]>) => { audio.play("ui"); persist({ ...save, loadout: { ...lo, ...patch } }); };
  const toggleGadget = (g: GadgetId) => {
    const has = lo.gadgets.includes(g);
    let next = has ? lo.gadgets.filter(x => x !== g) : [...lo.gadgets, g];
    if (next.length > 2) next = next.slice(-2);
    set({ gadgets: next });
  };
  const primaries: (WeaponId | null)[] = [null, "smg", "shotgun"];
  return (
    <>
      <h2 className="h1">Operator · Wraith</h2>
      <p className="sub">The suppressed P9 always comes with you, plus two drones for recon. Pick one primary and two gadgets for slots 3 and 4. Consumables are restocked for free before every job.</p>
      <div className="label" style={{ margin: "8px 0" }}>Sidearm</div>
      <WeaponCard id="pistol" on disabled={false} onClick={() => {}} />
      <div className="label" style={{ margin: "22px 0 8px" }}>Primary</div>
      <div className="slots">
        {primaries.map(p => p === null ? (
          <button key="none" className={"slot" + (lo.primary === null ? " on" : "")} onClick={() => set({ primary: null })}>
            <h4>No primary</h4><p>Travel light. Nothing loud to reach for, so you won't.</p>
          </button>
        ) : (
          <WeaponCard key={p} id={p} on={lo.primary === p} disabled={!save.owned.includes(p)} onClick={() => set({ primary: p })} />
        ))}
      </div>
      <div className="label" style={{ margin: "22px 0 8px" }}>Gadgets, slots 3 and 4 <span className="dim2">({lo.gadgets.length}/2)</span></div>
      <div className="slots">
        {(Object.keys(GADGETS) as GadgetId[]).map(g => {
          const owned = save.owned.includes(g);
          const u = UNLOCKS.find(u => u.id === g);
          return (
            <button key={g} className={"slot" + (lo.gadgets.includes(g) ? " on" : "")} disabled={!owned} onClick={() => toggleGadget(g)}>
              <div className="between"><h4>{GADGETS[g].name}</h4><span className="kbd">{GADGETS[g].key}</span></div>
              <p>{GADGETS[g].desc}</p>
              <p className="dim2" style={{ marginTop: 6 }}>{owned ? (g === "thermal" ? "Recharging tool" : `${GADGETS[g].count} per mission`) : u?.hint ?? "Available from the supplier"}</p>
            </button>
          );
        })}
      </div>
      <div className="label" style={{ margin: "22px 0 8px" }}>Gear</div>
      <div className="slots">
        <button className={"slot" + (lo.armor ? " on" : "")} disabled={!save.owned.includes("armor")} onClick={() => set({ armor: !lo.armor })}>
          <h4>Soft armour vest</h4><p>150 health instead of 100. Plates rattle: sprinting is heard from further away.</p>
        </button>
        <button className={"slot" + (lo.pack ? " on" : "")} disabled={!save.owned.includes("pack")} onClick={() => set({ pack: !lo.pack })}>
          <h4>Field pack</h4><p>Carry {packCapacity(true)} units instead of {packCapacity(false)}. A full pack slows you down.</p>
        </button>
        <div className="slot on" style={{ cursor: "default" }}>
          <h4>Drones ×2</h4><p>Always carried. You start every job in the prep phase driving one. Guards shoot drones they spot.</p>
        </div>
        <div className={"slot" + (save.owned.includes("bypass") ? " on" : "")} style={{ cursor: "default", opacity: save.owned.includes("bypass") ? 1 : 0.35 }}>
          <h4>Bypass kit</h4><p>{save.owned.includes("bypass") ? "Always carried. Locks, terminals and safes go 2.5× faster." : "Not owned. Buy it from the supplier."}</p>
        </div>
      </div>
    </>
  );
}

function WeaponCard({ id, on, disabled, onClick }: { id: WeaponId; on: boolean; disabled: boolean; onClick: () => void }) {
  const w = WEAPONS[id];
  const bar = (v: number) => <div className="meter"><i style={{ width: `${Math.min(100, v * 100)}%` }} /></div>;
  return (
    <button className={"slot" + (on ? " on" : "")} disabled={disabled} onClick={onClick} style={{ maxWidth: id === "pistol" ? 460 : undefined }}>
      <h4>{w.name}</h4>
      <p>{disabled ? "Locked: available from the supplier." : w.desc}</p>
      <div className="stats-mini">
        <span>DAMAGE</span>{bar((w.damage * w.pellets) / 150)}
        <span>RATE</span>{bar(w.rate / 11)}
        <span>RANGE</span>{bar(w.range / 14)}
        <span>NOISE</span>{bar(w.noise / 18)}
      </div>
      {!disabled && <p className="amber" style={{ marginTop: 8, fontSize: 12.5 }}>{w.tradeoff}</p>}
    </button>
  );
}

function Supplier({ save, persist }: { save: SaveGame; persist: (s: SaveGame) => SaveGame }) {
  const tier = repTier(save.rep);
  const buy = (id: string, cost: number) => {
    if (save.credits < cost) return;
    audio.play("uiConfirm");
    const s = { ...save, credits: save.credits - cost, owned: [...save.owned, id] };
    if (id === "smg" && !s.loadout.primary) s.loadout = { ...s.loadout, primary: "smg" };
    if ((id === "emp" || id === "thermal") && s.loadout.gadgets.length < 2) s.loadout = { ...s.loadout, gadgets: [...s.loadout.gadgets, id as GadgetId] };
    persist(s);
  };
  return (
    <>
      <h2 className="h1">Supplier</h2>
      <p className="sub">Nothing here makes numbers go up. Everything here changes what you can attempt. Some things can't be bought: they have to be taken.</p>
      <div className="grid3">
        {UNLOCKS.filter(u => u.id !== "noisemaker").map(u => {
          const owned = save.owned.includes(u.id);
          const locked = u.rep > tier;
          return (
            <article key={u.id} className="card">
              <div className="between"><span className="tag">{u.kind}</span>{owned ? <span className="tag amber">Owned</span> : locked && u.cost > 0 ? <span className="tag">Tier {u.rep}: {TIER_NAMES[u.rep]}</span> : null}</div>
              <h3>{u.name}</h3>
              <p>{u.desc}</p>
              {u.hint && !owned && <p className="amber" style={{ fontSize: 13 }}>{u.hint}</p>}
              <div className="hr" />
              <div className="between">
                <div className="pay">{u.cost > 0 ? `₵${u.cost.toLocaleString()}` : "Not for sale"}</div>
                {!owned && u.cost > 0 && (
                  <button className="btn small primary" disabled={locked || save.credits < u.cost} onClick={() => buy(u.id, u.cost)}>
                    {locked ? "Locked" : save.credits < u.cost ? "Can't afford" : "Buy"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Intel({ save }: { save: SaveGame }) {
  const facs = (Object.keys(FACILITIES) as FacilityId[]).filter(f => f !== "blacksite" || save.story.includes("file"));
  const [sel, setSel] = useState<FacilityId>(facs[0]);
  const m = save.facilities[sel];
  const steps = [
    { flag: "manifest", label: "Kestrel transfer manifest", detail: "In Kestrel's executive safe." },
    { flag: "castell_rescued", label: "Dr. Imre Castell", detail: "Held at Halvorsen Site 4." },
    { flag: "file", label: "The ZERO HOUR file", detail: "On Meridian's servers." },
    { flag: "finale", label: "BLACKSITE ZERO", detail: "Where it all leads." },
  ];
  return (
    <>
      <h2 className="h1">Intel</h2>
      <p className="sub">Everything each facility knows about you, and everything you know about them. Rooms you've seen stay on your map between visits.</p>
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {facs.map(f => <button key={f} className={"btn small" + (f === sel ? " primary" : "")} onClick={() => { audio.play("ui"); setSel(f); }}>{FACILITIES[f].short}</button>)}
      </div>
      <div className="brief">
        <div>
          <FacilityMap save={save} facility={sel} />
          <p className="dim" style={{ fontSize: 14 }}>{FACILITIES[sel].blurb}</p>
        </div>
        <div>
          <div className="label">What they know · what you know</div>
          {facilityIntel(save, sel).map((l, i) => <div key={i} className={"intel-line " + (l.tone ?? "")}><i /><div><b>{l.label}.</b> <span className="dim">{l.detail}</span></div></div>)}
          <div className="hr" />
          <div className="between"><span className="label">Head of security</span><span className="dim">{m.chief.name} · {m.chief.status === "active" ? "unaware of you" : m.chief.status === "spared" ? `spared ${m.chief.spared}×` : m.chief.status}</span></div>
          <div className="between"><span className="label">Record</span><span className="dim mono">{m.extractions} clean · {m.failures} failed · {m.kills} killed · {m.kos} knocked out</span></div>
        </div>
      </div>
      <div className="hr" />
      <div className="label" style={{ marginBottom: 8 }}>Case board</div>
      <div className="grid3">
        {steps.map((st, i) => {
          const done = save.story.includes(st.flag);
          const current = !done && (i === 0 || save.story.includes(steps[i - 1].flag));
          return (
            <div key={st.flag} className={"card" + (current ? " story" : "")} style={{ opacity: done || current ? 1 : 0.4 }}>
              <div className="label">{done ? "Resolved" : current ? "Open lead" : "Unknown"}</div>
              <h3>{done || current ? st.label : "▇▇▇▇▇▇▇▇"}</h3>
              <p>{done || current ? st.detail : "Follow the previous lead."}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function FacilityMap({ save, facility, entrances }: { save: SaveGame; facility: FacilityId; entrances?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const m = save.facilities[facility];
    const L = generateLevel({ contract: { id: "intel", facility, type: "steal", title: "", client: "", brief: "", targetItem: "obj_prototype", payout: 0, rep: 0, optionals: [], seed: 1 }, memory: m, stash: save.stash, story: save.story });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const x = c.getContext("2d")!;
    const explored = m.blueprint ? new Uint8Array(L.w * L.h).fill(1) : decodeExplored(m.explored, L.w * L.h);
    // the outline of the building is always known from satellite imagery
    for (let i = 0; i < L.w * L.h; i++) if (L.tiles[i] === 4) explored[i] = 1;
    // ...including the outer walls and entrances
    for (let i = 0; i < L.w * L.h; i++) if ((L.tiles[i] === 2 || L.tiles[i] === 3) && [1, -1, L.w, -L.w].some(o => L.tiles[i + o] === 4)) explored[i] = 1;
    drawMap(x, L, explored, c.width, c.height, { entrances: entrances ?? true, routes: m.rota ? L.guards.map(g => g.route) : undefined });
  }, [save, facility, entrances]);
  return <div className="mapbox"><canvas ref={ref} /><span className="label">{FACILITIES[facility].name}</span></div>;
}

function Records({ save, onOpen }: { save: SaveGame; onOpen: (r: IncidentReport) => void }) {
  if (!save.reports.length) return (<><h2 className="h1">Records</h2><p className="sub">No incidents on file yet. Every operation, clean or not, ends up here.</p></>);
  return (
    <>
      <h2 className="h1">Records</h2>
      <p className="sub">Incident reports recovered from each facility's own systems. This is how they saw you.</p>
      <ul className="list">
        {save.reports.map(r => (
          <li key={r.number} className="between" style={{ cursor: "pointer" }} onClick={() => onOpen(r)} onMouseEnter={() => audio.play("uiHover")}>
            <span className="mono">#{String(r.number).padStart(5, "0")}</span>
            <span style={{ flex: 1, marginLeft: 16 }}>{r.contractTitle} <span className="dim2">· {r.facilityName}</span></span>
            <span className={"tag " + (r.outcome === "extracted" ? "amber" : r.outcome === "killed" ? "red" : "")}>{r.outcome === "extracted" ? "Clean" : r.outcome === "partial" ? "Partial" : r.outcome === "killed" ? "KIA" : "Aborted"}</span>
            <span className="mono dim" style={{ width: 90, textAlign: "right" }}>{r.credits >= 0 ? "+" : ""}₵{r.credits.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
