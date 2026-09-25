import { useEffect, useRef, useState } from "react";
import { audio } from "../game/audio";
import { FACILITIES, TIER_NAMES, repTier } from "../game/catalog";
import { Game, type Sfx } from "../game/engine";
import { Renderer } from "../game/render";
import type { Contract, SaveGame, Settings } from "../game/types";
import { newSave } from "../game/world";

const silent: Sfx = { play() {}, state() {} };

export default function MainMenu(props: { canContinue: boolean; save: SaveGame | null; onNew: () => void; onContinue: () => void; onSettings: () => void; settings: Settings }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ n: 4, room: "", time: "" });
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    // live security feed: a real facility with guards running their actual AI
    let raf = 0, alive = true;
    try {
      const s = props.save ?? newSave();
      const fac = (["halvorsen", "meridian", "kestrel"] as const)[Math.floor(Math.random() * 3)];
      const contract: Contract = { id: "attract", facility: fac, type: "steal", title: "", client: "", brief: "", targetItem: "obj_prototype", payout: 0, rep: 0, optionals: [], seed: 7 };
      const game = new Game(contract, { ...s, facilities: { ...s.facilities, [fac]: { ...s.facilities[fac], explored: "", blueprint: true } } }, "main", silent);
      game.spectator = true;
      game.player.hidden = 0;
      const r = new Renderer(canvas.current!, game, { ...props.settings, effects: true, shake: false });
      const rooms = game.level.rooms.filter(r => r.type !== "vault");
      let idx = 0, t0 = performance.now(), last = performance.now();
      const pick = () => { const rm = rooms[idx % rooms.length]; return { x: rm.x + rm.w / 2, y: rm.y + rm.h / 2, name: rm.name }; };
      let from = pick(); idx = 3; let to = pick();
      game.player.x = from.x; game.player.y = from.y;
      const loop = (now: number) => {
        if (!alive) return;
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        const k = Math.min(1, (now - t0) / 9000);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        game.player.x = from.x + (to.x - from.x) * e; game.player.y = from.y + (to.y - from.y) * e;
        game.input.mouseX = game.player.x; game.input.mouseY = game.player.y;
        if (k >= 1) { from = to; idx += 2; to = pick(); t0 = now; setCam({ n: (idx % 9) + 1, room: to.name, time: game.clock() }); }
        game.update(dt);
        r.draw(dt);
        raf = requestAnimationFrame(loop);
      };
      setCam({ n: 4, room: to.name, time: "" });
      raf = requestAnimationFrame(loop);
      const clock = setInterval(() => setCam(c => ({ ...c, time: game.clock() })), 1000);
      return () => { alive = false; cancelAnimationFrame(raf); clearInterval(clock); };
    } catch { return () => { alive = false; cancelAnimationFrame(raf); }; }
  }, []);

  useEffect(() => {
    const unlock = () => { audio.ensure(); audio.startAmbience(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  const s = props.save;
  const hover = () => audio.play("uiHover");
  return (
    <div className="screen fade-in fx-scan">
      <div className="menu-bg"><canvas ref={canvas} /></div>
      <div className="menu-shade" />
      <div className="cctv">
        <div><span className="rec">● REC</span>&nbsp; CAM {String(cam.n).padStart(2, "0")}</div>
        <div>{cam.room.toUpperCase()}</div>
        <div>{cam.time || "--:--:--"}</div>
      </div>
      <div className="menu-main">
        <h1 className="logo">Blacksite<span className="z">Zero Hour</span></h1>
        <p className="tagline">Get in. Take what you came for. Get out before midnight. They'll remember how you did it.</p>
        {typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches && (
          <p className="amber" style={{ fontSize: 14, marginTop: -18, marginBottom: 24 }}>Played with a keyboard and mouse. Open this on a computer to play.</p>
        )}
        {!confirmNew ? (
          <nav className="menu-list" aria-label="Main menu">
            {props.canContinue && s && (
              <button className="menu-item" onMouseEnter={hover} onClick={props.onContinue} autoFocus>
                Continue<small>{TIER_NAMES[repTier(s.rep)]} · ₵{s.credits.toLocaleString()} · {s.runs} operation{s.runs === 1 ? "" : "s"}</small>
              </button>
            )}
            <button className="menu-item" onMouseEnter={hover} onClick={() => (props.canContinue ? setConfirmNew(true) : props.onNew())} autoFocus={!props.canContinue}>
              New operative<small>{props.canContinue ? "Start over. The world forgets you." : "Begin"}</small>
            </button>
            <button className="menu-item" onMouseEnter={hover} onClick={props.onSettings}>Settings<small>Audio, effects, controls</small></button>
          </nav>
        ) : (
          <div style={{ maxWidth: 420 }}>
            <p className="dim">Starting over erases your progress, every facility's memory of you, and your records. This can't be undone.</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn danger" onClick={props.onNew}>Erase and start over</button>
              <button className="btn ghost" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="menu-foot">
        {s ? `${Object.values(s.facilities).filter(m => m.visits > 0).length} of ${Object.keys(FACILITIES).length} sites know your work` : "Headphones recommended"} · v1.0
      </div>
    </div>
  );
}
