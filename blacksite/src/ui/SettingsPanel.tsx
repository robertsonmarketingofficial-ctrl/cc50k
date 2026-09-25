import { useState } from "react";
import { audio } from "../game/audio";
import type { Settings } from "../game/types";

export default function SettingsPanel({ settings, onChange, onClose, onReset }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; onReset?: () => void }) {
  const [s, setS] = useState(settings);
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<Settings>) => { const n = { ...s, ...patch }; setS(n); onChange(n); };
  const slider = (key: "master" | "sfx" | "ambience", label: string) => (
    <div className="setting"><span>{label}</span><input type="range" min={0} max={1} step={0.05} value={s[key]} onChange={e => set({ [key]: +e.target.value })} onMouseUp={() => audio.play("uiConfirm")} aria-label={label} /></div>
  );
  const toggle = (key: "shake" | "effects" | "hints", label: string, desc: string) => (
    <div className="setting"><div><div>{label}</div><div className="dim2" style={{ fontSize: 13 }}>{desc}</div></div>
      <button className={"toggle" + (s[key] ? " on" : "")} role="switch" aria-checked={s[key]} aria-label={label} onClick={() => { audio.play("ui"); set({ [key]: !s[key] }); }}><i /></button></div>
  );
  return (
    <div className="overlay" style={{ zIndex: 40 }} onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel narrow" style={{ width: "min(560px, 92vw)" }}>
        <div className="between"><h2 className="h1">Settings</h2><button className="btn ghost small" onClick={onClose}>Close</button></div>
        <div className="label" style={{ marginTop: 14 }}>Audio</div>
        {slider("master", "Master volume")}{slider("sfx", "Effects")}{slider("ambience", "Ambience and music")}
        <div className="label" style={{ marginTop: 18 }}>Display</div>
        {toggle("shake", "Screen shake", "Camera kick from gunfire and explosions")}
        {toggle("effects", "Film grain and scanlines", "Turn off for a cleaner picture")}
        {toggle("hints", "Control hints", "Show the controls bar at the start of each mission")}
        <div className="label" style={{ marginTop: 18 }}>Controls</div>
        <div className="dim" style={{ fontSize: 13.5, lineHeight: 1.9 }}>
          <span className="kbd">WASD</span> move · <span className="kbd">Shift</span> sprint · <span className="kbd">C</span> crouch · <span className="kbd">E</span> interact, takedown, hold to hack ·
          {" "}<span className="kbd">Mouse</span> aim · <span className="kbd">Click</span> shoot · <span className="kbd">R</span> reload · <span className="kbd">1</span>/<span className="kbd">2</span> weapons ·
          {" "}<span className="kbd">Q</span> noisemaker · <span className="kbd">G</span> EMP · <span className="kbd">T</span> thermal · <span className="kbd">Tab</span> pack · <span className="kbd">M</span> map · <span className="kbd">Esc</span> pause
        </div>
        {onReset && (
          <>
            <div className="label" style={{ marginTop: 18 }}>Progress</div>
            {!confirm ? <div className="setting"><span className="dim">Erase your progress and every facility's memory of you.</span><button className="btn danger small" style={{ justifySelf: "end" }} onClick={() => setConfirm(true)}>Reset</button></div> : (
              <div style={{ padding: "10px 0" }}>
                <p className="dim">This can't be undone.</p>
                <div className="row"><button className="btn danger small" onClick={onReset}>Erase everything</button><button className="btn ghost small" onClick={() => setConfirm(false)}>Cancel</button></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
