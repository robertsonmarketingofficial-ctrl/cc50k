// Procedural WebAudio: every sound is synthesised, so the game ships with no audio files.
// Ambience layers (hum, air, rain, tension, alarm) follow the facility state; one-shots are spatialised.
import type { AlertLevel, Settings } from "./types";
import type { Sfx } from "./engine";

export class AudioEngine implements Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private amb!: GainNode;
  private noiseBuf!: AudioBuffer; private brownBuf!: AudioBuffer;
  private rainGain!: GainNode; private rainFilter!: BiquadFilterNode; private humGain!: GainNode; private airGain!: GainNode;
  private tensionGain!: GainNode; private tensionFilter!: BiquadFilterNode; private alarmGain!: GainNode; private alarmOsc!: OscillatorNode;
  private heartT = 0; private lastState = 0; private listener = { x: 0, y: 0 };
  private settings: Settings = { master: 0.8, sfx: 0.9, ambience: 0.7, shake: true, effects: true, hints: true };
  private ambienceOn = false;
  private lastPlayed = new Map<string, number>();

  ensure(): boolean {
    try {
      if (!this.ctx) {
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
        if (!AC) return false;
        this.ctx = new AC();
        this.build();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return true;
    } catch { return false; }
  }

  private build() {
    const c = this.ctx!;
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(comp);
    this.amb = c.createGain(); this.amb.connect(comp);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brownBuf = c.createBuffer(1, len, c.sampleRate);
    const b = this.brownBuf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.applySettings(this.settings);
  }

  applySettings(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambience, t, 0.05);
  }

  // ---------------------------------------------------------------- ambience
  startAmbience() {
    if (!this.ensure() || this.ambienceOn) return;
    const c = this.ctx!; this.ambienceOn = true;
    const loop = (buf: AudioBuffer) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // fluorescent / transformer hum
    this.humGain = c.createGain(); this.humGain.gain.value = 0.0; this.humGain.connect(this.amb);
    for (const [f, g] of [[50, 0.5], [100, 0.3], [150, 0.08]]) { const o = c.createOscillator(); o.frequency.value = f; const gg = c.createGain(); gg.gain.value = g * 0.05; o.connect(gg).connect(this.humGain); o.start(); }
    // air handling
    this.airGain = c.createGain(); this.airGain.gain.value = 0; const airF = c.createBiquadFilter(); airF.type = "lowpass"; airF.frequency.value = 380;
    loop(this.brownBuf).connect(airF).connect(this.airGain).connect(this.amb);
    // rain
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0; this.rainFilter = c.createBiquadFilter(); this.rainFilter.type = "lowpass"; this.rainFilter.frequency.value = 900;
    const rainHp = c.createBiquadFilter(); rainHp.type = "highpass"; rainHp.frequency.value = 400;
    loop(this.noiseBuf).connect(rainHp).connect(this.rainFilter).connect(this.rainGain).connect(this.amb);
    // tension drone
    this.tensionGain = c.createGain(); this.tensionGain.gain.value = 0; this.tensionFilter = c.createBiquadFilter(); this.tensionFilter.type = "lowpass"; this.tensionFilter.frequency.value = 240;
    this.tensionFilter.connect(this.tensionGain).connect(this.amb);
    for (const f of [55, 55.7, 82.4]) { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const gg = c.createGain(); gg.gain.value = 0.06; o.connect(gg).connect(this.tensionFilter); o.start(); }
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 90; lfo.connect(lg).connect(this.tensionFilter.frequency); lfo.start();
    // lockdown klaxon
    this.alarmGain = c.createGain(); this.alarmGain.gain.value = 0;
    this.alarmOsc = c.createOscillator(); this.alarmOsc.type = "square"; this.alarmOsc.frequency.value = 640;
    const af = c.createBiquadFilter(); af.type = "bandpass"; af.frequency.value = 900; af.Q.value = 1.2;
    const sw = c.createOscillator(); sw.type = "square"; sw.frequency.value = 1.1; const swg = c.createGain(); swg.gain.value = 110; sw.connect(swg).connect(this.alarmOsc.frequency); sw.start();
    this.alarmOsc.connect(af).connect(this.alarmGain).connect(this.amb); this.alarmOsc.start();
    this.menuMood();
  }

  menuMood() {
    if (!this.ctx || !this.ambienceOn) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.4, t, 0.8); this.airGain.gain.setTargetAtTime(0.05, t, 0.8);
    this.rainGain.gain.setTargetAtTime(0.05, t, 0.8); this.rainFilter.frequency.setTargetAtTime(700, t, 0.5);
    this.tensionGain.gain.setTargetAtTime(0.12, t, 1.5); this.alarmGain.gain.setTargetAtTime(0, t, 0.1);
  }

  state(alert: AlertLevel, info: { suspicion: number; outside: boolean; extracting: boolean; hidden: boolean; hp: number }) {
    if (!this.ctx || !this.ambienceOn) return;
    const now = performance.now();
    if (now - this.lastState < 100) return;
    this.lastState = now;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(info.outside ? 0.1 : 0.55, t, 0.4);
    this.airGain.gain.setTargetAtTime(info.outside ? 0.03 : 0.09, t, 0.4);
    this.rainGain.gain.setTargetAtTime(info.outside ? 0.22 : 0.05, t, 0.3);
    this.rainFilter.frequency.setTargetAtTime(info.outside ? 4200 : info.hidden ? 400 : 800, t, 0.3);
    const tension = [0.05, 0.25, 0.5, 0.45][alert] + info.suspicion * 0.4;
    this.tensionGain.gain.setTargetAtTime(Math.min(0.75, tension), t, 0.6);
    this.tensionFilter.frequency.setTargetAtTime(alert >= 2 ? 520 : 240 + info.suspicion * 300, t, 0.6);
    this.alarmGain.gain.setTargetAtTime(alert === 3 ? 0.07 : 0, t, 0.15);
    // heartbeat when hurt or about to be seen
    if (info.hp < 0.45 || info.suspicion > 0.75) {
      if (now - this.heartT > (info.hp < 0.3 ? 650 : 850)) { this.heartT = now; this.thump(); }
    }
  }
  private thump() { this.tone(52, "sine", 0.18, 0.35, 38); setTimeout(() => this.tone(48, "sine", 0.16, 0.22, 36), 170); }

  setListener(x: number, y: number) { this.listener.x = x; this.listener.y = y; }

  // ---------------------------------------------------------------- primitives
  private out(x?: number, y?: number, vol = 1): AudioNode | null {
    const c = this.ctx; if (!c) return null;
    let v = vol, pan = 0;
    if (x !== undefined && y !== undefined) {
      const dx = x - this.listener.x, dy = y - this.listener.y, d = Math.hypot(dx, dy);
      v *= 1 / (1 + d * d * 0.012); if (v < 0.01) return null;
      pan = Math.max(-0.8, Math.min(0.8, dx / 10));
    }
    const g = c.createGain(); g.gain.value = v;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.sfx); } else g.connect(this.sfx);
    return g;
  }
  private noise(dest: AudioNode, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, brown = false, freqTo?: number) {
    const c = this.ctx!; const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  private tone(freq: number, type: OscillatorType, dur: number, gain: number, freqTo?: number, dest?: AudioNode, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest ?? this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- one-shots
  play(name: string, o: { x?: number; y?: number; vol?: number; rate?: number } = {}) {
    if (!this.ctx) return;
    const now = performance.now();
    const minGap = name === "hackTick" || name === "stepWet" ? 40 : name === "step" ? 25 : name === "bark" || name === "radioChatter" ? 400 : 15;
    if (now - (this.lastPlayed.get(name) ?? 0) < minGap) return;
    this.lastPlayed.set(name, now);
    const d = this.out(o.x, o.y, o.vol ?? 1); if (!d) return;
    const N = (dur: number, type: BiquadFilterType, f: number, q: number, g: number, a?: number, brown?: boolean, fTo?: number) => this.noise(d, dur, type, f, q, g, a, brown, fTo);
    const Tn = (f: number, type: OscillatorType, dur: number, g: number, fTo?: number, delay = 0) => this.tone(f, type, dur, g, fTo, d, delay);
    switch (name) {
      case "step": N(0.07, "bandpass", 1500 + Math.random() * 500, 1.5, 0.35); N(0.05, "lowpass", 180, 1, 0.3, 0.002, true); break;
      case "stepWet": N(0.11, "bandpass", 2600, 0.8, 0.3); N(0.06, "lowpass", 300, 1, 0.2); break;
      case "shotSuppressed": N(0.12, "bandpass", 900, 0.9, 0.9); N(0.05, "highpass", 3000, 0.7, 0.35); Tn(180, "sine", 0.08, 0.4, 60); break;
      case "shotSmg": N(0.16, "lowpass", 3200, 0.6, 1.1); N(0.3, "lowpass", 400, 0.8, 0.7, 0.002, true); Tn(120, "square", 0.05, 0.2, 50); break;
      case "shotShotgun": N(0.45, "lowpass", 2400, 0.5, 1.4); N(0.7, "lowpass", 260, 0.8, 1.2, 0.002, true); Tn(80, "sine", 0.25, 0.8, 35); break;
      case "shotEnemy": N(0.22, "lowpass", 2600, 0.6, 1); N(0.4, "lowpass", 300, 0.8, 0.6, 0.002, true); break;
      case "shotRifle": N(0.3, "lowpass", 3400, 0.5, 1.1); N(0.5, "lowpass", 250, 0.8, 0.8, 0.002, true); Tn(95, "sine", 0.12, 0.4, 45); break;
      case "hit": N(0.08, "bandpass", 700, 2, 0.5); break;
      case "playerHit": N(0.2, "lowpass", 900, 1, 0.9); Tn(90, "sine", 0.25, 0.7, 40); break;
      case "glass": for (let k = 0; k < 5; k++) Tn(2600 + Math.random() * 2400, "triangle", 0.12 + Math.random() * 0.2, 0.08, undefined, Math.random() * 0.08); N(0.25, "highpass", 3500, 0.7, 0.4); break;
      case "bodyfall": N(0.3, "lowpass", 220, 1, 0.9, 0.004, true); N(0.12, "bandpass", 600, 1.4, 0.3); break;
      case "ko": N(0.12, "lowpass", 400, 1, 0.7, 0.003, true); Tn(70, "sine", 0.18, 0.5, 45); N(0.25, "lowpass", 200, 1, 0.5, 0.05, true); break;
      case "reload": N(0.05, "bandpass", 2200, 3, 0.3); N(0.06, "bandpass", 1600, 3, 0.25); break;
      case "reloadEnd": N(0.05, "bandpass", 2800, 4, 0.4); Tn(900, "square", 0.02, 0.05); break;
      case "dry": N(0.03, "bandpass", 3500, 5, 0.3); break;
      case "equip": N(0.08, "bandpass", 1800, 2, 0.3); break;
      case "throw": N(0.18, "bandpass", 800, 1, 0.25, 0.04, false, 2400); break;
      case "clatter": for (let k = 0; k < 4; k++) N(0.05, "bandpass", 2000 + k * 600, 4, 0.35 - k * 0.06, 0.002); break;
      case "chirp": Tn(2400, "square", 0.06, 0.08); Tn(3100, "square", 0.06, 0.08, undefined, 0.09); break;
      case "emp": Tn(120, "sawtooth", 0.6, 0.35, 30); N(0.8, "bandpass", 1200, 0.6, 0.5, 0.005, false, 200); Tn(4000, "sine", 0.4, 0.06, 200); break;
      case "thermal": Tn(600, "sine", 0.4, 0.12, 1800); Tn(1200, "sine", 0.5, 0.05, 3000, 0.05); break;
      case "denied": Tn(220, "square", 0.08, 0.1); Tn(180, "square", 0.1, 0.1, undefined, 0.09); break;
      case "door": N(0.35, "lowpass", 700, 1, 0.35, 0.02, true); Tn(160, "triangle", 0.25, 0.05, 110); break;
      case "doorClose": N(0.2, "lowpass", 500, 1, 0.5, 0.004, true); N(0.06, "bandpass", 1400, 2, 0.2); break;
      case "rollerDoor": N(0.9, "bandpass", 500, 0.8, 0.3, 0.1, true); break;
      case "pickup": N(0.06, "bandpass", 1800, 2, 0.25); Tn(880, "sine", 0.05, 0.05); break;
      case "keycard": Tn(1318, "sine", 0.08, 0.12); Tn(1760, "sine", 0.12, 0.12, undefined, 0.09); break;
      case "unlock": N(0.05, "bandpass", 2500, 4, 0.4); Tn(1500, "sine", 0.1, 0.08, undefined, 0.05); break;
      case "hackTick": Tn(1200 + Math.random() * 600, "square", 0.02, 0.05); break;
      case "objective": Tn(392, "sine", 0.6, 0.12); Tn(523, "sine", 0.6, 0.1, undefined, 0.12); Tn(784, "sine", 0.9, 0.08, undefined, 0.24); break;
      case "locker": N(0.25, "bandpass", 900, 1.2, 0.4, 0.004); Tn(210, "triangle", 0.2, 0.05, 150); break;
      case "drop": N(0.1, "lowpass", 500, 1, 0.4); break;
      case "ui": Tn(1400, "sine", 0.03, 0.05); break;
      case "uiHover": Tn(2200, "sine", 0.015, 0.02); break;
      case "uiConfirm": Tn(660, "sine", 0.08, 0.08); Tn(990, "sine", 0.12, 0.07, undefined, 0.07); break;
      case "typeTick": N(0.018, "bandpass", 3000 + Math.random() * 1500, 3, 0.12); break;
      case "stamp": N(0.2, "lowpass", 300, 1, 1, 0.002, true); N(0.05, "bandpass", 1200, 1, 0.4); break;
      case "bark": N(0.25, "bandpass", 500 + Math.random() * 300, 3, 0.12, 0.03); break;
      case "radio": this.radioBurst(d, 0.9); break;
      case "radioChatter": this.radioBurst(d, 1.4 + Math.random() * 0.8); break;
      case "spotted": Tn(880, "sawtooth", 0.25, 0.08, 1320); Tn(110, "sine", 0.3, 0.35, 70); break;
      case "suspicious": Tn(660, "sine", 0.25, 0.05, 700); break;
      case "cameraAlarm": Tn(1760, "square", 0.08, 0.06); Tn(1760, "square", 0.08, 0.06, undefined, 0.16); Tn(1760, "square", 0.08, 0.06, undefined, 0.32); break;
      case "alertUp": Tn(220, "sawtooth", 0.6, 0.12, 440); N(0.6, "bandpass", 400, 1, 0.2, 0.2, true); break;
      case "lockdown": for (let k = 0; k < 3; k++) { Tn(520, "square", 0.35, 0.09, undefined, k * 0.5); Tn(390, "square", 0.35, 0.09, undefined, k * 0.5 + 0.25); } break;
      case "zeroHour": for (let k = 0; k < 4; k++) Tn(k % 2 ? 147 : 196, "sine", 1.2, 0.18, undefined, k * 0.7); break;
      case "explosion": N(2.2, "lowpass", 900, 0.5, 1.6, 0.005, true, 60); Tn(60, "sine", 1.2, 1, 25); N(0.6, "lowpass", 3000, 0.5, 0.8); break;
      case "extract": Tn(196, "sine", 1.6, 0.14); Tn(294, "sine", 1.6, 0.12, undefined, 0.15); Tn(392, "sine", 1.8, 0.1, undefined, 0.3); Tn(587, "sine", 2.2, 0.08, undefined, 0.45); N(1.8, "lowpass", 300, 0.7, 0.3, 0.3, true); break;
      case "death": Tn(220, "sawtooth", 1.6, 0.12, 55); N(1.5, "lowpass", 500, 0.7, 0.5, 0.01, true, 80); break;
    }
  }

  private radioBurst(dest: AudioNode, dur: number) {
    const c = this.ctx!; const t = c.currentTime;
    // squelch, band-limited "speech" noise, squelch
    this.tone(1800, "square", 0.04, 0.03, undefined, dest);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 2.5;
    const g = c.createGain(); g.gain.value = 0;
    for (let k = 0; k < dur * 9; k++) { const at = t + 0.05 + k / 9; g.gain.setValueAtTime(Math.random() < 0.7 ? 0.1 + Math.random() * 0.12 : 0.01, at); }
    g.gain.setValueAtTime(0, t + dur + 0.05);
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 500; lfo.connect(lg).connect(bp.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    s.connect(bp).connect(g).connect(dest); s.start(t); s.stop(t + dur + 0.1);
    this.tone(1500, "square", 0.05, 0.03, undefined, dest, dur + 0.05);
  }
}

export const audio = new AudioEngine();
