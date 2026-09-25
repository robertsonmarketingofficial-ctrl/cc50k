import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { GADGETS, LOOT, WEAPONS } from "../game/catalog";
import { Game, ZERO_HOUR } from "../game/engine";
import { drawMap, Renderer } from "../game/render";
import { findPath } from "../game/geom";
import type { Contract, EntranceId, GadgetId, MissionResult, SaveGame, Settings } from "../game/types";

interface Hud {
  clock: string; zeroIn: number; alert: number; objective: string; objDone: boolean; hp: number; maxHp: number; light: number; crouch: boolean; hidden: boolean;
  weapon: string; mag: number; res: number; reloading: boolean; gadgets: { id: GadgetId; n: number; key: string; name: string; cd?: number }[];
  prompt: Game["prompt"]; toast: string | null; radio: Game["radio"]; status: Game["status"]; invUsed: number; cap: number; sprint: boolean;
}

export default function GameView(props: { save: SaveGame; contract: Contract; entry: EntranceId; settings: Settings; onEnd: (r: MissionResult) => void; onSettings: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const rendRef = useRef<Renderer | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [paused, setPaused] = useState(false);
  const [overlay, setOverlay] = useState<null | "inv" | "map">(null);
  const [showHints, setShowHints] = useState(props.settings.hints);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const pausedRef = useRef(false); pausedRef.current = paused;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const mouse = useRef({ x: 0, y: 0 });
  const [, force] = useState(0);

  useEffect(() => {
    audio.ensure(); audio.startAmbience();
    const game = new Game(props.contract, props.save, props.entry, audio);
    gameRef.current = game;
    if (import.meta.env.DEV) { // automated QA hooks in dev builds only
      (window as any).__blacksite = game;
      (window as any).__bsPath = (sx: number, sy: number, gx: number, gy: number, c: number) => findPath(game.level, sx, sy, gx, gy, c as 0 | 1 | 2, 20000);
    }
    const r = new Renderer(canvas.current!, game, props.settings);
    rendRef.current = r;
    game.onEnd = res => props.onEnd(res);
    let raf = 0, last = performance.now(), hudT = 0, alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const w = r.toWorld(mouse.current.x, mouse.current.y);
      game.aimAt(w.x, w.y);
      if (!pausedRef.current) game.update(dt);
      audio.setListener(game.player.x, game.player.y);
      r.draw(pausedRef.current ? 0 : dt);
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.08; setHud(snapshot(game)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const hintT = setTimeout(() => setShowHints(false), 22000);
    return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(hintT); delete (window as any).__blacksite; };
  }, []);

  useEffect(() => { if (rendRef.current) rendRef.current.settings = props.settings; }, [props.settings]);

  // ------------------------------------------------------------------ input
  useEffect(() => {
    const g = () => gameRef.current!;
    const setKey = (e: KeyboardEvent, down: boolean) => {
      const game = g(); if (!game) return;
      const k = e.code;
      if (k === "Escape" && down) {
        if (overlayRef.current) { setOverlay(null); return; }
        setPaused(p => !p); setConfirmAbort(false); audio.play("ui"); return;
      }
      if (pausedRef.current) return;
      if ((k === "Tab" || k === "KeyI") && down) { e.preventDefault(); setOverlay(o => (o === "inv" ? null : "inv")); audio.play("ui"); return; }
      if (k === "KeyM" && down) { setOverlay(o => (o === "map" ? null : "map")); audio.play("ui"); return; }
      if (k === "Tab") e.preventDefault();
      const inp = game.input;
      switch (k) {
        case "KeyW": case "ArrowUp": inp.up = down; break;
        case "KeyS": case "ArrowDown": inp.down = down; break;
        case "KeyA": case "ArrowLeft": inp.left = down; break;
        case "KeyD": case "ArrowRight": inp.right = down; break;
        case "ShiftLeft": case "ShiftRight": game.player.sprint = down; break;
        case "KeyE": case "KeyF": if (down && !inp.interact) inp.interactPressed = true; inp.interact = down; break;
        case "KeyC": case "ControlLeft": if (down && !e.repeat) game.toggleCrouch(); if (k === "ControlLeft") e.preventDefault(); break;
        case "KeyR": if (down) game.reload(); break;
        case "Digit1": if (down) game.switchWeapon(0); break;
        case "Digit2": if (down) game.switchWeapon(1); break;
        case "KeyQ": if (down && !e.repeat) game.throwGadget("noisemaker"); break;
        case "KeyG": if (down && !e.repeat) game.throwGadget("emp"); break;
        case "KeyT": if (down && !e.repeat) game.throwGadget("thermal"); break;
        case "KeyH": if (down) setShowHints(v => !v); break;
      }
    };
    const kd = (e: KeyboardEvent) => setKey(e, true), ku = (e: KeyboardEvent) => setKey(e, false);
    const blur = () => { const game = g(); if (!game) return; Object.assign(game.input, { up: false, down: false, left: false, right: false, fire: false, interact: false }); game.player.sprint = false; if (game.status === "playing") setPaused(true); };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur); };
  }, []);

  const onMouseMove = (e: React.MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
  const onMouseDown = (e: React.MouseEvent) => {
    const game = gameRef.current; if (!game || pausedRef.current || overlayRef.current) return;
    if (e.button === 0) { game.input.fire = true; game.input.firePressed = true; }
    if (e.button === 2) game.throwGadget(game.player.gadgets.noisemaker ? "noisemaker" : "emp");
  };
  const onMouseUp = (e: React.MouseEvent) => { if (e.button === 0 && gameRef.current) gameRef.current.input.fire = false; };
  const onWheel = (e: React.WheelEvent) => { if (!pausedRef.current && Math.abs(e.deltaY) > 20) gameRef.current?.cycleWeapon(); };

  const game = gameRef.current;
  const h = hud;
  const hpSegs = h ? Math.round(h.maxHp / 10) : 10;
  return (
    <div className="game" onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onWheel} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvas} />
      {h && (
        <div className="hud">
          <div className="hud-tl">
            <div className="hud-clock">{h.clock}</div>
            <div className={"hud-zero" + (h.zeroIn < 90 ? " hot" : "")}>{h.zeroIn > 0 ? `ZERO HOUR IN ${fmt(h.zeroIn)}` : "ZERO HOUR · SECOND SHIFT ON SITE"}</div>
            <div className={"alert-tag a" + h.alert}>{["CALM", "CAUTION", "ALERT", "LOCKDOWN"][h.alert]}</div>
          </div>
          <div className="hud-tr">
            <div className={"hud-obj" + (h.objDone ? " done" : "")}>{h.objective}</div>
            {props.save.runs === 0 && !h.objDone && <div className="hud-hint">Explore to find it. Your map fills in as you go: press M.</div>}
          </div>
          <div className="radio" aria-live="polite">
            {h.radio.slice(-3).map((r, i) => <div key={r.t + ":" + i} className={"radio-line " + r.kind}><b>{r.kind === "overheard" ? `${r.from} (overheard)` : r.from}</b>{r.text}</div>)}
          </div>
          <div className="hud-bl">
            <div className="label">Health</div>
            <div className={"hp" + (h.hp / h.maxHp < 0.35 ? " low" : "")}>{Array.from({ length: hpSegs }, (_, i) => <i key={i} className={i < Math.ceil((h.hp / h.maxHp) * hpSegs) ? "" : "off"} />)}</div>
            <div className="vis"><span>{h.hidden ? "HIDDEN" : "VISIBILITY"}</span><div className="meter"><i style={{ width: `${h.hidden ? 0 : Math.round(h.light * 100)}%` }} /></div></div>
            <div className="stance">{h.hidden ? "IN LOCKER" : h.crouch ? "CROUCHED · SILENT" : h.sprint ? "SPRINTING · LOUD" : "STANDING"}{h.invUsed > 0 ? ` · PACK ${h.invUsed}/${h.cap}` : ""}</div>
          </div>
          <div className="hud-br">
            <div className="weapon">{h.weapon}</div>
            <div className={"ammo" + (h.reloading ? " reload" : "")}>{h.reloading ? "RELOADING" : <>{h.mag}<small> / {h.res}</small></>}</div>
            <div className="gadgets">
              {h.gadgets.map(gd => <div key={gd.id} className={"gadget" + (gd.n <= 0 || (gd.cd ?? 0) > 0 ? " empty" : "")}><span className="kbd">{gd.key}</span>{gd.name}{gd.id === "thermal" ? ((gd.cd ?? 0) > 0 ? ` ${Math.ceil(gd.cd!)}s` : "") : ` ×${gd.n}`}</div>)}
            </div>
          </div>
          <div className="hud-bc">
            {h.prompt && h.status === "playing" && (
              <div className={"prompt " + (h.prompt.tone ?? "")}>
                {h.prompt.key && <span className="kbd">{h.prompt.key}</span>}
                {h.prompt.hold ? "Hold · " : ""}{h.prompt.text}
                {(h.prompt.hold || h.prompt.progress > 0) && <span className="pbar"><i style={{ width: `${Math.min(100, h.prompt.progress * 100)}%` }} /></span>}
              </div>
            )}
            {h.toast && <div className="toast">{h.toast}</div>}
          </div>
          {showHints && h.status === "playing" && (
            <div className="controls-hint">
              <span><span className="kbd">WASD</span> move</span><span><span className="kbd">Shift</span> sprint</span><span><span className="kbd">C</span> crouch</span>
              <span><span className="kbd">E</span> interact / takedown</span><span><span className="kbd">Click</span> shoot</span><span><span className="kbd">Q</span> noisemaker</span>
              <span><span className="kbd">Tab</span> pack</span><span><span className="kbd">M</span> map</span><span><span className="kbd">Esc</span> pause</span><span className="dim2"><span className="kbd">H</span> hide hints</span>
            </div>
          )}
          {h.status === "extracted" && <div className="extract-banner"><h2>EXTRACTED</h2><p>Van moving. Compiling incident report…</p></div>}
          {h.status === "dead" && <div className="extract-banner"><h2 className="red">SIGNAL LOST</h2><p>Operative down. Everything you carried stays behind.</p></div>}
          {h.status === "aborted" && <div className="extract-banner"><h2>ABORTED</h2><p>Leaving empty-handed.</p></div>}
        </div>
      )}
      {overlay === "inv" && game && <Inventory game={game} contract={props.contract} onClose={() => setOverlay(null)} onChange={() => force(v => v + 1)} />}
      {overlay === "map" && game && <MapOverlay game={game} onClose={() => setOverlay(null)} rota={props.save.facilities[props.contract.facility].rota} />}
      {paused && (
        <div className="overlay" onMouseDown={e => e.stopPropagation()}>
          <div className="panel narrow">
            <div className="label">{game?.facilityName()} · {game?.clock()}</div>
            <h2 className="h1" style={{ margin: "6px 0 18px" }}>Paused</h2>
            {!confirmAbort ? (
              <div style={{ display: "grid", gap: 8 }}>
                <button className="btn primary" onClick={() => setPaused(false)} autoFocus>Resume</button>
                <button className="btn" onClick={props.onSettings}>Settings</button>
                <button className="btn" onClick={() => { setShowHints(true); setPaused(false); }}>Show controls</button>
                <button className="btn danger" onClick={() => setConfirmAbort(true)}>Abort mission</button>
              </div>
            ) : (
              <>
                <p className="dim">Aborting leaves everything you're carrying behind and fails the contract. The facility will remember tonight regardless.</p>
                <div style={{ display: "grid", gap: 8 }}>
                  <button className="btn danger" onClick={() => { setPaused(false); gameRef.current?.abort(); }}>Abort and leave</button>
                  <button className="btn ghost" onClick={() => setConfirmAbort(false)}>Keep going</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function snapshot(g: Game): Hud {
  const p = g.player, w = WEAPONS[p.weapon], a = p.ammo[p.weapon];
  return {
    clock: g.clock(), zeroIn: Math.max(0, (ZERO_HOUR - g.t) * 2), alert: g.alert, objective: g.objectiveText(), objDone: g.objectiveDone || g.hostageOk(),
    hp: p.hp, maxHp: p.maxHp, light: p.light, crouch: p.crouch, hidden: p.hidden >= 0, weapon: w.name, mag: a.mag, res: a.res, reloading: p.reloadT > 0,
    gadgets: (Object.keys(p.gadgets) as GadgetId[]).map(id => ({ id, n: p.gadgets[id] ?? 0, key: GADGETS[id].key, name: GADGETS[id].name, cd: id === "thermal" ? g.thermalCd : undefined })),
    prompt: g.prompt ? { ...g.prompt } : null, toast: g.toast && g.t - g.toast.t < 2.5 ? g.toast.text : null, radio: [...g.radio], status: g.status,
    invUsed: g.invUsed(), cap: p.cap, sprint: p.sprint && p.moving && !p.crouch,
  };
}
function fmt(s: number) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`; }

function Inventory({ game, contract, onClose, onChange }: { game: Game; contract: Contract; onClose: () => void; onChange: () => void }) {
  const p = game.player;
  const used = game.invUsed();
  const value = p.inv.reduce((s, id) => s + (LOOT[id]?.value ?? 0), 0);
  return (
    <div className="overlay" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="between"><h2 className="h1">Pack</h2><span className="label">The world keeps moving while you look · Tab to close</span></div>
        <div className="between" style={{ marginTop: 8 }}>
          <div><div className="label">Capacity</div><div className="cap">{Array.from({ length: p.cap }, (_, i) => <i key={i} className={i < used ? (used > p.cap * 0.5 ? "over" : "on") : ""} />)}</div></div>
          <div style={{ textAlign: "right" }}><div className="label">Street value</div><div className="pay">₵{value.toLocaleString()}</div></div>
        </div>
        {p.inv.length === 0 ? <p className="dim" style={{ margin: "18px 0" }}>Empty. Desks, lockers and safes are worth checking, if you have the time.</p> : (
          <div className="inv-grid">
            {p.inv.map((id, i) => {
              const d = LOOT[id];
              return (
                <div key={i} className={"inv-item" + (d.rare ? " rare" : "") + (id.startsWith("obj_") ? " obj" : "")}>
                  <div className="between"><b className="cond" style={{ fontSize: 15 }}>{d.name}</b><span className="label">{d.size}u</span></div>
                  <div className="dim" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>{d.desc}</div>
                  <div className="between">
                    <span className="mono">{id.startsWith("obj_") ? "CONTRACT" : `₵${d.value}`}</span>
                    {!id.startsWith("obj_") && <button className="btn ghost small" onClick={() => { game.dropItem(i); onChange(); }}>Drop</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="hr" />
        <div className="label" style={{ marginBottom: 6 }}>Bonus objectives</div>
        {contract.optionals.map(o => <div key={o.id} className="between dim" style={{ fontSize: 14, padding: "2px 0" }}><span>{o.label}</span><span className="mono">+₵{o.bonus}</span></div>)}
        <div className="hr" />
        <div className="between dim" style={{ fontSize: 13 }}>
          <span>Keycard: {p.clearance === 2 ? <span className="red">red</span> : p.clearance === 1 ? <span className="blue">blue</span> : "none"}</span>
          <span>{WEAPONS[p.weapon].name}</span>
        </div>
      </div>
    </div>
  );
}

function MapOverlay({ game, onClose, rota }: { game: Game; onClose: () => void; rota: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current; if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
      const L = game.level;
      const objIt = L.interactables.find(i => (i.kind === "objective" || i.kind === "chargeSite" || i.kind === "hostage" || i.kind === "evidence") && !i.done);
      const objKnown = objIt && game.explored[objIt.y * L.w + objIt.x];
      const hostile = game.radioOwned ? game.guards.filter(g => !g.down && g.radioAt > 0 && game.t - g.radioAt < 6).map(g => ({ x: g.x, y: g.y })) : [];
      drawMap(c.getContext("2d")!, L, game.explored, c.width, c.height, {
        player: game.player, objective: objKnown && objIt ? { x: objIt.x + 0.5, y: objIt.y + 0.5 } : null, t: game.t, entrances: true,
        routes: rota ? L.guards.map(g => g.route) : undefined, hostile,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="overlay" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div>
        <div className="between" style={{ marginBottom: 8 }}><span className="label">{game.facilityName()} · tactical map · live</span><span className="label">M to close</span></div>
        <div className="map-full">
          <canvas ref={ref} />
          <div className="map-legend">
            <span><i style={{ background: "#fff" }} />You</span><span><i style={{ background: "#f0c878" }} />Extraction</span>
            <span><i style={{ background: "#3f7dd6" }} />Blue lock</span><span><i style={{ background: "#c9372c" }} />Red lock</span>
            {rota && <span><i style={{ background: "#ffa050" }} />Patrol routes (leaked)</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
