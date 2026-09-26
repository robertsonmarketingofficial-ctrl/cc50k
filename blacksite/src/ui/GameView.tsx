import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { GADGETS, LOOT, WEAPONS } from "../game/catalog";
import { Game, ZERO_HOUR } from "../game/engine";
import { findPath } from "../game/geom";
import { drawMap } from "../game/render";
import { FPRenderer } from "../game/render3d";
import { getAssets, loadAssets } from "../game/assets";
import type { Contract, EntranceId, GadgetId, MissionResult, SaveGame, Settings } from "../game/types";

const OPERATOR = "WRAITH";
const SENS = 0.0022;

interface Hud {
  clock: string; phase: "prep" | "action"; timer: number; zeroIn: number; alert: number; objective: string; objDone: boolean;
  hp: number; maxHp: number; light: number; crouch: boolean; hidden: boolean; lean: number;
  weapon: string; weaponId: string; mag: number; res: number; reloading: boolean; equipped: string;
  slots: { key: string; label: string; n?: number; on: boolean; dim: boolean }[];
  prompt: Game["prompt"]; toast: string | null; radio: Game["radio"]; status: Game["status"]; invUsed: number; cap: number; sprint: boolean; stamina: number;
  view: "operator" | "drone" | "camera"; viewLabel: string; feed: Game["feed"]; hit: Game["hitMarker"]; spread: number; ads: boolean;
  dmg: { rel: number; a: number }[]; watch: { rel: number; level: number; cam: boolean }[]; dronesLeft: number; feedsHacked: boolean; t: number;
}

type GameViewProps = { save: SaveGame; contract: Contract; entry: EntranceId; settings: Settings; onEnd: (r: MissionResult) => void; onSettings: () => void };

/** loads the real-world assets (models, scans, HDRI) once, then starts the mission */
export default function GameView(props: GameViewProps) {
  const [ready, setReady] = useState(!!getAssets());
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (ready) return; loadAssets(f => setPct(f)).then(() => setReady(true)).catch(() => setFailed(true)); }, [ready]);
  if (ready) return <GameViewInner {...props} />;
  return (
    <div className="screen boot"><div className="loading-assets">
      <div className="label">{failed ? "Couldn't load assets" : "Deploying"}</div>
      <div className="h1" style={{ fontSize: 28, margin: "8px 0 14px" }}>{failed ? "Check your connection and try again" : "Loading field assets"}</div>
      {!failed && <div className="load-bar"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
    </div></div>
  );
}

