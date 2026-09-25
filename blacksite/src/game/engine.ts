// The mission simulation: player, guards, cameras, sound, alarms, objectives and extraction.
import { FACILITIES, GADGETS, LOOT, WEAPONS, packCapacity } from "./catalog";
import { blocksMove, blocksSight, generateLevel } from "./facility";
import { castRay, findPath, los, walkable } from "./geom";
import { angDiff, clamp, dist, Rng } from "./rng";
import type {
  AlertLevel, Camera, Contract, Door, EntranceId, GadgetId, GuardSpec, GuardState, Interactable, Level, Loadout, MissionResult, SaveGame, Vec, WeaponId,
} from "./types";
import { T } from "./types";
import { clock, decodeExplored, encodeExplored } from "./world";

export const ZERO_HOUR = 390; // seconds until 00:00 on the mission clock

export interface Sfx {
  play(name: string, o?: { x?: number; y?: number; vol?: number; rate?: number }): void;
  state(alert: AlertLevel, info: { suspicion: number; outside: boolean; extracting: boolean; hidden: boolean; hp: number }): void;
}

export interface Guard {
  id: number; x: number; y: number; angle: number; kind: GuardSpec["kind"]; name?: string;
  hp: number; maxHp: number; state: GuardState; route: Vec[]; routeIdx: number; post: boolean; postAngle: number;
  path: Vec[]; pathGoal: Vec | null; suspicion: number; target: Vec | null; lkp: Vec | null;
  search: Vec[]; stateT: number; waitT: number; reactT: number; fireCd: number; key: 0 | 1 | 2;
  down: null | "ko" | "dead"; found: boolean; looted: boolean; seesPlayer: boolean; lastSeenT: number;
  bark: { text: string; t: number } | null; radioAt: number; lookBase: number; panel: number; lockerCheck: number;
  radioJammedUntil: number; speedMul: number; reinforcement: boolean; checkedLocker: Set<number>; stuck: number; shotsAtPlayer: number; stepT: number;
}

interface Projectile { x: number; y: number; tx: number; ty: number; t: number; dur: number; kind: GadgetId; landed: boolean; life: number; pingT: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: "spark" | "smoke" | "blood" | "casing" | "glass" | "dust"; size: number }
interface Tracer { x1: number; y1: number; x2: number; y2: number; t: number; enemy: boolean }
export interface Noise { x: number; y: number; r: number; t: number; kind: string }

export interface Prompt { text: string; key: string; progress: number; hold: boolean; tone?: "red" | "amber" }

export class Game {
  level: Level;
  contract: Contract;
  t = 0;
  rng: Rng;
  status: "playing" | "dead" | "extracted" | "aborted" = "playing";
  alert: AlertLevel = 0;
  alertCalmT = 0;
  maxAlert: AlertLevel = 0;
  lightmap: Float32Array;
  lightDirty = true;
  lightVersion = 0;
  spectator = false;
  explored: Uint8Array;
  known: Uint8Array; // explored at mission start (memory)
  guards: Guard[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  tracers: Tracer[] = [];
  noises: Noise[] = [];
  events: MissionResult["events"] = [];
  radio: { text: string; from: string; t: number; kind: "handler" | "guard" | "overheard" }[] = [];
  shake = 0;
  hurtFlash = 0;
  empFlash: { x: number; y: number; t: number } | null = null;
  thermalUntil = 0;
  thermalCd = 0;
  zeroHourPassed = false;
  reinforceT = 0;
  extractT = 0;
  entry: EntranceId;
  sfx: Sfx;
  player: {
    x: number; y: number; angle: number; hp: number; maxHp: number; crouch: boolean; sprint: boolean; moving: boolean;
    hidden: number; weapon: WeaponId; weapons: WeaponId[]; ammo: Record<string, { mag: number; res: number }>;
    reloadT: number; fireCd: number; clearance: 0 | 1 | 2; inv: string[]; cap: number; gadgets: Partial<Record<GadgetId, number>>;
    stepT: number; light: number; armor: boolean; bypass: boolean;
  };
  hostage: null | { x: number; y: number; state: "held" | "following" | "waiting" | "out"; path: Vec[]; repathT: number };
  charge: null | { x: number; y: number; t: number; detonated: boolean } = null;
  evidence = 0;
  objectiveDone = false;
  stats = { kills: 0, kos: 0, shots: 0, camerasDestroyed: [] as Vec[], camerasEmped: 0, looped: false, panels: 0, spotted: 0, chief: "untouched" as MissionResult["chief"], alarms: 0, lockdown: false };
  input = { up: false, down: false, left: false, right: false, fire: false, firePressed: false, interact: false, interactPressed: false, mouseX: 0, mouseY: 0 };
  holding: { id: string; t: number } | null = null;
  prompt: Prompt | null = null;
  radioOwned: boolean;
  lastObjectiveHint = "";
  onEnd: ((r: MissionResult) => void) | null = null;
  private ended = false;
  private handlerSaid = new Set<string>();

  constructor(contract: Contract, save: SaveGame, entry: EntranceId, sfx: Sfx) {
    this.contract = contract;
    this.entry = entry;
    this.sfx = sfx;
    this.rng = new Rng(contract.seed ^ 0x9e37);
    const memory = save.facilities[contract.facility];
    this.level = generateLevel({ contract, memory, stash: save.stash, story: save.story });
    const L = this.level;
    this.lightmap = new Float32Array(L.w * L.h);
    this.known = memory.blueprint ? new Uint8Array(L.w * L.h).fill(1) : decodeExplored(memory.explored, L.w * L.h);
    // the grounds and the building's outline are known from satellite imagery
    for (let i = 0; i < L.w * L.h; i++) {
      if (L.tiles[i] === T.EXT || ((L.tiles[i] === T.WALL || L.tiles[i] === T.DOOR) && [1, -1, L.w, -L.w].some(o => L.tiles[i + o] === T.EXT))) this.known[i] = 1;
    }
    this.explored = this.known.slice();
    this.radioOwned = save.story.includes("radio");
    this.chiefSpared = memory.chief.status === "spared";
    const lo: Loadout = save.loadout;
    const ent = L.entrances.find(e => e.id === entry)!;
    const weapons: WeaponId[] = ["pistol"]; if (lo.primary && save.owned.includes(lo.primary)) weapons.unshift(lo.primary);
    const ammo: Record<string, { mag: number; res: number }> = {};
    for (const w of weapons) ammo[w] = { mag: WEAPONS[w].mag, res: WEAPONS[w].reserve };
    const gadgets: Partial<Record<GadgetId, number>> = {};
    for (const g of lo.gadgets) if (save.owned.includes(g)) gadgets[g] = GADGETS[g].count;
    const armor = lo.armor && save.owned.includes("armor");
    this.player = {
      x: ent.spawn.x, y: ent.spawn.y, angle: -Math.PI / 2, hp: armor ? 150 : 100, maxHp: armor ? 150 : 100, crouch: false, sprint: false, moving: false,
      hidden: -1, weapon: weapons[0], weapons, ammo, reloadT: 0, fireCd: 0,
      clearance: contract.facility === "kestrel" && save.story.includes("kestrel_key") ? 2 : 0,
      inv: [], cap: packCapacity(lo.pack && save.owned.includes("pack")), gadgets, stepT: 0, light: 0, armor, bypass: save.owned.includes("bypass"),
    };
    const face = { main: Math.PI / 2, dock: -Math.PI / 2, maint: 0 }[entry];
    this.player.angle = entry === "maint" ? (L.doors[ent.door].x < L.w / 2 ? 0 : Math.PI) : face;
    this.hostage = L.hostage ? { x: L.hostage.x, y: L.hostage.y, state: "held", path: [], repathT: 0 } : null;
    if (memory.terminalHardened) for (const i of L.interactables) if (i.kind === "secTerminal") i.time = 10;
    if (memory.panelsReinforced) for (const i of L.interactables) if (i.kind === "alarmPanel") i.time = 6;
    L.guards.forEach(g => this.spawnGuard(g));
    this.log(`Perimeter breach: ${ent.name.toLowerCase()} (reconstructed)`, "dim");
    this.handler("start", `You're in through the ${ent.name.toLowerCase()}. Extraction is the ${L.extraction.name.toLowerCase()}. Zero hour is midnight: shift change, double the guards. Don't be here for it.`);
    this.recomputeLight();
  }

  // ------------------------------------------------------------------------------------------ helpers
  log(text: string, tone?: "red" | "amber" | "dim") {
    // the same thing happening again within a few seconds is one incident line, not five
    if (this.events.some(e => e.text === text && this.t - e.time < 20)) return;
    this.events.push({ time: this.t, text, tone });
  }
  handler(key: string, text: string) {
    if (this.handlerSaid.has(key)) return;
    this.handlerSaid.add(key);
    this.radio.push({ text, from: "OVERWATCH", t: this.t, kind: "handler" });
    this.sfx.play("radio", { vol: 0.5 });
  }
  roomName(x: number, y: number): string {
    const r = this.level.roomAt[Math.floor(y) * this.level.w + Math.floor(x)];
    return r >= 0 ? this.level.rooms[r].name : "exterior";
  }
  /** "in Server hall" / "outside" for radio lines */
  whereIn(x: number, y: number): string {
    const r = this.level.roomAt[Math.floor(y) * this.level.w + Math.floor(x)];
    return r >= 0 ? `in ${this.level.rooms[r].name}` : "outside the building";
  }
  tileAt(x: number, y: number) { return this.level.tiles[Math.floor(y) * this.level.w + Math.floor(x)]; }
  outside(x: number, y: number) { return this.tileAt(x, y) === T.EXT; }
  clock() { return clock(this.t); }

  spawnGuard(s: GuardSpec, reinforcement = false) {
    const hp = s.kind === "contractor" ? 150 : s.kind === "chief" ? 130 : 100;
    this.guards.push({
      id: this.guards.length, x: s.x, y: s.y, angle: s.facing, kind: s.kind, name: s.name, hp, maxHp: hp, state: "PATROL",
      route: s.route, routeIdx: 0, post: !!s.post, postAngle: s.facing, path: [], pathGoal: null, suspicion: 0, target: null, lkp: null,
      search: [], stateT: 0, waitT: this.rng.next() * 2, reactT: 0, fireCd: 0, key: s.key, down: null, found: false, looted: false, seesPlayer: false,
      lastSeenT: -99, bark: null, radioAt: -1, lookBase: s.facing, panel: -1, lockerCheck: -1, radioJammedUntil: 0, speedMul: 1, reinforcement,
      checkedLocker: new Set(), stuck: 0, shotsAtPlayer: 0, stepT: 0,
    });
  }

  recomputeLight() {
    const L = this.level, lm = this.lightmap;
    for (let i = 0; i < lm.length; i++) lm[i] = L.tiles[i] === T.EXT ? 0.2 : 0.08;
    const lockdown = this.alert === 3;
    for (const l of L.lights) {
      if (!l.on || l.offUntil > this.t) continue;
      const inten = l.i * (lockdown ? 0.65 : 1) * (l.flicker ? 0.75 : 1);
      const r = Math.ceil(l.r);
      for (let y = Math.floor(l.y) - r; y <= Math.floor(l.y) + r; y++) for (let x = Math.floor(l.x) - r; x <= Math.floor(l.x) + r; x++) {
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
        const d = dist(l.x, l.y, x + 0.5, y + 0.5);
        if (d > l.r) continue;
        if (!los(L, l.x, l.y, x + 0.5, y + 0.5) && !blocksSight(L, x, y)) continue;
        const v = inten * Math.pow(1 - d / l.r, 1.25);
        const i = y * L.w + x; lm[i] = Math.min(1, lm[i] + v);
      }
    }
    this.lightDirty = false;
    this.lightVersion++;
  }
  lightAt(x: number, y: number) { return this.lightmap[Math.floor(y) * this.level.w + Math.floor(x)] ?? 0; }

  noise(x: number, y: number, r: number, kind: string) {
    this.noises.push({ x, y, r, t: this.t, kind });
    for (const g of this.guards) if (!g.down) this.hear(g, x, y, r, kind);
  }

  // ------------------------------------------------------------------------------------------ main update
  update(dt: number) {
    if (this.status !== "playing") { this.updateEffects(dt); return; }
    dt = Math.min(dt, 0.05);
    this.t += dt;
    for (const l of this.level.lights) if (l.offUntil && l.offUntil <= this.t) { l.offUntil = 0; this.lightDirty = true; }
    for (const c of this.level.cameras) if (c.state === "emp" && c.empUntil <= this.t) c.state = "active";
    if (this.lightDirty) this.recomputeLight();
    runScheduled(this);
    if (!this.spectator) this.updatePlayer(dt);
    this.updateHostage(dt);
    for (const g of this.guards) this.updateGuard(g, dt);
    this.updateCameras(dt);
    this.updateProjectiles(dt);
    this.updateFacility(dt);
    this.updateEffects(dt);
    if (this.spectator) { this.updateEffects(0); return; }
    this.updateExplored();
    const outside = this.outside(this.player.x, this.player.y);
    this.sfx.state(this.alert, { suspicion: this.exposure().max, outside, extracting: this.extractT > 0, hidden: this.player.hidden >= 0, hp: this.player.hp / this.player.maxHp });
    this.input.firePressed = false; this.input.interactPressed = false;
  }

  // ------------------------------------------------------------------------------------------ player
  aimAt(wx: number, wy: number) { this.input.mouseX = wx; this.input.mouseY = wy; }

  private updatePlayer(dt: number) {
    const p = this.player, L = this.level, inp = this.input;
    p.fireCd = Math.max(0, p.fireCd - dt);
    this.thermalCd = Math.max(0, this.thermalCd - dt);
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { const a = p.ammo[p.weapon], need = WEAPONS[p.weapon].mag - a.mag, take = Math.min(need, a.res); a.mag += take; a.res -= take; this.sfx.play("reloadEnd"); }
    }
    p.angle = Math.atan2(inp.mouseY - p.y, inp.mouseX - p.x);
    if (p.hidden >= 0) {
      p.moving = false; p.light = 0;
      this.computePrompt();
      if (inp.interactPressed) this.leaveLocker();
      return;
    }
    let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const len = Math.hypot(mx, my); if (len) { mx /= len; my /= len; }
    const load = p.inv.reduce((a, id) => a + (LOOT[id]?.size ?? 0), 0);
    const burden = 1 - 0.18 * clamp(load / p.cap, 0, 1) * (load > p.cap / 2 ? 1 : 0.4);
    const sprinting = p.sprint && !p.crouch && len > 0;
    const speed = (p.crouch ? 1.9 : sprinting ? 5.1 : 3.3) * burden;
    p.moving = len > 0;
    if (len) {
      this.moveCircle(p, mx * speed * dt, my * speed * dt, 0.3, true);
      p.stepT -= dt * (sprinting ? 1.5 : p.crouch ? 0.7 : 1);
      if (p.stepT <= 0) {
        p.stepT = 0.42;
        const outside = this.outside(p.x, p.y);
        this.sfx.play(outside ? "stepWet" : "step", { vol: p.crouch ? 0.18 : sprinting ? 0.75 : 0.4 });
        if (!p.crouch) this.noise(p.x, p.y, sprinting ? (p.armor ? 6.5 : 5) : p.armor ? 2.8 : 2.1, sprinting ? "run" : "step");
      }
    }
    p.light = this.playerLight();
    // weapons
    const w = WEAPONS[p.weapon];
    const auto = p.weapon === "smg";
    if ((auto ? inp.fire : inp.firePressed) && p.fireCd <= 0 && p.reloadT <= 0) {
      const a = p.ammo[p.weapon];
      if (a.mag > 0) this.fire(w.id);
      else if (inp.firePressed) { this.sfx.play("dry"); if (a.res > 0) this.reload(); }
    }
    this.computePrompt();
    this.handleInteract(dt);
    // extraction zone
    const ex = L.extraction;
    // on a rescue, the van waits for the detainee
    const waitingForHostage = !!this.hostage && this.hostage.state === "following" && dist(this.hostage.x, this.hostage.y, ex.x, ex.y) > ex.r + 1.5;
    if (dist(p.x, p.y, ex.x, ex.y) < ex.r && !waitingForHostage) {
      this.extractT += dt;
      if (this.extractT >= 3) this.finish("extracted");
    } else this.extractT = 0;
  }