function GameViewInner(props: GameViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const rendRef = useRef<FPRenderer | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [paused, setPaused] = useState(false);
  const [overlay, setOverlay] = useState<null | "inv" | "map">(null);
  const [showHints, setShowHints] = useState(props.settings.hints);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [locked, setLocked] = useState(false);
  const [glError, setGlError] = useState(false);
  const pausedRef = useRef(false); pausedRef.current = paused;
  const overlayRef = useRef(overlay); overlayRef.current = overlay;
  const look = useRef({ yaw: 0, pitch: 0 });
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const [, force] = useState(0);
  const gadgets = props.save.loadout.gadgets.filter(g => props.save.owned.includes(g) && g !== "thermal") as GadgetId[];

  useEffect(() => {
    audio.ensure(); audio.startAmbience();
    const game = new Game(props.contract, props.save, props.entry, audio);
    gameRef.current = game;
    if (import.meta.env.DEV) { // automated QA hooks in dev builds only
      (window as any).__blacksite = game;
      (window as any).__bsPath = (sx: number, sy: number, gx: number, gy: number, c: number) => findPath(game.level, sx, sy, gx, gy, c as 0 | 1 | 2, 20000);
    }
    let r: FPRenderer;
    try { r = new FPRenderer(canvas.current!, game, props.settings); }
    catch { setGlError(true); return; }
    rendRef.current = r;
    if (import.meta.env.DEV) (window as any).__bsRender = r;
    look.current.yaw = game.viewpoint().angle;
    game.onEnd = res => { try { document.exitPointerLock?.(); } catch { /* ignore */ } props.onEnd(res); };
    let raf = 0, last = performance.now(), hudT = 0, alive = true, lastView = "";
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (import.meta.env.DEV && typeof (window as any).__look === "number") { look.current.yaw = (window as any).__look; if (typeof (window as any).__pitch === "number") look.current.pitch = (window as any).__pitch; }
      const vp = game.viewpoint();
      if (vp.kind !== lastView) { look.current.yaw = vp.angle; lastView = vp.kind; }
      // WASD relative to where you're looking
      const k = keys.current, yaw = look.current.yaw;
      const f = (k.w ? 1 : 0) - (k.s ? 1 : 0), s = (k.d ? 1 : 0) - (k.a ? 1 : 0);
      game.input.mvx = Math.cos(yaw) * f + Math.cos(yaw + Math.PI / 2) * s;
      game.input.mvy = Math.sin(yaw) * f + Math.sin(yaw + Math.PI / 2) * s;
      game.input.pitch = look.current.pitch;
      // aim point on the floor under the crosshair (for throws), otherwise far ahead
      const eye = vp.h, pch = look.current.pitch;
      const reach = pch < -0.06 ? Math.min(9, eye / Math.tan(-pch)) : 9;
      game.aimAt(vp.x + Math.cos(yaw) * reach, vp.y + Math.sin(yaw) * reach);
      if (!pausedRef.current) game.update(dt);
      audio.setListener(game.player.x, game.player.y);
      r.draw(pausedRef.current ? 0 : dt);
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.05; setHud(snapshot(game, look.current.yaw, gadgets)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const hintT = setTimeout(() => setShowHints(false), 26000);
    return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(hintT); r.dispose(); delete (window as any).__blacksite; };
  }, []);

  useEffect(() => { if (rendRef.current) rendRef.current.settings = props.settings; }, [props.settings]);

  // ------------------------------------------------------------------ pointer lock
  useEffect(() => {
    const onChange = () => {
      const isLocked = document.pointerLockElement === canvas.current;
      setLocked(isLocked);
      if (!isLocked && gameRef.current?.status === "playing" && !overlayRef.current) setPaused(true);
    };
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);
  const lock = () => {
    const c = canvas.current as any;
    try { const res = c?.requestPointerLock?.(); if (res && typeof res.catch === "function") res.catch(() => {}); } catch { /* not available: mouse still steers */ }
  };
  const resume = () => { setPaused(false); setConfirmAbort(false); lock(); };

  // ------------------------------------------------------------------ keyboard
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
      const inp = game.input, kk = keys.current;
      const viewingCams = game.camView >= 0;
      switch (k) {
        case "KeyW": case "ArrowUp": kk.w = down; break;
        case "KeyS": case "ArrowDown": kk.s = down; break;
        case "KeyA": case "ArrowLeft": if (viewingCams) { if (down) game.toggleCams(-1); } else kk.a = down; break;
        case "KeyD": case "ArrowRight": if (viewingCams) { if (down) game.toggleCams(1); } else kk.d = down; break;
        case "ShiftLeft": case "ShiftRight": game.player.sprint = down; break;
        case "KeyF": if (down && !inp.interact) inp.interactPressed = true; inp.interact = down; break;
        case "KeyQ": inp.leanL = down; break;
        case "KeyE": inp.leanR = down; break;
        case "KeyC": case "ControlLeft": if (down && !e.repeat) game.toggleCrouch(); if (k === "ControlLeft") e.preventDefault(); break;
        case "KeyR": if (down) game.reload(); break;
        case "Digit1": if (down) game.equip(1, gadgets); break;
        case "Digit2": if (down) game.equip(2, gadgets); break;
        case "Digit3": if (down) game.equip(3, gadgets); break;
        case "Digit4": if (down) game.equip(4, gadgets); break;
        case "Digit5": if (down && !e.repeat) game.toggleDrone(); break;
        case "KeyV": if (down && !e.repeat) game.toggleCams(0); break;
        case "KeyG": if (down && !e.repeat) { const q = gadgets.find(x => x !== "breach" && game.player.gadgets[x]); if (q) game.throwGadget(q); else game.sfx.play("denied"); } break;
        case "KeyT": if (down && !e.repeat) game.throwGadget("thermal"); break;
        case "KeyH": if (down) setShowHints(v => !v); break;
      }
    };
    const kd = (e: KeyboardEvent) => setKey(e, true), ku = (e: KeyboardEvent) => setKey(e, false);
    const blur = () => {
      const game = g(); if (!game) return;
      Object.assign(game.input, { fire: false, interact: false, leanL: false, leanR: false, ads: false });
      keys.current = { w: false, a: false, s: false, d: false };
      game.player.sprint = false; if (game.status === "playing") setPaused(true);
    };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur); };
  }, []);

  const onMouseMove = (e: React.MouseEvent) => {
    if (pausedRef.current || overlayRef.current) return;
    const lk = look.current;
    lk.yaw += e.movementX * SENS * (gameRef.current?.input.ads ? 0.6 : 1);
    lk.pitch = Math.max(-1.3, Math.min(1.3, lk.pitch - e.movementY * SENS * (gameRef.current?.input.ads ? 0.6 : 1)));
    if (rendRef.current) { rendRef.current.lookDelta.x += e.movementX; rendRef.current.lookDelta.y += e.movementY; }
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const game = gameRef.current; if (!game || pausedRef.current || overlayRef.current) return;
    if (!locked) lock();
    if (e.button === 0) { game.input.fire = true; game.input.firePressed = true; }
    if (e.button === 2) game.input.ads = true;
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const game = gameRef.current; if (!game) return;
    if (e.button === 0) game.input.fire = false;
    if (e.button === 2) game.input.ads = false;
  };
  const onWheel = (e: React.WheelEvent) => { if (!pausedRef.current && Math.abs(e.deltaY) > 20) { const g = gameRef.current; if (g) { g.equipped = "weapon"; g.cycleWeapon(); } } };

  const game = gameRef.current;
  const h = hud;
  if (glError) return (
    <div className="screen boot"><div className="errbox"><div className="label">Graphics unavailable</div><h2 className="h1" style={{ marginTop: 8 }}>WebGL couldn't start</h2>
      <p className="dim">This browser or device blocked 3D graphics. Try another browser, or turn on hardware acceleration in your browser settings.</p>
      <button className="btn primary" onClick={() => location.reload()}>Reload</button></div></div>
  );
  return (
    <div className={"game fp" + (h?.view === "drone" ? " v-drone" : h?.view === "camera" ? " v-cam" : "")} onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onWheel={onWheel} onContextMenu={e => e.preventDefault()}>
      <canvas ref={canvas} />
      <div className="fx-vignette" />
      {h && <div className={"fx-hurt"} style={{ opacity: Math.max(0, 1 - h.hp / h.maxHp) * 0.7 }} />}
      {h && h.alert === 3 && <div className="fx-lockdown" />}
      {h && props.settings.effects && <div className="fx-grain" />}
      {h && (
        <div className="hud">
          {/* round timer: Siege-style, top centre */}
          <div className="round">
            <div className="round-side left"><span className="mono">{h.clock.slice(0, 5)}</span><span className="label">Facility time</span></div>
            <div className={"round-timer" + (h.phase === "prep" ? " prep" : h.zeroIn < 90 ? " hot" : "")}>
              <div className="round-phase">{h.phase === "prep" ? "PREP PHASE" : h.zeroIn > 0 ? "ZERO HOUR IN" : "ZERO HOUR"}</div>
              <div className="round-time">{h.phase === "prep" ? fmt(h.timer) : h.zeroIn > 0 ? fmt(h.zeroIn) : "0:00"}</div>
            </div>
            <div className={"round-side right alert a" + h.alert}><span>{["CALM", "CAUTION", "ALERT", "LOCKDOWN"][h.alert]}</span><span className="label">Security</span></div>
          </div>
          <div className={"objective-ribbon" + (h.objDone ? " done" : "")}><b>{h.objDone ? "EXFIL" : "OBJECTIVE"}</b>{h.objective}</div>

          {/* kill feed */}
          <div className="killfeed">
            {h.feed.map((f, i) => <div key={f.t + ":" + i} className={"kf " + (f.tone ?? "")}>{f.text}{f.head && <span className="hs">◉</span>}</div>)}
          </div>

          {/* crosshair and markers */}
          {h.view === "operator" && h.status === "playing" && !h.hidden && (
            <div className={"crosshair" + (h.ads ? " ads" : "") + (h.equipped !== "weapon" ? " gadget" : "")} style={{ ["--gap" as any]: `${4 + h.spread * 18}px` }}>
              <i className="ch-t" /><i className="ch-b" /><i className="ch-l" /><i className="ch-r" /><i className="ch-dot" />
              {h.hit && h.t - h.hit.t < 0.25 && <div className={"hitmarker" + (h.hit.head ? " head" : "") + (h.hit.kill ? " kill" : "")}><i /><i /><i /><i /></div>}
            </div>
          )}
          <svg className="rings" viewBox="-100 -100 200 200" aria-hidden="true">
            {h.watch.map((w, i) => { const a = w.rel - Math.PI / 2; return <path key={"w" + i} d={arc(0, 0, 74, a - 0.22, a + 0.22)} className={w.level >= 1 ? "ring-red" : w.level > 0.5 ? "ring-orange" : "ring-amber"} style={{ opacity: 0.35 + w.level * 0.6 }} />; })}
            {h.dmg.map((d, i) => { const a = d.rel - Math.PI / 2; return <path key={"d" + i} d={arc(0, 0, 60, a - 0.3, a + 0.3)} className="ring-dmg" style={{ opacity: d.a }} />; })}
          </svg>

          {/* view modes */}
          {h.view === "drone" && (
            <div className="viewframe drone">
              <div className="vf-tl">DRONE 0{(game?.droneIdx ?? 0) + 1} · LIVE</div>
              <div className="vf-tr">{h.phase === "prep" ? <>Press <span className="kbd">Space</span> to breach</> : <><span className="kbd">5</span> back to operator</>}</div>
              <div className="vf-box" />
              <div className="vf-bl"><span className="kbd">WASD</span> drive · <span className="kbd">Click</span> mark guard · guards will shoot drones they spot</div>
            </div>
          )}
          {h.view === "camera" && (
            <div className="viewframe cam">
              <div className="vf-tl"><span className="rec">● REC</span> {h.viewLabel}</div>
              <div className="vf-tr"><span className="kbd">A</span>/<span className="kbd">D</span> switch · <span className="kbd">V</span> exit</div>
              <div className="vf-bl"><span className="kbd">Click</span> mark guard · feed is looped: they can't see you on it</div>
            </div>
          )}

          <div className="radio fp-radio" aria-live="polite">
            {h.radio.slice(-3).map((r, i) => <div key={r.t + ":" + i} className={"radio-line " + r.kind}><b>{r.kind === "overheard" ? `${r.from} (overheard)` : r.from}</b>{r.text}</div>)}
          </div>

          {/* operator card */}
          <div className="opcard">
            <div className="op-portrait"><span>{OPERATOR.slice(0, 2)}</span></div>
            <div className="op-body">
              <div className="op-name">{OPERATOR}<span className="label">{h.hidden ? "IN LOCKER" : h.lean ? (h.lean < 0 ? "LEAN L" : "LEAN R") : h.crouch ? "CROUCHED" : h.sprint ? "SPRINTING" : "STANDING"}</span></div>
              <div className={"op-hp" + (h.hp / h.maxHp < 0.35 ? " low" : "")}><b>{Math.ceil(h.hp)}</b><div className="op-bar"><i style={{ width: `${(h.hp / h.maxHp) * 100}%` }} /></div></div>
              <div className="vis stam"><span>STAMINA</span><div className="meter"><i style={{ width: `${Math.round(h.stamina * 100)}%`, background: h.stamina < 0.3 ? "#e8574a" : undefined }} /></div></div>
              <div className="vis"><span>{h.hidden ? "HIDDEN" : "LIGHT"}</span><div className="meter"><i style={{ width: `${h.hidden ? 0 : Math.round(h.light * 100)}%` }} /></div>{h.invUsed > 0 && <span className="mono">PACK {h.invUsed}/{h.cap}</span>}</div>
            </div>
          </div>

          {/* weapon + slots */}
          <div className="wpn">
            <div className="wpn-name">{h.equipped === "weapon" ? h.weapon : GADGETS[h.equipped as GadgetId]?.name}</div>
            {h.equipped === "weapon"
              ? <div className={"wpn-ammo" + (h.reloading ? " reload" : h.mag === 0 ? " empty" : "")}>{h.reloading ? "RELOADING" : <>{h.mag}<small>{h.res}</small></>}</div>
              : <div className="wpn-ammo gadget">{h.slots.find(s => s.on)?.n ?? 0}<small>LEFT</small></div>}
            <div className="slots-row">
              {h.slots.map(s => <div key={s.key} className={"slot-chip" + (s.on ? " on" : "") + (s.dim ? " dim" : "")}><span className="kbd">{s.key}</span>{s.label}{s.n !== undefined && <em>{s.n}</em>}</div>)}
            </div>
          </div>

          <div className="hud-bc fp-bc">
            {h.prompt && h.status === "playing" && h.view === "operator" && (
              <div className={"prompt " + (h.prompt.tone ?? "")}>
                {h.prompt.key && <span className="kbd">{h.prompt.key === "E" ? "F" : h.prompt.key}</span>}
                {h.prompt.hold ? "Hold · " : ""}{h.prompt.text}
                {(h.prompt.hold || h.prompt.progress > 0) && <span className="pbar"><i style={{ width: `${Math.min(100, h.prompt.progress * 100)}%` }} /></span>}
              </div>
            )}
            {h.toast && <div className="toast">{h.toast}</div>}
          </div>


          {showHints && h.status === "playing" && (
            <div className="controls-hint">
              <span><span className="kbd">WASD</span> move</span><span><span className="kbd">Mouse</span> look</span><span><span className="kbd">Click</span> shoot</span><span><span className="kbd">RMB</span> aim</span>
              <span><span className="kbd">Q</span>/<span className="kbd">E</span> lean</span><span><span className="kbd">C</span> crouch</span><span><span className="kbd">F</span> interact · takedown</span>
              <span><span className="kbd">3</span> breach charge</span><span><span className="kbd">5</span> drone</span><span><span className="kbd">V</span> hacked cams</span><span><span className="kbd">G</span> throw</span>
              <span><span className="kbd">Tab</span> pack</span><span><span className="kbd">M</span> map</span><span className="dim2"><span className="kbd">H</span> hide</span>
            </div>
          )}
          {!locked && !paused && h.status === "playing" && <div className="click-to-play">Click to take control</div>}
          {h.status === "extracted" && <div className="extract-banner"><h2>EXTRACTED</h2><p>Van moving. Compiling incident report…</p></div>}
          {h.status === "dead" && <div className="extract-banner"><h2 className="red">OPERATIVE DOWN</h2><p>Everything you carried stays behind.</p></div>}
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
                <button className="btn primary" onClick={resume} autoFocus>Resume</button>
                <button className="btn" onClick={props.onSettings}>Settings</button>
                <button className="btn" onClick={() => { setShowHints(true); resume(); }}>Show controls</button>
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

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
}

function snapshot(g: Game, yaw: number, gadgets: GadgetId[]): Hud {
  const p = g.player, w = WEAPONS[p.weapon], a = p.ammo[p.weapon];
  const vp = g.viewpoint();
  const rel = (ang: number) => ang - yaw;
  const cam = g.camView >= 0 ? g.level.cameras[g.camView] : null;
  const slots: Hud["slots"] = [];
  p.weapons.forEach((wid, i) => slots.push({ key: String(i + 1), label: WEAPONS[wid].short, on: g.equipped === "weapon" && p.weapon === wid, dim: false }));
  gadgets.forEach((gid, i) => slots.push({ key: String(i + 3), label: GADGETS[gid].name.split(" ")[0].toUpperCase(), n: p.gadgets[gid] ?? 0, on: g.equipped === gid, dim: !(p.gadgets[gid]) }));
  slots.push({ key: "5", label: "DRONE", n: g.dronesLeft + g.drones.filter(d => d.alive).length, on: g.droneIdx >= 0, dim: g.dronesLeft + g.drones.filter(d => d.alive).length === 0 });
  if (p.gadgets.thermal) slots.push({ key: "T", label: g.thermalCd > 0 ? `THERMAL ${Math.ceil(g.thermalCd)}s` : "THERMAL", on: g.thermalUntil > g.t, dim: g.thermalCd > 0 });
  const exp = g.exposure();
  return {
    clock: g.clock(), phase: g.inPrep() ? "prep" : "action", timer: Math.max(0, g.prepEnd - g.t), zeroIn: Math.max(0, ZERO_HOUR - g.missionT()),
    alert: g.alert, objective: g.objectiveText(), objDone: g.objectiveDone || g.hostageOk(),
    hp: p.hp, maxHp: p.maxHp, light: p.light, crouch: p.crouch, hidden: p.hidden >= 0, lean: Math.abs(g.lean) > 0.4 ? Math.sign(g.lean) : 0,
    weapon: w.name, weaponId: p.weapon, mag: a.mag, res: a.res, reloading: p.reloadT > 0, equipped: g.equipped, slots,
    prompt: g.prompt ? { ...g.prompt } : null, toast: g.toast && g.t - g.toast.t < 2.5 ? g.toast.text : null, radio: g.radio.filter(r => g.t - r.t < 9), status: g.status,
    invUsed: g.invUsed(), cap: p.cap, sprint: g.sprinting, stamina: g.stamina,
    view: vp.kind, viewLabel: cam ? `CAM ${String(cam.id + 1).padStart(2, "0")} · ${g.roomName(cam.x, cam.y).toUpperCase()}` : "", feed: [...g.feed], hit: g.hitMarker,
    spread: Math.min(1.5, (p.moving ? (p.sprint ? 1 : 0.5) : 0.1) + g.recoil * 0.5) * (g.input.ads ? 0.3 : 1), ads: g.input.ads,
    dmg: g.damageDirs.map(d => ({ rel: rel(d.angle), a: 1 - (g.t - d.t) / 1.2 })),
    watch: exp.dirs.map(d => ({ rel: rel(d.angle), level: d.level, cam: d.cam })), dronesLeft: g.dronesLeft, feedsHacked: g.feedsHacked, t: g.t,
  };
}
function fmt(s: number) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${String(ss).padStart(2, "0")}`; }

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