  playerLight(): number {
    const p = this.player;
    let l = this.lightAt(p.x, p.y);
    for (const g of this.guards) {
      if (!this.flashlightOn(g)) continue;
      const d = dist(g.x, g.y, p.x, p.y);
      if (d < 7.5 && Math.abs(angDiff(g.angle, Math.atan2(p.y - g.y, p.x - g.x))) < 0.34 && los(this.level, g.x, g.y, p.x, p.y)) l = Math.max(l, 0.95 - d * 0.05);
    }
    return clamp(l, 0, 1);
  }
  flashlightOn(g: Guard) { return !g.down && (this.lightAt(g.x, g.y) < 0.45 || g.state !== "PATROL" || this.alert >= 1); }

  moveCircle(o: { x: number; y: number }, dx: number, dy: number, r: number, isPlayer: boolean) {
    const L = this.level;
    const tryAxis = (nx: number, ny: number) => {
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const tx = Math.floor(nx + ox), ty = Math.floor(ny + oy);
        if (blocksMove(L, tx, ty)) {
          // walking into an unlocked closed door opens it
          if (isPlayer && L.tiles[ty * L.w + tx] === T.DOOR) {
            const d = L.doors[L.doorAt[ty * L.w + tx]];
            if (!d.open && (d.lock <= this.player.clearance)) this.openDoor(d, true);
          }
          return false;
        }
      }
      return true;
    };
    if (tryAxis(o.x + dx, o.y)) o.x += dx;
    if (tryAxis(o.x, o.y + dy)) o.y += dy;
  }

  openDoor(d: Door, byPlayer: boolean) {
    d.open = true;
    this.sfx.play(d.exterior === "dock" ? "rollerDoor" : "door", { x: d.x + 0.5, y: d.y + 0.5, vol: 0.6 });
    if (byPlayer) this.noise(d.x + 0.5, d.y + 0.5, 2.5, "door");
    this.lightDirty = true;
  }
  closeDoor(d: Door) {
    const occupied = [this.player, ...this.guards.filter(g => !g.down)].some(o => Math.floor(o.x) === d.x && Math.floor(o.y) === d.y)
      || this.guards.some(g => g.down && Math.floor(g.x) === d.x && Math.floor(g.y) === d.y);
    if (occupied) return;
    d.open = false; this.sfx.play("doorClose", { x: d.x + 0.5, y: d.y + 0.5, vol: 0.5 }); this.lightDirty = true;
  }

  switchWeapon(i: number) {
    const p = this.player; const w = p.weapons[i]; if (!w || w === p.weapon) return;
    p.weapon = w; p.reloadT = 0; p.fireCd = 0.3; this.sfx.play("equip");
  }
  cycleWeapon() { const p = this.player; this.switchWeapon((p.weapons.indexOf(p.weapon) + 1) % p.weapons.length); }
  reload() {
    const p = this.player, a = p.ammo[p.weapon];
    if (p.reloadT > 0 || a.mag >= WEAPONS[p.weapon].mag || a.res <= 0 || p.hidden >= 0) return;
    p.reloadT = WEAPONS[p.weapon].reload; this.sfx.play("reload");
  }
  toggleCrouch() { this.player.crouch = !this.player.crouch; }

  private fire(id: WeaponId) {
    const p = this.player, w = WEAPONS[id], a = p.ammo[id];
    a.mag--; p.fireCd = 1 / w.rate; this.stats.shots++;
    const moveSpread = p.moving ? (p.crouch ? 1.1 : 1.6) : 1;
    const mx = p.x + Math.cos(p.angle) * 0.45, my = p.y + Math.sin(p.angle) * 0.45;
    for (let k = 0; k < w.pellets; k++) {
      const ang = p.angle + (this.rng.next() - 0.5) * 2 * w.spread * moveSpread;
      this.hitscan(mx, my, ang, w.range, w.damage, true, id);
    }
    this.sfx.play(id === "pistol" ? "shotSuppressed" : id === "smg" ? "shotSmg" : "shotShotgun");
    this.noise(p.x, p.y, w.noise, id === "pistol" ? "suppressed" : "shot");
    this.shake = Math.max(this.shake, id === "shotgun" ? 0.5 : id === "smg" ? 0.18 : 0.1);
    this.particles.push({ x: mx, y: my, vx: Math.cos(p.angle + 1.6) * 2, vy: Math.sin(p.angle + 1.6) * 2, life: 0.8, max: 0.8, kind: "casing", size: 0.06 });
    this.muzzle = { x: mx, y: my, t: this.t };
    if (id === "shotgun") {
      // breaching: a shotgun blast opens a locked door you're aiming at point-blank
      const fx = Math.floor(p.x + Math.cos(p.angle) * 1.2), fy = Math.floor(p.y + Math.sin(p.angle) * 1.2);
      const di = this.level.doorAt[fy * this.level.w + fx];
      if (di >= 0) { const d = this.level.doors[di]; if (!d.open) { d.lock = 0; this.openDoor(d, false); this.log(`Door forced with a shotgun (${this.roomName(d.x + 1, d.y + 1)})`, "amber"); } }
    }
    if (a.mag === 0 && a.res > 0) { p.reloadT = 0; this.reload(); p.reloadT += 0.2; }
  }
  muzzle: { x: number; y: number; t: number } | null = null;

  private hitscan(x: number, y: number, ang: number, range: number, dmg: number, byPlayer: boolean, weapon?: WeaponId) {
    const wallD = castRay(this.level, x, y, ang, range);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = wallD; let hitG: Guard | null = null; let hitCam: Camera | null = null; let hitPlayer = false;
    if (byPlayer) {
      for (const g of this.guards) {
        if (g.down) continue;
        const t = rayCircle(x, y, dx, dy, g.x, g.y, 0.38); if (t >= 0 && t < best) { best = t; hitG = g; }
      }
      for (const c of this.level.cameras) {
        if (c.state === "destroyed") continue;
        const t = rayCircle(x, y, dx, dy, c.x, c.y, 0.3); if (t >= 0 && t < best) { best = t; hitG = null; hitCam = c; }
      }
    } else {
      const p = this.player;
      if (p.hidden < 0) { const t = rayCircle(x, y, dx, dy, p.x, p.y, 0.34); if (t >= 0 && t < best) { best = t; hitPlayer = true; } }
    }
    const ex = x + dx * best, ey = y + dy * best;
    this.tracers.push({ x1: x, y1: y, x2: ex, y2: ey, t: this.t, enemy: !byPlayer });
    if (hitG) this.damageGuard(hitG, dmg, weapon);
    else if (hitCam) {
      hitCam.state = "destroyed"; this.stats.camerasDestroyed.push({ x: hitCam.x, y: hitCam.y });
      this.log(`Camera destroyed (${this.roomName(hitCam.x, hitCam.y)})`, "amber");
      this.sfx.play("glass", { x: hitCam.x, y: hitCam.y });
      for (let k = 0; k < 8; k++) this.particles.push({ x: ex, y: ey, vx: (this.rng.next() - 0.5) * 5, vy: (this.rng.next() - 0.5) * 5, life: 0.5, max: 0.5, kind: "spark", size: 0.05 });
      this.noise(hitCam.x, hitCam.y, 3, "glass");
    } else if (hitPlayer) this.damagePlayer(dmg);
    else if (best < range - 0.01) {
      for (let k = 0; k < 4; k++) this.particles.push({ x: ex - dx * 0.1, y: ey - dy * 0.1, vx: -dx * 2 + (this.rng.next() - 0.5) * 3, vy: -dy * 2 + (this.rng.next() - 0.5) * 3, life: 0.3, max: 0.3, kind: "spark", size: 0.04 });
      this.particles.push({ x: ex, y: ey, vx: 0, vy: 0, life: 1.2, max: 1.2, kind: "dust", size: 0.2 });
    }
  }

  damageGuard(g: Guard, dmg: number, weapon?: WeaponId) {
    const unaware = !g.seesPlayer && (g.state === "PATROL" || g.state === "RETURNING" || g.state === "SUSPICIOUS" || g.state === "INVESTIGATING");
    const mult = unaware ? 2 : 1;
    const armor = g.kind === "contractor" ? 0.8 : 1;
    g.hp -= dmg * mult * armor;
    for (let k = 0; k < 5; k++) this.particles.push({ x: g.x, y: g.y, vx: (this.rng.next() - 0.5) * 3, vy: (this.rng.next() - 0.5) * 3, life: 6, max: 6, kind: "blood", size: 0.09 });
    this.sfx.play("hit", { x: g.x, y: g.y });
    if (g.hp <= 0) {
      this.downGuard(g, "dead");
      if (weapon) this.log(`${g.name ?? "Security officer"} killed (${this.roomName(g.x, g.y)})`, "red");
      return;
    }
    // survived: they know where the shot came from
    g.lkp = { x: this.player.x, y: this.player.y };
    this.setState(g, "COMBAT"); g.reactT = 0.3; g.suspicion = 1;
    this.bark(g, g.kind === "chief" ? "You again!" : "I'm hit!");
    this.radioContact(g, this.player.x, this.player.y);
  }

  downGuard(g: Guard, how: "ko" | "dead") {
    g.down = how; g.state = "DOWN"; g.path = []; g.bark = null;
    if (how === "dead") this.stats.kills++; else this.stats.kos++;
    if (g.kind === "chief") this.stats.chief = how === "dead" ? "killed" : this.stats.chief === "killed" ? "killed" : "spared";
    this.sfx.play(how === "dead" ? "bodyfall" : "ko", { x: g.x, y: g.y });
  }

  damagePlayer(dmg: number) {
    const p = this.player;
    p.hp -= dmg; this.hurtFlash = 1; this.shake = Math.max(this.shake, 0.4);
    this.sfx.play("playerHit");
    if (p.hp < p.maxHp * 0.4) this.handler("lowhp", "You're hit. Break line of sight and get out.");
    if (p.hp <= 0) {
      p.hp = 0;
      this.log(`Intruder neutralised (${this.roomName(p.x, p.y)})`, "red");
      this.finish("killed");
    }
  }

  // ------------------------------------------------------------------------------------------ gadgets
  throwGadget(kind: GadgetId) {
    const p = this.player;
    if (this.status !== "playing" || p.hidden >= 0) return;
    if (kind === "thermal") {
      if (!p.gadgets.thermal || this.thermalCd > 0) { this.sfx.play("denied"); return; }
      this.thermalUntil = this.t + 3; this.thermalCd = 20; this.sfx.play("thermal"); return;
    }
    if (!p.gadgets[kind]) { this.sfx.play("denied"); return; }
    p.gadgets[kind]! -= 1;
    const ang = Math.atan2(this.input.mouseY - p.y, this.input.mouseX - p.x);
    const want = Math.min(9, dist(p.x, p.y, this.input.mouseX, this.input.mouseY));
    const d = Math.max(0.5, castRay(this.level, p.x, p.y, ang, want) - 0.3);
    this.projectiles.push({ x: p.x, y: p.y, tx: p.x + Math.cos(ang) * d, ty: p.y + Math.sin(ang) * d, t: 0, dur: 0.25 + d * 0.06, kind, landed: false, life: kind === "noisemaker" ? 5 : 0.6, pingT: 0 });
    this.sfx.play("throw");
  }

  private updateProjectiles(dt: number) {
    for (const pr of this.projectiles) {
      if (!pr.landed) {
        pr.t += dt;
        if (pr.t >= pr.dur) {
          pr.landed = true; pr.x = pr.tx; pr.y = pr.ty;
          if (pr.kind === "emp") this.detonateEmp(pr.x, pr.y);
          else { this.sfx.play("clatter", { x: pr.x, y: pr.y }); this.noise(pr.x, pr.y, 7.5, "noisemaker"); }
        }
        continue;
      }
      pr.life -= dt;
      if (pr.kind === "noisemaker") {
        pr.pingT -= dt;
        if (pr.pingT <= 0 && pr.life > 0) { pr.pingT = 1.2; this.sfx.play("chirp", { x: pr.x, y: pr.y }); this.noise(pr.x, pr.y, 6.5, "noisemaker"); }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.landed || p.life > 0);
  }

  private detonateEmp(x: number, y: number) {
    const R = 4.8;
    this.empFlash = { x, y, t: this.t };
    this.sfx.play("emp", { x, y });
    let cams = 0;
    for (const c of this.level.cameras) if (c.state === "active" && dist(c.x, c.y, x, y) < R) {
      if (c.hardened) continue;
      c.state = "emp"; c.empUntil = this.t + 12; cams++;
    }
    this.stats.camerasEmped += cams;
    for (const l of this.level.lights) if (dist(l.x, l.y, x, y) < R + 1) { l.offUntil = this.t + 12; this.lightDirty = true; }
    for (const d of this.level.doors) if (d.lock === 1 && dist(d.x + 0.5, d.y + 0.5, x, y) < R) { d.lock = 0; }
    for (const g of this.guards) if (!g.down && dist(g.x, g.y, x, y) < R + 2) g.radioJammedUntil = this.t + 12;
    if (cams) this.log(`${cams} camera${cams > 1 ? "s" : ""} offline: electromagnetic pulse (${this.roomName(x, y)})`, "amber");
    this.noise(x, y, 3.5, "emp");
  }

  // ------------------------------------------------------------------------------------------ interaction
  private interactTarget(): { kind: string; ref: any; d: number } | null {
    const p = this.player, L = this.level;
    let best: { kind: string; ref: any; d: number } | null = null;
    const consider = (kind: string, ref: any, x: number, y: number, maxD = 1.45) => {
      const d = dist(p.x, p.y, x, y);
      if (d <= maxD && (!best || d < best.d)) best = { kind, ref, d };
    };
    if (p.hidden >= 0) return { kind: "locker", ref: L.interactables[p.hidden], d: 0 };
    for (const g of this.guards) {
      if (!g.down) {
        const behind = Math.abs(angDiff(g.angle, Math.atan2(p.y - g.y, p.x - g.x))) > 1.7;
        if ((behind || g.suspicion < 0.35) && g.state !== "COMBAT" && !g.seesPlayer) consider("takedown", g, g.x, g.y, 1.25);
      } else if (!g.looted) consider("body", g, g.x, g.y, 1.1);
    }
    if (this.hostage && this.hostage.state !== "held" && this.hostage.state !== "out") consider("hostageToggle", this.hostage, this.hostage.x, this.hostage.y, 1.3);
    for (const it of L.interactables) {
      if (it.done && it.kind !== "locker") continue;
      if (it.kind === "evidence" && it.done) continue;
      consider("item", it, it.x + 0.5, it.y + 0.5, 1.5);
    }
    for (const d of L.doors) consider("door", d, d.x + 0.5, d.y + 0.5, 1.35);
    return best;
  }

  private computePrompt() {
    this.prompt = null;
    const tgt = this.interactTarget();
    const p = this.player;
    if (!tgt) {
      const ex = this.level.extraction;
      const lag = this.hostage && this.hostage.state === "following" && dist(this.hostage.x, this.hostage.y, ex.x, ex.y) > ex.r + 1.5;
      if (dist(p.x, p.y, ex.x, ex.y) < ex.r && lag) this.prompt = { text: "Waiting for the detainee to reach the van", key: "", progress: 0, hold: false, tone: "amber" };
      else if (dist(p.x, p.y, ex.x, ex.y) < ex.r) this.prompt = { text: this.objectiveDone || this.hostageOk() ? "Extracting…" : "Extracting without the objective…", key: "", progress: this.extractT / 3, hold: false, tone: this.objectiveDone ? undefined : "amber" };
      return;
    }
    const prog = this.holding?.id === this.keyOf(tgt) ? this.holding.t : 0;
    switch (tgt.kind) {
      case "takedown": this.prompt = { text: "Takedown", key: "E", progress: 0, hold: false }; break;
      case "body": this.prompt = { text: `Search ${(tgt.ref as Guard).name ?? "body"}`, key: "E", progress: prog / 1, hold: true }; break;
      case "hostageToggle": this.prompt = { text: this.hostage!.state === "following" ? "Tell Castell to wait" : "Tell them to follow", key: "E", progress: 0, hold: false }; break;
      case "locker": this.prompt = { text: p.hidden >= 0 ? "Leave locker" : "Hide in locker", key: "E", progress: 0, hold: false }; break;
      case "door": {
        const d = tgt.ref as Door;
        if (d.open) this.prompt = { text: "Close door", key: "E", progress: 0, hold: false };
        else if (d.lock <= p.clearance) this.prompt = { text: d.lock ? "Unlock with keycard" : "Open door", key: "E", progress: 0, hold: false };
        else this.prompt = { text: `Bypass ${d.lock === 2 ? "red" : "blue"} lock`, key: "E", progress: prog / this.hackTime(d), hold: true, tone: d.lock === 2 ? "red" : "amber" };
        break;
      }
      case "item": {
        const it = tgt.ref as Interactable;
        const name = it.item ? LOOT[it.item]?.name : "";
        let text = it.label;
        if (it.kind === "loot" && name) text = `${it.label}: ${name}`;
        if (it.kind === "objective" && name) text = `${it.label === "Download files" ? "Download" : "Take"}: ${name}`;
        if (it.kind === "safe") text = "Crack safe";
        if (it.kind === "keycard") text = "Take blue keycard";
        if (it.kind === "locker") text = "Hide in locker";
        if (it.kind === "hostage") text = "Free the detainee";
        if (!this.fits(it)) { this.prompt = { text: "Pack full: drop something [Tab]", key: "", progress: 0, hold: false, tone: "red" }; break; }
        this.prompt = { text, key: "E", progress: prog / this.itemTime(it), hold: this.itemTime(it) > 0.4, tone: it.kind === "objective" || it.kind === "chargeSite" ? undefined : undefined };
        break;
      }
    }
  }

  private keyOf(t: { kind: string; ref: any }) { return t.kind + ":" + (t.ref.id ?? 0); }
  hackTime(d: Door) { return (d.exterior ? 3.5 : d.lock === 2 ? 12 : 6) * (this.player.bypass ? 0.4 : 1); }
  itemTime(it: Interactable) {
    const hackish = it.kind === "secTerminal" || it.kind === "objective" && it.label === "Download files" || it.kind === "safe" || it.kind === "alarmPanel";
    return it.time * (hackish && this.player.bypass ? 0.5 : 1);
  }
  fits(it: Interactable) {
    if (!(it.kind === "loot" || it.kind === "objective" || it.kind === "safe")) return true;
    const item = it.kind === "safe" ? it.item! : it.item!;
    const size = LOOT[item]?.size ?? 0;
    return this.invUsed() + size <= this.player.cap;
  }
  invUsed() { return this.player.inv.reduce((a, id) => a + (LOOT[id]?.size ?? 0), 0); }
  dropItem(i: number) {
    const id = this.player.inv[i]; if (!id || id.startsWith("obj_")) return;
    this.player.inv.splice(i, 1);
    const L = this.level;
    L.interactables.push({ id: L.interactables.length, kind: "loot", x: Math.floor(this.player.x), y: Math.floor(this.player.y), room: -1, item: id, done: false, time: 0.6, progress: 0, label: "Take" });
    this.sfx.play("drop");
  }

  private handleInteract(dt: number) {
    const tgt = this.interactTarget();
    const inp = this.input;
    if (!tgt) { this.holding = null; return; }
    const key = this.keyOf(tgt);
    if (inp.interactPressed) {
      if (tgt.kind === "takedown") return this.takedown(tgt.ref);
      if (tgt.kind === "hostageToggle") { const h = this.hostage!; h.state = h.state === "following" ? "waiting" : "following"; this.sfx.play("ui"); return; }
      if (tgt.kind === "door") {
        const d = tgt.ref as Door;
        if (d.open) return this.closeDoor(d);
        if (d.lock <= this.player.clearance) { if (d.lock) this.sfx.play("keycard"); return this.openDoor(d, true); }
      }
      if (tgt.kind === "item" && (tgt.ref as Interactable).kind === "locker") return this.enterLocker(tgt.ref);
    }
    const holdable = tgt.kind === "body" || tgt.kind === "item" || (tgt.kind === "door" && !(tgt.ref as Door).open && (tgt.ref as Door).lock > this.player.clearance);
    if (!holdable || !inp.interact) { if (!inp.interact) this.holding = null; return; }
    if (tgt.kind === "item" && !this.fits(tgt.ref)) return;
    if (!this.holding || this.holding.id !== key) this.holding = { id: key, t: 0 };
    this.holding.t += dt;
    const need = tgt.kind === "body" ? 1 : tgt.kind === "door" ? this.hackTime(tgt.ref) : this.itemTime(tgt.ref);
    // hacking and cracking make small noises
    if ((tgt.kind === "door" || (tgt.kind === "item" && ["safe", "secTerminal", "alarmPanel", "chargeSite", "objective"].includes((tgt.ref as Interactable).kind))) && Math.floor(this.holding.t * 2) !== Math.floor((this.holding.t - dt) * 2)) {
      this.sfx.play("hackTick", { vol: 0.35 });
      if (tgt.kind === "door" || (tgt.ref as Interactable).kind === "safe") this.noise(this.player.x, this.player.y, 1.8, "tool");
    }
    if (this.holding.t >= need) {
      this.holding = null;
      if (tgt.kind === "body") this.lootBody(tgt.ref);
      else if (tgt.kind === "door") { const d = tgt.ref as Door; d.lock = 0; this.openDoor(d, true); this.sfx.play("unlock"); this.log(`Lock bypassed: ${d.exterior ? "exterior door" : this.roomName(d.x + (d.vertical ? 1 : 0.5), d.y + (d.vertical ? 0.5 : 1))}`, "dim"); }
      else this.completeItem(tgt.ref);
    }
  }

  private takedown(g: Guard) {
    this.downGuard(g, "ko");
    this.noise(g.x, g.y, 2.2, "takedown");
    this.log(`${g.name ?? "Security officer"} incapacitated (${this.roomName(g.x, g.y)})`, "amber");
    this.shake = Math.max(this.shake, 0.15);
  }
  private lootBody(g: Guard) {
    g.looted = true;
    const got: string[] = [];
    if (g.key > this.player.clearance) { this.player.clearance = g.key; got.push(g.key === 2 ? "red keycard" : "blue keycard"); this.sfx.play("keycard"); }
    const a = this.player.ammo[this.player.weapon]; a.res += Math.round(WEAPONS[this.player.weapon].mag * 0.6); got.push("ammo");
    this.toast = { text: "Found: " + got.join(", "), t: this.t };
    this.sfx.play("pickup");
  }
  toast: { text: string; t: number } | null = null;

  private completeItem(it: Interactable) {
    const p = this.player;
    this.sfx.play("pickup");
    switch (it.kind) {
      case "loot": {
        it.done = true;
        if (it.item === "ammo") { for (const w of p.weapons) p.ammo[w].res += WEAPONS[w].mag; this.toast = { text: "Ammunition", t: this.t }; break; }
        if (it.item === "medkit") { p.hp = Math.min(p.maxHp, p.hp + 55); this.toast = { text: "Trauma kit: patched up", t: this.t }; break; }
        p.inv.push(it.item!);
        const d = LOOT[it.item!];
        this.toast = { text: `${d.name}${d.value ? ` · ₵${d.value}` : ""}`, t: this.t };
        if (d.rare) { this.log(`${d.name} missing (${this.roomName(it.x, it.y)})`, "amber"); this.handler("rare" + d.id, `That's not on the contract, but it's worth more than money. Get it out.`); }
        break;
      }
      case "safe": { it.done = true; p.inv.push(it.item!); this.log("Executive safe opened", "amber"); this.toast = { text: `${LOOT[it.item!].name} · ₵${LOOT[it.item!].value}`, t: this.t }; this.safeOpened = true; break; }
      case "keycard": { it.done = true; p.clearance = Math.max(p.clearance, 1) as 0 | 1 | 2; this.toast = { text: "Blue keycard", t: this.t }; this.sfx.play("keycard"); break; }
      case "secTerminal": {
        it.done = true; this.stats.looped = true;
        for (const c of this.level.cameras) if (c.state === "active" || c.state === "emp") c.state = "looped";
        this.log("Camera network compromised: feeds looping", "amber");
        this.toast = { text: "Camera feeds looped", t: this.t };
        break;
      }
      case "alarmPanel": { it.done = true; this.stats.panels++; this.log(`Alarm panel disabled (${this.roomName(it.x, it.y)})`, "dim"); this.toast = { text: "Alarm panel cut", t: this.t }; break; }
      case "objective": {
        it.done = true; p.inv.push(it.item!);
        this.objectiveDone = true;
        this.log(`${LOOT[it.item!].name} removed from ${this.roomName(it.x, it.y)}`, "red");
        this.handler("obj", "Package secured. The van's waiting. Or push your luck: everything else in there is yours too.");
        this.sfx.play("objective");
        break;
      }
      case "evidence": {
        it.done = true; this.evidence++;
        this.toast = { text: `Evidence scanned (${this.evidence}/3)`, t: this.t };
        if (this.evidence >= 3 || this.evidence >= this.level.interactables.filter(i => i.kind === "evidence").length) {
          this.objectiveDone = true; p.inv.push("obj_evidence");
          this.log("Internal records accessed and copied", "red");
          this.handler("obj", "That's everything we need. Get to the van.");
          this.sfx.play("objective");
        }
        break;
      }
      case "chargeSite": {
        it.done = true;
        this.charge = { x: it.x + 0.5, y: it.y + 0.5, t: 40, detonated: false };
        this.objectiveDone = true;
        this.log(`Explosive device placed (${this.roomName(it.x, it.y)})`, "red");
        this.handler("obj", "Charge is live. Forty seconds. When it blows, the whole building locks down. Move.");
        this.sfx.play("objective");
        break;
      }
      case "hostage": {
        it.done = true;
        if (this.hostage) this.hostage.state = "following";
        this.log(`Detainee released from ${this.roomName(it.x, it.y)}`, "red");
        this.handler("obj", "You've got her. She can't run, so keep to the shadows and don't get her seen. Van's waiting.");
        this.sfx.play("objective");
        break;
      }
    }
  }
  safeOpened = false;

  private enterLocker(it: Interactable) {
    const p = this.player;
    p.hidden = it.id; this.sfx.play("locker");
    this.lockerReturn = { x: p.x, y: p.y };
    p.x = it.x + 0.5; p.y = it.y + 0.5;
  }
  lockerReturn: Vec | null = null;
  private leaveLocker() {
    const p = this.player;
    if (p.hidden < 0) return;
    p.hidden = -1; this.sfx.play("locker");
    if (this.lockerReturn) { p.x = this.lockerReturn.x; p.y = this.lockerReturn.y; }
  }

  // ------------------------------------------------------------------------------------------ hostage
  hostageOk() { return !!this.hostage && this.hostage.state === "following" && dist(this.hostage.x, this.hostage.y, this.player.x, this.player.y) < 6; }
  private updateHostage(dt: number) {
    const h = this.hostage; if (!h || h.state !== "following") return;
    const p = this.player;
    const d = dist(h.x, h.y, p.x, p.y);
    if (d < 1.4) return;
    h.repathT -= dt;
    if (h.repathT <= 0 || !h.path.length) { h.repathT = 0.5; h.path = findPath(this.level, h.x, h.y, p.x, p.y, 2) ?? []; }
    const n = h.path[0]; if (!n) return;
    const nd = dist(h.x, h.y, n.x, n.y);
    const sp = (p.crouch ? 1.8 : d > 5 ? 3.3 : 2.9) * dt;
    if (nd < 0.15) { h.path.shift(); return; }
    this.openDoorsOnWay(h, n);
    this.moveCircle(h, ((n.x - h.x) / nd) * Math.min(sp, nd), ((n.y - h.y) / nd) * Math.min(sp, nd), 0.28, false);
  }
  private openDoorsOnWay(o: Vec, n: Vec) {
    const di = this.level.doorAt[Math.floor(n.y) * this.level.w + Math.floor(n.x)];
    if (di >= 0) { const d = this.level.doors[di]; if (!d.open && dist(o.x, o.y, n.x, n.y) < 1.3) this.openDoor(d, false); }
  }

  // ------------------------------------------------------------------------------------------ guards
  private setState(g: Guard, s: GuardState) {
    if (g.state === s) return;
    g.state = s; g.stateT = 0; g.path = []; g.pathGoal = null;
  }
  bark(g: Guard, text: string) { g.bark = { text, t: this.t }; this.sfx.play("bark", { x: g.x, y: g.y, vol: 0.5 }); }

  private goTo(g: Guard, goal: Vec, clearance: 0 | 1 | 2 = 1) {
    if (g.pathGoal && dist(g.pathGoal.x, g.pathGoal.y, goal.x, goal.y) < 0.6 && g.path.length) return;
    g.pathGoal = { ...goal };
    g.path = findPath(this.level, g.x, g.y, goal.x, goal.y, Math.max(clearance, g.key) as 0 | 1 | 2) ?? [];
  }
  /** returns true when arrived */
  private follow(g: Guard, speed: number, dt: number): boolean {
    const n = g.path[0];
    if (!n) return true;
    const d = dist(g.x, g.y, n.x, n.y);
    this.openDoorsOnWay(g, n);
    if (d < 0.12) { g.path.shift(); return g.path.length === 0; }
    const want = Math.atan2(n.y - g.y, n.x - g.x);
    g.angle += angDiff(g.angle, want) * Math.min(1, dt * 8);
    const step = Math.min(d, speed * dt);
    const bx = g.x, by = g.y;
    this.moveCircle(g, ((n.x - g.x) / d) * step, ((n.y - g.y) / d) * step, 0.3, false);
    if (Math.abs(g.x - bx) + Math.abs(g.y - by) < step * 0.2) {
      // blocked (closed door ahead or another agent): re-path after a moment
      g.stuck += dt;
      if (g.stuck > 0.5) { g.stuck = 0; g.path = []; g.pathGoal = null; }
    } else g.stuck = 0;
    return false;
  }

  private canSee(g: Guard, x: number, y: number, light: number, isPlayer: boolean): number {
    const d = dist(g.x, g.y, x, y);
    const alertBoost = this.alert >= 2 || g.state === "COMBAT" || g.state === "SEARCHING" ? 1.25 : 1;
    const range = (3 + 7 * light) * alertBoost * (isPlayer && this.player.crouch ? 0.72 : 1);
    if (d > range && d > 1.6) return 0;
    const ang = Math.atan2(y - g.y, x - g.x);
    const inCone = Math.abs(angDiff(g.angle, ang)) < (g.state === "COMBAT" ? 1.3 : 0.95);
    const close = d < 1.6 && (isPlayer ? this.player.moving && !this.player.crouch : true);
    if (!inCone && !close) return 0;
    if (!los(this.level, g.x, g.y, x, y)) return 0;
    return clamp(1 - d / Math.max(range, 1.6), 0.15, 1);
  }

  private updateGuard(g: Guard, dt: number) {
    if (g.down) return;
    g.stateT += dt; g.fireCd -= dt; g.reactT -= dt;
    if (g.bark && this.t - g.bark.t > 2.6) g.bark = null;
    const p = this.player;
    const speedMul = (g.kind === "contractor" ? 1.08 : 1) * (this.alert === 3 ? 1.1 : 1);

    // ---- perception: player
    let seeAmt = 0;
    if (p.hidden < 0 && !this.spectator) seeAmt = this.canSee(g, p.x, p.y, p.light, true);
    const kindMul = g.kind === "chief" ? 1.2 : g.kind === "contractor" ? 1.15 : 1;
    if (seeAmt > 0) {
      // detection builds over time: ~0.6s point blank in light, several seconds at the edge of vision
      const rate = (0.2 + 1.35 * Math.pow(seeAmt, 1.4)) * (p.moving ? (p.sprint && !p.crouch ? 1.6 : 1.1) : 0.55) * kindMul * (this.alert >= 1 ? 1.3 : 1)
        * (g.state === "COMBAT" || g.state === "SEARCHING" || g.state === "ALERT" ? 2.6 : 1);
      g.suspicion = Math.min(1, g.suspicion + rate * dt);
      g.target = { x: p.x, y: p.y };
    } else {
      g.suspicion = Math.max(0, g.suspicion - dt * (g.state === "SUSPICIOUS" ? 0.12 : 0.2));
    }
    // hostage is visible too
    const h = this.hostage;
    if (h && h.state !== "held" && h.state !== "out" && seeAmt === 0) {
      const hs = this.canSee(g, h.x, h.y, Math.max(this.lightAt(h.x, h.y), 0.3), false);
      if (hs > 0) { g.suspicion = Math.min(1, g.suspicion + (1 + 2.2 * hs) * dt * kindMul); g.target = { x: h.x, y: h.y }; }
    }
    const wasSeeing = g.seesPlayer;
    g.seesPlayer = seeAmt > 0 && g.suspicion >= 1;
    if (g.seesPlayer) { g.lkp = { x: p.x, y: p.y }; g.lastSeenT = this.t; this.alertCalmT = 0; }

    // ---- perception: bodies
    if (g.state !== "COMBAT" && g.state !== "RAISING") {
      for (const b of this.guards) {
        if (!b.down || b.found || b === g) continue;
        const vis = this.canSee(g, b.x, b.y, Math.max(this.lightAt(b.x, b.y), 0.35), false);
        if (vis > 0) {
          b.found = true;
          this.setState(g, "INVESTIGATING"); g.target = { x: b.x, y: b.y }; g.suspicion = Math.max(g.suspicion, 0.4);
          this.bark(g, b.down === "dead" ? "Oh God. Man down!" : "Hey! Wake up!");
          g.radioAt = this.t + 1.2; g.panel = -2; // -2: pending body report
          break;
        }
      }
    }
    // pending body report
    if (g.panel === -2 && this.t >= g.radioAt && g.radioAt > 0) {
      g.panel = -1; g.radioAt = -1;
      if (g.radioJammedUntil <= this.t) {
        const where = this.roomName(g.x, g.y);
        this.log(`Incapacitated officer discovered (${where})`, "amber");
        this.guardRadio(g, `Man down ${this.whereIn(g.x, g.y)}. We've got an intruder. Search the area.`);
        this.raise(1);
        for (const o of this.guards) if (!o.down && o !== g && dist(o.x, o.y, g.x, g.y) < 22 && (o.state === "PATROL" || o.state === "RETURNING")) this.startSearch(o, { x: g.x, y: g.y });
      }
    }

    // ---- transitions on sight
    if (g.suspicion >= 1 && g.state !== "COMBAT" && g.state !== "RAISING" && g.target) {
      if (!wasSeeing) this.stats.spotted++;
      g.lkp = { ...g.target };
      this.setState(g, "COMBAT"); g.reactT = g.kind === "contractor" ? 0.5 : 0.85; g.shotsAtPlayer = 0;
      this.bark(g, g.kind === "chief" && this.stats.spotted > 0 && this.memorySpared() ? "It's you again!" : this.rng.pick(["Contact!", "Intruder!", "There! Hold it!"]));
      this.sfx.play("spotted");
      this.radioContact(g, g.lkp.x, g.lkp.y);
    } else if (g.suspicion > 0.3 && (g.state === "PATROL" || g.state === "RETURNING")) {
      this.setState(g, "SUSPICIOUS");
      this.bark(g, this.rng.pick(["Hm?", "Who's there?", "Something moved…", "Hello?"]));
      this.sfx.play("suspicious", { vol: 0.5 });
    }

    // ---- behaviour
    const spd = (s: number) => s * speedMul * (g.reinforcement ? 1.1 : 1);
    switch (g.state) {
      case "PATROL": {
        if (g.post) {
          g.angle = g.postAngle + Math.sin(this.t * 0.35 + g.id) * 0.7;
          break;
        }
        const wp = g.route[g.routeIdx % g.route.length];
        if (g.waitT > 0) { g.waitT -= dt; g.angle = g.lookBase + Math.sin((this.t + g.id) * 0.9) * 0.9; break; }
        this.goTo(g, wp, g.key);
        if (this.follow(g, spd(1.45), dt) && dist(g.x, g.y, wp.x, wp.y) < 0.6) {
          g.routeIdx = (g.routeIdx + 1) % g.route.length; g.waitT = 1.5 + this.rng.next() * 2.5; g.lookBase = g.angle; g.path = []; g.pathGoal = null;
        }
        break;
      }
      case "SUSPICIOUS": {
        if (g.target) g.angle += angDiff(g.angle, Math.atan2(g.target.y - g.y, g.target.x - g.x)) * Math.min(1, dt * 4);
        if (g.stateT > 1.8 && g.target) { this.setState(g, "INVESTIGATING"); this.bark(g, "Going to take a look."); }
        break;
      }
      case "INVESTIGATING": {
        if (!g.target) { this.setState(g, "RETURNING"); break; }
        const arrived = dist(g.x, g.y, g.target.x, g.target.y) < 1.1;
        if (!arrived) { this.goTo(g, g.target, g.key); if (this.follow(g, spd(this.alert >= 1 ? 2.6 : 2), dt) && !g.path.length && g.stateT > 8) g.target = { x: g.x, y: g.y }; }
        else {
          g.waitT += dt; g.angle += dt * 1.6;
          if (g.waitT > 3.2) {
            g.waitT = 0;
            if (this.alert >= 1) this.startSearch(g, g.target);
            else { this.bark(g, this.rng.pick(["Must be the rats.", "Nothing. Back to it.", "Hearing things again."])); this.setState(g, "RETURNING"); }
          }
        }
        if (g.stateT > 25) this.setState(g, "RETURNING");
        break;
      }
      case "COMBAT": {
        if (g.seesPlayer) {
          const want = Math.atan2(p.y - g.y, p.x - g.x);
          g.angle += angDiff(g.angle, want) * Math.min(1, dt * 10);
          const d = dist(g.x, g.y, p.x, p.y);
          if (d > 6) { this.goTo(g, p, g.key); this.follow(g, spd(2.6), dt); } else { g.path = []; g.pathGoal = null; }
          if (g.reactT <= 0 && g.fireCd <= 0 && Math.abs(angDiff(g.angle, want)) < 0.2) {
            g.fireCd = g.kind === "contractor" ? 0.42 : g.kind === "chief" ? 0.5 : 0.62;
            // the first shots after acquiring you are hurried; accuracy settles in
            const settle = Math.max(0, 0.16 - g.shotsAtPlayer * 0.05);
            const miss = (p.moving ? (p.sprint ? 0.2 : 0.13) : 0.07) + (d > 7 ? 0.05 : 0) + settle;
            g.shotsAtPlayer++;
            this.hitscan(g.x + Math.cos(g.angle) * 0.4, g.y + Math.sin(g.angle) * 0.4, g.angle + (this.rng.next() - 0.5) * 2 * miss, 16, g.kind === "contractor" ? 22 : 16, false);
            this.sfx.play(g.kind === "contractor" ? "shotRifle" : "shotEnemy", { x: g.x, y: g.y });
            this.noise(g.x, g.y, 14, "shot");
            this.muzzleEnemy = { x: g.x + Math.cos(g.angle) * 0.45, y: g.y + Math.sin(g.angle) * 0.45, t: this.t };
          }
        } else if (g.lkp) {
          this.goTo(g, g.lkp, g.key);
          const arrived = this.follow(g, spd(3), dt) || dist(g.x, g.y, g.lkp.x, g.lkp.y) < 1;
          if (arrived) { this.bark(g, this.rng.pick(["Where'd they go?", "Lost them!", "Spread out!"])); this.startSearch(g, g.lkp); }
        } else this.startSearch(g, { x: g.x, y: g.y });
        // someone has to hit the alarm
        this.maybeRaiseAlarm(g);
        break;
      }
      case "SEARCHING": {
        if (g.lockerCheck >= 0) {
          const lk = this.level.interactables[g.lockerCheck];
          this.goTo(g, { x: lk.x + 0.5, y: lk.y + 0.5 }, g.key);
          if (this.follow(g, spd(2.4), dt) || dist(g.x, g.y, lk.x + 0.5, lk.y + 0.5) < 1.3) {
            g.checkedLocker.add(lk.id);
            this.sfx.play("locker", { x: lk.x, y: lk.y });
            if (p.hidden === lk.id) {
              this.leaveLocker(); g.suspicion = 1; g.target = { x: p.x, y: p.y }; g.lkp = { ...g.target };
              this.bark(g, "Got you!"); this.setState(g, "COMBAT"); g.reactT = 0.5; this.radioContact(g, p.x, p.y); this.stats.spotted++;
            } else this.bark(g, "Empty.");
            g.lockerCheck = -1;
          }
          break;
        }
        if (!g.search.length) {
          if (g.stateT > 30 || this.alert <= 1 && g.stateT > 18) { this.bark(g, this.rng.pick(["Nothing here.", "Area clear.", "They're gone."])); this.setState(g, "RETURNING"); break; }
          g.search = this.searchPoints(g.lkp ?? { x: g.x, y: g.y }, 3);
          // the chief who remembers you, and anyone on high alert, checks hiding places
          const lk = this.level.interactables.find(i => i.kind === "locker" && !g.checkedLocker.has(i.id) && dist(i.x, i.y, g.x, g.y) < 7 && (g.kind === "chief" || this.alert >= 2 || this.rng.chance(0.35)));
          if (lk) { g.lockerCheck = lk.id; this.bark(g, "Checking the lockers."); break; }
        }
        const sp = g.search[0];
        this.goTo(g, sp, g.key);
        if (this.follow(g, spd(this.alert >= 2 ? 2.8 : 2.2), dt) || dist(g.x, g.y, sp.x, sp.y) < 0.7) {
          g.waitT += dt; g.angle += dt * 2.2;
          if (g.waitT > 1.4) { g.waitT = 0; g.search.shift(); g.path = []; g.pathGoal = null; }
        }
        this.maybeRaiseAlarm(g);
        break;
      }
      case "RAISING": {
        const panel = this.level.interactables[g.panel];
        if (!panel || this.alert === 3) { g.panel = -1; this.setState(g, "SEARCHING"); break; }
        const spot = { x: panel.x + 0.5, y: panel.y + 0.5 };
        if (dist(g.x, g.y, spot.x, spot.y) > 1.1) { this.goTo(g, spot, 2); this.follow(g, spd(3.2), dt); g.waitT = 0; }
        else {
          g.waitT += dt;
          if (g.waitT > 1.8) {
            g.waitT = 0;
            if (panel.done) { this.bark(g, "Panel's been cut!"); this.guardRadio(g, `Alarm panel ${this.whereIn(panel.x, panel.y)} is dead. Someone cut it.`); g.panel = -1; this.setState(g, "SEARCHING"); }
            else { this.lockdown(`${g.name ?? "Officer"} at ${this.roomName(panel.x, panel.y)}`); g.panel = -1; this.setState(g, "SEARCHING"); }
          }
        }
        if (g.seesPlayer && g.stateT > 0.5) { this.setState(g, "COMBAT"); g.reactT = 0.2; }
        break;
      }
      case "RETURNING": {
        const home = g.post ? g.route[0] : g.route[g.routeIdx % g.route.length];
        this.goTo(g, home, g.key);
        if (this.follow(g, spd(1.6), dt) && dist(g.x, g.y, home.x, home.y) < 0.8) { this.setState(g, "PATROL"); g.suspicion = 0; g.lookBase = g.angle; if (g.post) g.angle = g.postAngle; }
        break;
      }
      case "ALERT": { this.setState(g, "SEARCHING"); break; }
    }
    // footsteps you can hear through walls: the main way to track a patrol you can't see
    if (g.path.length && !g.post) {
      g.stepT -= dt * (g.state === "COMBAT" || g.state === "RAISING" ? 1.8 : g.state === "SEARCHING" ? 1.4 : 1);
      if (g.stepT <= 0) {
        g.stepT = 0.5;
        const d = dist(g.x, g.y, p.x, p.y);
        if (d < 11) this.sfx.play("step", { x: g.x, y: g.y, vol: (g.kind === "contractor" ? 0.5 : 0.38) * (los(this.level, g.x, g.y, p.x, p.y) ? 1 : 0.55) });
      }
    }
    // keep guards from stacking up
    for (const o of this.guards) {
      if (o === g || o.down) continue;
      const d = dist(g.x, g.y, o.x, o.y);
      if (d < 0.55 && d > 0.001) this.moveCircle(g, ((g.x - o.x) / d) * 0.02, ((g.y - o.y) / d) * 0.02, 0.3, false);
    }
  }
  muzzleEnemy: { x: number; y: number; t: number } | null = null;

  private memorySpared() { return this.level.guards.some(s => s.kind === "chief") && this.chiefSpared; }
  chiefSpared = false;

  private hear(g: Guard, x: number, y: number, r: number, kind: string) {
    if (g.state === "COMBAT" && g.seesPlayer) return;
    const d = dist(g.x, g.y, x, y);
    const eff = los(this.level, g.x, g.y, x, y) ? r : r * 0.55;
    if (d > eff) return;
    const loud = kind === "shot" || kind === "explosion";
    if (loud) {
      g.lkp = { x: x + (this.rng.next() - 0.5) * 3, y: y + (this.rng.next() - 0.5) * 3 };
      if (g.state !== "COMBAT" && g.state !== "RAISING") {
        this.setState(g, "COMBAT"); g.suspicion = Math.max(g.suspicion, 0.7);
        this.bark(g, kind === "explosion" ? "What the hell was that?!" : "Shots fired!");
      }
      this.raise(2);
      return;
    }
    if (g.state === "COMBAT" || g.state === "RAISING") return;
    if (kind === "noisemaker") {
      // only the closest couple of guards come to look; everyone nearby turns toward it
      const closer = this.guards.filter(o => !o.down && o !== g && (o.state === "INVESTIGATING") && o.target && dist(o.target.x, o.target.y, x, y) < 2).length;
      if (closer >= 2) { g.angle = Math.atan2(y - g.y, x - g.x); return; }
    }
    if (g.state === "INVESTIGATING" && g.target && dist(g.target.x, g.target.y, x, y) < 2) return;
    g.target = { x, y };
    g.suspicion = Math.max(g.suspicion, kind === "step" ? 0.32 : 0.4);
    if (g.state === "SEARCHING") { g.lkp = { x, y }; g.search = []; return; }
    this.setState(g, "SUSPICIOUS");
    this.bark(g, kind === "noisemaker" ? "What was that?" : kind === "suppressed" ? "Was that a…?" : kind === "glass" ? "Something broke." : kind === "door" ? "Who's at the door?" : "Hear that?");
  }

  private startSearch(g: Guard, around: Vec) {
    this.setState(g, "SEARCHING"); g.lkp = { ...around }; g.search = this.searchPoints(around, 4); g.waitT = 0;
  }
  private searchPoints(around: Vec, n: number): Vec[] {
    const out: Vec[] = [];
    for (let k = 0; k < 40 && out.length < n; k++) {
      const x = Math.floor(around.x + (this.rng.next() - 0.5) * 12), y = Math.floor(around.y + (this.rng.next() - 0.5) * 10);
      if (walkable(this.level, x, y, 1) && this.level.tiles[y * this.level.w + x] !== T.DOOR) out.push({ x: x + 0.5, y: y + 0.5 });
    }
    return out;
  }

  private radioContact(g: Guard, x: number, y: number) {
    if (g.radioAt > this.t && g.panel !== -2) return;
    const when = this.t + (g.kind === "contractor" ? 0.5 : 0.9);
    g.radioAt = when;
    const where = this.roomName(x, y), whereIn = this.whereIn(x, y);
    setTimeoutGame(this, when, () => {
      if (g.down || g.radioJammedUntil > this.t) { if (!g.down) this.bark(g, "Radio's dead!"); return; }
      this.guardRadio(g, g.kind === "chief" && this.memorySpared() ? `It's the same crew as before, ${whereIn}. Everyone on me.` : `Contact ${whereIn}! All units respond.`);
      this.log(`Intruder sighted (${where})`, "red");
      this.raise(2);
      for (const o of this.guards) {
        if (o.down || o === g || o.state === "COMBAT" || o.state === "RAISING") continue;
        if (dist(o.x, o.y, x, y) < 26 || this.alert === 3) { o.lkp = { x, y }; this.setState(o, "COMBAT"); o.suspicion = Math.max(o.suspicion, 0.6); }
      }
    });
  }
  guardRadio(g: Guard, text: string) {
    const who = g.name ?? (g.kind === "contractor" ? "Contractor" : "Guard " + (g.id + 1));
    const near = dist(g.x, g.y, this.player.x, this.player.y) < 9;
    if (this.radioOwned || near) this.radio.push({ text, from: who, t: this.t, kind: this.radioOwned ? "guard" : "overheard" });
    this.sfx.play("radioChatter", { vol: this.radioOwned ? 0.6 : near ? 0.4 : 0.15 });
  }

  private maybeRaiseAlarm(g: Guard) {
    if (this.alert === 3 || g.kind === "chief" && g.seesPlayer) return;
    if (this.guards.some(o => o.state === "RAISING" && !o.down)) return;
    if (this.alert < 2 || g.stateT < 2.5) return;
    const panels = this.level.alarmPanels.map(i => this.level.interactables[i]).filter(Boolean);
    if (!panels.length) return;
    // the guard nearest to a panel runs for it
    const panel = panels.sort((a, b) => dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y))[0];
    const closer = this.guards.some(o => !o.down && o !== g && (o.state === "COMBAT" || o.state === "SEARCHING") && dist(o.x, o.y, panel.x, panel.y) < dist(g.x, g.y, panel.x, panel.y));
    if (closer) return;
    g.panel = panel.id; this.setState(g, "RAISING"); this.bark(g, "Hitting the alarm!");
  }

  // ------------------------------------------------------------------------------------------ cameras
  private updateCameras(dt: number) {
    const p = this.player, L = this.level;
    for (const c of L.cameras) {
      if (c.state !== "active") { c.suspicion = Math.max(0, c.suspicion - dt); continue; }
      c.angle = c.base + Math.sin(this.t * (6.283 / c.period) + c.phase) * c.sweep;
      if (p.hidden >= 0) { c.suspicion = Math.max(0, c.suspicion - dt * 0.5); continue; }
      const d = dist(c.x, c.y, p.x, p.y);
      const inCone = d < c.range * (0.45 + 0.55 * Math.max(p.light, 0.25)) && Math.abs(angDiff(c.angle, Math.atan2(p.y - c.y, p.x - c.x))) < c.fov / 2;
      if (inCone && los(L, c.x, c.y, p.x, p.y)) {
        c.suspicion = Math.min(1, c.suspicion + dt * (0.7 + p.light) * (this.alert >= 2 ? 2 : 1) * (p.crouch ? 0.8 : 1));
        if (c.suspicion >= 1 && this.t - c.reported > 12) {
          c.reported = this.t; this.stats.spotted++;
          const where = this.roomName(p.x, p.y);
          this.log(`Camera ${c.id + 1} recorded movement (${where})`, "amber");
          this.sfx.play("cameraAlarm", { x: c.x, y: c.y });
          if (this.alert >= 2) this.lockdown(`camera ${c.id + 1}`);
          else {
            this.raise(2);
            this.radio.push({ text: `Camera ${c.id + 1} has movement ${this.whereIn(p.x, p.y)}. Nearest unit check it out.`, from: "Security control", t: this.t, kind: this.radioOwned ? "guard" : "overheard" });
            this.sfx.play("radioChatter", { vol: 0.3 });
            const near = this.guards.filter(g => !g.down && g.state !== "COMBAT").sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)).slice(0, 2);
            for (const g of near) { g.lkp = { x: p.x, y: p.y }; this.setState(g, "COMBAT"); g.suspicion = 0.7; }
          }
        }
      } else c.suspicion = Math.max(0, c.suspicion - dt * 0.35);
    }
  }

  // ------------------------------------------------------------------------------------------ facility state
  raise(level: AlertLevel) {
    if (level > this.alert) {
      this.alert = level;
      if (level === 2) { this.stats.alarms++; this.log("Security alert raised", "red"); this.sfx.play("alertUp"); }
      if (level === 1) this.log("Security personnel searching", "amber");
    }
    if (level >= 1) this.alertCalmT = 0;
    this.maxAlert = Math.max(this.maxAlert, this.alert) as AlertLevel;
  }
  lockdown(by: string) {
    if (this.alert === 3) return;
    this.alert = 3; this.maxAlert = 3; this.stats.lockdown = true; this.stats.alarms++;
    this.lightDirty = true; this.reinforceT = 20;
    this.log(`FACILITY LOCKDOWN (alarm raised by ${by})`, "red");
    this.sfx.play("lockdown");
    this.handler("lockdown", "They've locked it down. Reinforcements are coming through the main gate. Get to the van, now.");
    for (const g of this.guards) if (!g.down && g.state !== "COMBAT") { g.lkp = { x: this.player.x, y: this.player.y }; this.startSearch(g, g.lkp); }
  }

  private updateFacility(dt: number) {
    // calm down when nobody has seen the intruder for a while
    const anyCombat = this.guards.some(g => !g.down && (g.state === "COMBAT" && g.seesPlayer));
    if (!anyCombat) this.alertCalmT += dt;
    if (this.alert === 2 && this.alertCalmT > 50) { this.alert = 1; this.alertCalmT = 0; this.log("Search continues: intruder not located", "dim"); this.radio.push({ text: "No sign of them. Stay sharp, keep sweeping.", from: "Security control", t: this.t, kind: this.radioOwned ? "guard" : "overheard" }); }
    else if (this.alert === 1 && this.alertCalmT > 60 && !this.zeroHourPassed) { this.alert = 0; this.alertCalmT = 0; this.log("Search called off", "dim"); }
    // zero hour: shift change
    if (!this.zeroHourPassed && this.t >= ZERO_HOUR - 60) this.handler("zh60", "Two minutes to zero hour. The next shift is already in the car park.");
    if (!this.zeroHourPassed && this.t >= ZERO_HOUR) {
      this.zeroHourPassed = true;
      this.log("00:00 shift change: second security team on site", "red");
      this.handler("zh", "Zero hour. The second shift is inside. Everything's harder from here. Get out.");
      this.sfx.play("zeroHour");
      this.raise(1);
      for (let k = 0; k < 3; k++) this.reinforce(false);
    }
    if (this.alert === 3) {
      this.reinforceT -= dt;
      if (this.reinforceT <= 0 && this.guards.filter(g => g.reinforcement && !g.down).length < 6) { this.reinforceT = 35; this.reinforce(true); this.reinforce(true); }
    }
    // sabotage charge
    if (this.charge && !this.charge.detonated) {
      this.charge.t -= dt;
      if (this.charge.t <= 0) {
        this.charge.detonated = true;
        this.sfx.play("explosion", { x: this.charge.x, y: this.charge.y });
        this.shake = 1;
        for (let k = 0; k < 40; k++) this.particles.push({ x: this.charge.x, y: this.charge.y, vx: (this.rng.next() - 0.5) * 12, vy: (this.rng.next() - 0.5) * 12, life: 1.5, max: 1.5, kind: k % 3 ? "smoke" : "spark", size: 0.3 });
        this.log(`Explosion: ${this.roomName(this.charge.x, this.charge.y)} destroyed`, "red");
        this.detonatedBefore0 = this.t < ZERO_HOUR;
        this.noise(this.charge.x, this.charge.y, 40, "explosion");
        this.lockdown("automatic fire systems");
        for (const g of this.guards) if (!g.down && dist(g.x, g.y, this.charge.x, this.charge.y) < 3) this.downGuard(g, "dead");
      }
    }
  }
  detonatedBefore0 = false;

  private reinforce(combat: boolean) {
    const e = this.level.entrances[0];
    const d = this.level.doors[e.door]; d.open = true; d.lock = 0;
    const kind = this.level.guards.some(g => g.kind === "contractor") || this.alert === 3 ? "contractor" : "guard";
    const lobby = this.level.rooms[d.rooms[0]];
    const route = [{ x: lobby.x + lobby.w / 2, y: lobby.y + lobby.h / 2 }, { x: lobby.x + 2, y: lobby.y + 2 }];
    this.spawnGuard({ x: e.spawn.x + (this.rng.next() - 0.5), y: e.spawn.y, route, kind, key: 1, facing: Math.PI / 2 }, true);
    const g = this.guards[this.guards.length - 1];
    if (combat) { g.lkp = { x: this.player.x, y: this.player.y }; this.setState(g, "SEARCHING"); g.search = this.searchPoints(g.lkp, 4); }
  }

  // ------------------------------------------------------------------------------------------ effects, map
  private updateEffects(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    for (const pt of this.particles) {
      pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      const drag = pt.kind === "blood" ? 8 : pt.kind === "smoke" ? 1.5 : 4; pt.vx *= Math.exp(-drag * dt); pt.vy *= Math.exp(-drag * dt);
    }
    this.particles = this.particles.filter(p => p.life > 0).slice(-400);
    this.tracers = this.tracers.filter(t => this.t - t.t < 0.12);
    this.noises = this.noises.filter(n => this.t - n.t < 1);
    this.radio = this.radio.filter(r => this.t - r.t < 7);
  }

  private exploreT = 0;
  private updateExplored() {
    this.exploreT -= 1 / 60;
    if (this.exploreT > 0) return;
    this.exploreT = 0.15;
    const p = this.player, L = this.level;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const d = castRay(L, p.x, p.y, a, 14);
      for (let s = 0; s <= d + 0.6; s += 0.4) {
        const x = Math.floor(p.x + Math.cos(a) * s), y = Math.floor(p.y + Math.sin(a) * s);
        if (x >= 0 && y >= 0 && x < L.w && y < L.h) this.explored[y * L.w + x] = 1;
      }
    }
  }

  /** How close anyone is to spotting the player, and from which directions (for HUD indicators). */
  exposure(): { max: number; dirs: { angle: number; level: number; cam: boolean }[] } {
    const p = this.player; const dirs: { angle: number; level: number; cam: boolean }[] = [];
    let max = 0;
    for (const g of this.guards) {
      if (g.down || g.suspicion < 0.05) continue;
      if (g.state === "COMBAT" && !g.seesPlayer) continue;
      dirs.push({ angle: Math.atan2(g.y - p.y, g.x - p.x), level: g.suspicion, cam: false }); max = Math.max(max, g.suspicion);
    }
    for (const c of this.level.cameras) if (c.suspicion > 0.05 && c.state === "active") { dirs.push({ angle: Math.atan2(c.y - p.y, c.x - p.x), level: c.suspicion, cam: true }); max = Math.max(max, c.suspicion); }
    return { max, dirs };
  }

  objectiveText(): string {
    const c = this.contract;
    const name = LOOT[c.targetItem]?.name ?? "the target";
    if (this.charge && !this.charge.detonated) return `Charge detonates in ${Math.ceil(this.charge.t)}s. Get clear`;
    if (this.objectiveDone || this.hostageOk()) return c.type === "rescue" ? "Walk Castell to the service road van" : "Extract: service road van (or keep looting)";
    switch (c.type) {
      case "steal": return `Find and take the ${name}`;
      case "data": return "Download the files from a server terminal";
      case "sabotage": return "Plant the charge on the research hardware";
      case "rescue": return this.hostage?.state === "held" ? "Find and free the detainee" : "Keep the detainee close. Get them to the van";
      case "investigate": return `Scan evidence (${this.evidence}/3)`;
    }
  }
  objectiveRoomKnown(): boolean { return this.level.rooms[this.level.objectiveRoom] ? this.explored[(this.level.rooms[this.level.objectiveRoom].y + 1) * this.level.w + this.level.rooms[this.level.objectiveRoom].x + 1] === 1 : false; }

  // ------------------------------------------------------------------------------------------ end
  abort() { if (this.status === "playing") { this.log("Operative withdrew (signal lost)", "dim"); this.finish("aborted"); } }
  private finish(outcome: "extracted" | "killed" | "aborted") {
    if (this.ended) return;
    this.ended = true;
    if (outcome === "extracted") {
      this.log(`Unauthorised exit via ${this.level.extraction.name.toLowerCase()}`, this.objectiveDone || this.hostageOk() ? "red" : "amber");
      this.sfx.play("extract");
    }
    if (outcome === "killed") this.sfx.play("death");
    this.status = outcome === "extracted" ? "extracted" : outcome === "killed" ? "dead" : "aborted";
    const opt: string[] = [];
    const lootValue = this.player.inv.reduce((a, id) => a + (LOOT[id]?.value ?? 0), 0);
    if (this.maxAlert <= 1) opt.push("ghost");
    if (this.stats.kills === 0) opt.push("nonlethal");
    if (this.safeOpened && this.player.inv.some(i => i === "gold" || i === "watch" || i === "rare_manifest")) opt.push("safe");
    if (this.stats.looped) opt.push("loop");
    if (lootValue >= 1200) opt.push("haul");
    if (this.detonatedBefore0) opt.push("beforezero");
    const rescued = this.contract.type === "rescue" && outcome === "extracted" && this.hostageOk();
    const objectiveDone = this.contract.type === "rescue" ? rescued : this.objectiveDone;
    const result: MissionResult = {
      outcome, objectiveDone, optionalsDone: opt, loot: [...this.player.inv], entry: this.entry, alarms: this.stats.alarms, lockdown: this.stats.lockdown,
      kills: this.stats.kills, kos: this.stats.kos, camerasDestroyed: this.stats.camerasDestroyed, camerasEmped: this.stats.camerasEmped,
      loopedFeeds: this.stats.looped, panelsSabotaged: this.stats.panels, chief: this.stats.chief, explored: encodeExplored(this.explored),
      events: this.events, duration: this.t, zeroHourPassed: this.zeroHourPassed, shotsFired: this.stats.shots, hostageRescued: rescued, spotted: this.stats.spotted,
    };
    const cb = this.onEnd;
    setTimeout(() => cb?.(result), outcome === "extracted" ? 1600 : 2200);
  }

  facilityName() { return FACILITIES[this.contract.facility].name; }
}

// scheduled callbacks on the game clock (paused with the game)
const pending = new WeakMap<Game, { at: number; fn: () => void }[]>();
function setTimeoutGame(g: Game, at: number, fn: () => void) {
  const list = pending.get(g) ?? []; list.push({ at, fn }); pending.set(g, list);
}
export function runScheduled(g: Game) {
  const list = pending.get(g); if (!list) return;
  const due = list.filter(x => x.at <= g.t);
  if (!due.length) return;
  pending.set(g, list.filter(x => x.at > g.t));
  for (const d of due) d.fn();
}

function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (-b + Math.sqrt(disc) >= 0 ? 0 : -1);
}
