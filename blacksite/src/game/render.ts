// Canvas renderer: static facility layer, per-tile lighting that respects walls, flashlights,
// fog of war with remembered areas, weather and post effects.
import { castRay, los, visibilityPolygon } from "./geom";
import { dist } from "./rng";
import type { Game, Guard } from "./engine";
import { ZERO_HOUR } from "./engine";
import type { Level, RoomType, Settings } from "./types";
import { T } from "./types";
import { LOOT } from "./catalog";

export const PX = 32;

const FLOOR: Record<RoomType, [string, string]> = {
  lobby: ["#2c2e30", "#303234"], office: ["#2a2c2f", "#2d2f32"], security: ["#25292d", "#282c30"], server: ["#1c2127", "#20252b"],
  lab: ["#2b3134", "#2f3538"], storage: ["#27282a", "#2a2b2d"], armory: ["#24262a", "#27292d"], executive: ["#2b2420", "#2e2723"],
  maintenance: ["#232526", "#26282a"], dock: ["#252729", "#28292b"], holding: ["#26282a", "#292b2d"], vault: ["#22252a", "#25282d"],
};

function noiseCanvas(size: number, alpha: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const x = c.getContext("2d")!; const img = x.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = alpha; }
  x.putImageData(img, 0, 0); return c;
}

/** Pre-renders the facility's floors, walls and furniture. */
export function buildStatic(L: Level): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = L.w * PX; c.height = L.h * PX;
  const x = c.getContext("2d")!;
  // exterior: wet asphalt
  x.fillStyle = "#121518"; x.fillRect(0, 0, c.width, c.height);
  const grit = noiseCanvas(128, 18);
  x.fillStyle = x.createPattern(grit, "repeat")!; x.fillRect(0, 0, c.width, c.height);
  // puddles
  for (let k = 0; k < 40; k++) {
    const px = ((k * 7919) % L.w) * PX, py = ((k * 104729) % L.h) * PX;
    const g = x.createRadialGradient(px, py, 0, px, py, 60 + (k % 5) * 20);
    g.addColorStop(0, "rgba(120,140,160,0.10)"); g.addColorStop(1, "rgba(120,140,160,0)");
    x.fillStyle = g; x.fillRect(px - 120, py - 120, 240, 240);
  }
  // road markings along the top
  x.strokeStyle = "rgba(210,190,120,0.18)"; x.lineWidth = 3; x.setLineDash([22, 18]);
  x.beginPath(); x.moveTo(0, 2.2 * PX); x.lineTo(c.width, 2.2 * PX); x.stroke(); x.setLineDash([]);
  // floors
  for (let y = 0; y < L.h; y++) for (let xx = 0; xx < L.w; xx++) {
    const t = L.tiles[y * L.w + xx];
    if (t === T.EXT || t === T.VOID) continue;
    const r = L.roomAt[y * L.w + xx];
    const pal = r >= 0 ? FLOOR[L.rooms[r].type] : ["#2a2c2e", "#2c2e30"];
    x.fillStyle = (xx + y) % 2 ? pal[0] : pal[1];
    x.fillRect(xx * PX, y * PX, PX, PX);
  }
  x.fillStyle = x.createPattern(noiseCanvas(96, 10), "repeat")!;
  for (const r of L.rooms) x.fillRect(r.x * PX, r.y * PX, r.w * PX, r.h * PX);
  // room-specific floor detail
  for (const r of L.rooms) {
    x.save(); x.beginPath(); x.rect(r.x * PX, r.y * PX, r.w * PX, r.h * PX); x.clip();
    if (r.type === "server" || r.type === "maintenance") {
      x.strokeStyle = "rgba(120,150,180,0.06)"; x.lineWidth = 1;
      for (let gx = r.x; gx <= r.x + r.w; gx++) { x.beginPath(); x.moveTo(gx * PX, r.y * PX); x.lineTo(gx * PX, (r.y + r.h) * PX); x.stroke(); }
      for (let gy = r.y; gy <= r.y + r.h; gy++) { x.beginPath(); x.moveTo(r.x * PX, gy * PX); x.lineTo((r.x + r.w) * PX, gy * PX); x.stroke(); }
    }
    if (r.type === "lab" || r.type === "holding") {
      x.strokeStyle = "rgba(220,230,235,0.05)";
      for (let gx = r.x * 2; gx <= (r.x + r.w) * 2; gx++) { x.beginPath(); x.moveTo(gx * PX / 2, r.y * PX); x.lineTo(gx * PX / 2, (r.y + r.h) * PX); x.stroke(); }
    }
    if (r.type === "executive") { x.fillStyle = "rgba(90,40,30,0.25)"; x.fillRect((r.x + 2) * PX, (r.y + 2) * PX, (r.w - 4) * PX, (r.h - 4) * PX); }
    if (r.type === "dock") {
      x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(r.x * PX, (r.y + r.h - 2) * PX, r.w * PX, 2 * PX);
      x.strokeStyle = "rgba(200,170,60,0.22)"; x.lineWidth = 6; x.setLineDash([14, 14]);
      x.beginPath(); x.moveTo(r.x * PX, (r.y + r.h - 2) * PX); x.lineTo((r.x + r.w) * PX, (r.y + r.h - 2) * PX); x.stroke(); x.setLineDash([]);
    }
    if (r.type === "vault") { x.strokeStyle = "rgba(200,60,50,0.18)"; x.lineWidth = 2; x.strokeRect((r.x + 1.5) * PX, (r.y + 1.5) * PX, (r.w - 3) * PX, (r.h - 3) * PX); }
    x.restore();
  }
  // wall shadows (walls cast a soft shadow down-right, sells the top-down depth)
  x.fillStyle = "rgba(0,0,0,0.45)";
  for (let y = 0; y < L.h; y++) for (let xx = 0; xx < L.w; xx++) if (L.tiles[y * L.w + xx] === T.WALL) x.fillRect(xx * PX + 5, y * PX + 7, PX, PX);
  // props
  for (const p of L.props) drawProp(x, p);
  // walls
  for (let y = 0; y < L.h; y++) for (let xx = 0; xx < L.w; xx++) {
    if (L.tiles[y * L.w + xx] !== T.WALL) continue;
    x.fillStyle = "#3b3f44"; x.fillRect(xx * PX, y * PX, PX, PX);
    x.fillStyle = "#555b62"; x.fillRect(xx * PX, y * PX, PX, 5);
    const below = L.tiles[(y + 1) * L.w + xx];
    if (below !== T.WALL) { x.fillStyle = "#23262a"; x.fillRect(xx * PX, y * PX + PX - 6, PX, 6); }
  }
  // exterior building edge
  let minX = L.w, minY = L.h, maxX = 0, maxY = 0;
  for (const r of L.rooms) { minX = Math.min(minX, r.x - 1); minY = Math.min(minY, r.y - 1); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
  x.strokeStyle = "rgba(0,0,0,0.6)"; x.lineWidth = 10; x.strokeRect(minX * PX - 5, minY * PX - 5, (maxX - minX + 1) * PX + 10, (maxY - minY + 1) * PX + 10);
  // extraction van
  const ex = L.extraction;
  x.save(); x.translate(ex.x * PX, ex.y * PX);
  x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(-2.1 * PX + 6, -0.9 * PX + 8, 4.2 * PX, 1.8 * PX);
  x.fillStyle = "#1e2124"; x.fillRect(-2.1 * PX, -0.9 * PX, 4.2 * PX, 1.8 * PX);
  x.fillStyle = "#2b2f33"; x.fillRect(-2.1 * PX, -0.9 * PX, 1.2 * PX, 1.8 * PX);
  x.fillStyle = "#101214"; x.fillRect(-1.95 * PX, -0.75 * PX, 0.7 * PX, 1.5 * PX);
  x.restore();
  return c;
}

function drawProp(x: CanvasRenderingContext2D, p: Level["props"][number]) {
  const X = p.x * PX, Y = p.y * PX, W = p.w * PX, H = p.h * PX;
  x.fillStyle = "rgba(0,0,0,0.4)"; x.fillRect(X + 4, Y + 5, W, H);
  const box = (fill: string, top?: string, inset = 3) => { x.fillStyle = fill; x.fillRect(X + inset, Y + inset, W - inset * 2, H - inset * 2); if (top) { x.fillStyle = top; x.fillRect(X + inset, Y + inset, W - inset * 2, 3); } };
  switch (p.kind) {
    case "desk": case "execdesk": case "reception": case "console": case "bench":
      box(p.kind === "execdesk" ? "#3a2c24" : p.kind === "bench" ? "#465055" : "#35373a", "#4a4d51", 2);
      if (p.kind !== "bench") { x.fillStyle = "#15191d"; for (let i = 0; i < p.w; i++) x.fillRect(X + i * PX + 8, Y + 6, 14, 9); }
      if (p.kind === "console") { x.fillStyle = "rgba(120,200,255,0.35)"; for (let i = 0; i < p.w; i++) x.fillRect(X + i * PX + 9, Y + 7, 12, 7); }
      if (p.kind === "bench") { x.fillStyle = "rgba(200,230,255,0.25)"; for (let i = 0; i < p.w; i++) { x.beginPath(); x.arc(X + i * PX + 16, Y + 16, 4, 0, 7); x.fill(); } }
      break;
    case "cabinet": case "bookshelf": box("#2e3135", "#474b50", 2); x.strokeStyle = "rgba(0,0,0,0.5)"; x.beginPath(); x.moveTo(X + 4, Y + H / 2); x.lineTo(X + W - 4, Y + H / 2); x.stroke(); break;
    case "rack": {
      box("#15181c", "#2a2f36", 2);
      for (let i = 0; i < p.h; i++) { x.fillStyle = "#0c0e10"; x.fillRect(X + 5, Y + i * PX + 6, W - 10, PX - 10); }
      break;
    }
    case "shelf": box("#3a3530", "#57504a", 2); for (let i = 0; i < p.w; i++) { x.fillStyle = ["#6b5b45", "#4d5058", "#5b4e3e"][i % 3]; x.fillRect(X + i * PX + 6, Y + 8, 20, 16); } break;
    case "crate": box("#4a3f30", "#5f523f", 3); x.strokeStyle = "rgba(0,0,0,0.35)"; x.lineWidth = 2; x.beginPath(); x.moveTo(X + 5, Y + 5); x.lineTo(X + W - 5, Y + H - 5); x.stroke(); x.lineWidth = 1; break;
    case "tank": x.fillStyle = "#1c2a2e"; x.beginPath(); x.arc(X + 16, Y + 16, 12, 0, 7); x.fill(); x.fillStyle = "rgba(120,220,200,0.25)"; x.beginPath(); x.arc(X + 16, Y + 16, 9, 0, 7); x.fill(); break;
    case "fridge": box("#c9ccd0", "#e1e4e7", 3); break;
    case "gunrack": box("#232629", "#3b3f44", 2); x.strokeStyle = "#555"; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(X + 8 + i * 7, Y + 6); x.lineTo(X + 8 + i * 7, Y + 26); x.stroke(); } break;
    case "safe": box("#2d3033", "#4a4e53", 3); x.strokeStyle = "#777"; x.beginPath(); x.arc(X + 16, Y + 16, 5, 0, 7); x.stroke(); break;
    case "boiler": box("#3a3025", "#5a4a38", 3); x.fillStyle = "rgba(255,120,40,0.25)"; x.fillRect(X + W / 2 - 6, Y + H - 14, 12, 6); break;
    case "pipes": x.fillStyle = "#3d4247"; x.fillRect(X + 6, Y, 8, H); x.fillRect(X + 18, Y, 6, H); break;
    case "locker": box("#394048", "#56606b", 3); x.strokeStyle = "rgba(0,0,0,0.5)"; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(X + 9, Y + 8 + i * 4); x.lineTo(X + 23, Y + 8 + i * 4); x.stroke(); } break;
    case "trailer": box("#2a2e33", "#40464d", 2); x.strokeStyle = "rgba(0,0,0,0.4)"; for (let i = 1; i < p.w; i++) { x.beginPath(); x.moveTo(X + i * PX, Y + 4); x.lineTo(X + i * PX, Y + H - 4); x.stroke(); } break;
    case "plant": x.fillStyle = "#2a3a2b"; x.beginPath(); x.arc(X + 16, Y + 16, 11, 0, 7); x.fill(); x.fillStyle = "#34503a"; x.beginPath(); x.arc(X + 13, Y + 13, 6, 0, 7); x.fill(); break;
    case "bars": x.fillStyle = "#4b5157"; for (let i = 0; i < 4; i++) x.fillRect(X + 3 + i * 8, Y + 4, 3, H - 8); x.fillRect(X, Y + H / 2 - 2, W, 4); break;
    case "deposit": box("#2f3337", "#4c5157", 2); x.fillStyle = "#1a1c1f"; for (let i = 0; i < 4; i++) x.fillRect(X + 6 + (i % 2) * 11, Y + 6 + Math.floor(i / 2) * 11, 8, 8); break;
    case "pedestal": x.fillStyle = "#3b3f44"; x.fillRect(X + 6, Y + 6, W - 12, H - 12); x.strokeStyle = "rgba(255,240,210,0.3)"; x.strokeRect(X + 6, Y + 6, W - 12, H - 12); break;
    case "terminal": box("#1c2126", "#2e343b", 4); x.fillStyle = "rgba(120,200,255,0.4)"; x.fillRect(X + 9, Y + 8, 14, 10); break;
    default: box("#34373b", "#4a4e53", 3);
  }
}

// ------------------------------------------------------------------------------------------------ frame renderer
export class Renderer {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  game: Game; stat: HTMLCanvasElement;
  dark = document.createElement("canvas"); fog = document.createElement("canvas");
  lightImg: HTMLCanvasElement; fogImg: HTMLCanvasElement;
  private lightVersion = -1; private fogStamp = -1;
  private grain = noiseCanvas(160, 22);
  private rain: { x: number; y: number; s: number }[] = [];
  cam = { x: 0, y: 0, zoom: 1 };
  settings: Settings;
  visPoly: { x: number; y: number }[] = [];

  constructor(canvas: HTMLCanvasElement, game: Game, settings: Settings) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d")!;
    this.game = game; this.settings = settings;
    this.stat = buildStatic(game.level);
    this.lightImg = document.createElement("canvas"); this.lightImg.width = game.level.w; this.lightImg.height = game.level.h;
    this.fogImg = document.createElement("canvas"); this.fogImg.width = game.level.w; this.fogImg.height = game.level.h;
    for (let i = 0; i < 260; i++) this.rain.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });
    this.cam.x = game.player.x; this.cam.y = game.player.y;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.dark.width = this.fog.width = Math.ceil(this.canvas.width / 2); this.dark.height = this.fog.height = Math.ceil(this.canvas.height / 2);
    }
  }

  /** screen px -> world tiles */
  toWorld(sx: number, sy: number) {
    const dpr = this.canvas.width / this.canvas.clientWidth;
    const s = PX * this.cam.zoom;
    return { x: (sx * dpr - this.canvas.width / 2) / s + this.cam.x, y: (sy * dpr - this.canvas.height / 2) / s + this.cam.y };
  }

  private updateLightImg() {
    const g = this.game, L = g.level;
    const x = this.lightImg.getContext("2d")!; const img = x.createImageData(L.w, L.h);
    for (let i = 0; i < L.w * L.h; i++) {
      const l = g.lightmap[i];
      const a = Math.round(255 * Math.min(0.86, Math.max(0.02, 0.86 - l * 1.25)));
      img.data[i * 4] = g.alert === 3 ? 26 : 2; img.data[i * 4 + 1] = 3; img.data[i * 4 + 2] = 6; img.data[i * 4 + 3] = a;
    }
    x.putImageData(img, 0, 0);
  }
  private updateFogImg() {
    const g = this.game, L = g.level;
    const x = this.fogImg.getContext("2d")!; const img = x.createImageData(L.w, L.h);
    for (let i = 0; i < L.w * L.h; i++) { img.data[i * 4 + 3] = g.explored[i] ? 125 : 255; img.data[i * 4] = 4; img.data[i * 4 + 1] = 5; img.data[i * 4 + 2] = 8; }
    x.putImageData(img, 0, 0);
  }

  guardVisible(gd: Guard): boolean {
    const g = this.game, p = g.player;
    if (g.spectator) return true;
    if (g.thermalUntil > g.t && dist(p.x, p.y, gd.x, gd.y) < 18) return true;
    const d = dist(p.x, p.y, gd.x, gd.y);
    if (d > 17) return false;
    if (!los(g.level, p.x, p.y, gd.x, gd.y)) return false;
    return d < 5 || g.lightAt(gd.x, gd.y) > 0.16 || g.flashlightOn(gd);
  }

  draw(dt: number) {
    const g = this.game, L = g.level, p = g.player, ctx = this.ctx;
    this.resize();
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H || !this.dark.width || !this.dark.height) return;
    // camera: follow with a little look-ahead toward the aim point
    const look = 0.22;
    const tx = p.x + (g.input.mouseX - p.x) * look, ty = p.y + (g.input.mouseY - p.y) * look;
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.cam.zoom = Math.max(0.9, Math.min(2.2, H / (PX * 19)));
    const s = PX * this.cam.zoom;
    const shake = this.settings.shake ? g.shake * 0.25 : 0;
    const ox = W / 2 - (this.cam.x + (Math.random() - 0.5) * shake) * s, oy = H / 2 - (this.cam.y + (Math.random() - 0.5) * shake) * s;
    const wx = (x: number) => ox + x * s, wy = (y: number) => oy + y * s;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#07090c"; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.stat, ox, oy, L.w * s, L.h * s);

    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    // ---- world-space dynamic objects (under lighting)
    this.drawExtraction(ctx);
    this.drawDecals(ctx);
    this.drawDoors(ctx);
    this.drawInteractables(ctx);
    this.drawCameras(ctx);
    for (const gd of g.guards) if (gd.down && this.guardVisible(gd)) this.drawGuard(ctx, gd);
    if (g.hostage && g.hostage.state !== "out") this.drawHostage(ctx);
    this.drawPlayer(ctx);
    for (const gd of g.guards) if (!gd.down && this.guardVisible(gd)) this.drawGuard(ctx, gd);
    this.drawProjectiles(ctx);
    this.drawTracers(ctx);
    this.drawParticles(ctx, false);
    ctx.restore();

    // ---- lighting
    if (this.lightVersion !== g.lightVersion) { this.updateLightImg(); this.lightVersion = g.lightVersion; }
    const d = this.dark.getContext("2d")!;
    const hs = 0.5;
    d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, this.dark.width, this.dark.height);
    d.imageSmoothingEnabled = true;
    d.drawImage(this.lightImg, ox * hs, oy * hs, L.w * s * hs, L.h * s * hs);
    d.save(); d.translate(ox * hs, oy * hs); d.scale(s * hs, s * hs);
    d.globalCompositeOperation = "destination-out";
    // flicker: occasionally dips a flickering fluorescent
    for (const l of L.lights) if (l.flicker && l.on && !l.offUntil && Math.sin(g.t * 13 + l.id * 7) > 0.93) {
      d.globalCompositeOperation = "source-over"; d.fillStyle = "rgba(2,3,6,0.35)"; d.beginPath(); d.arc(l.x, l.y, l.r * 0.8, 0, 7); d.fill(); d.globalCompositeOperation = "destination-out";
    }
    // guard flashlights
    for (const gd of g.guards) {
      if (!g.flashlightOn(gd)) continue;
      if (dist(gd.x, gd.y, p.x, p.y) > 24) continue;
      const pts = visibilityPolygon(L, gd.x, gd.y, 7.5, 18, gd.angle - 0.36, 0.72);
      const grad = d.createRadialGradient(gd.x, gd.y, 0.2, gd.x, gd.y, 7.5);
      grad.addColorStop(0, "rgba(0,0,0,0.85)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = grad; d.beginPath(); d.moveTo(gd.x, gd.y); for (const q of pts) d.lineTo(q.x, q.y); d.closePath(); d.fill();
    }
    // player's own faint light (so you can always read your surroundings a little)
    if (!g.spectator) {
      const pg = d.createRadialGradient(p.x, p.y, 0, p.x, p.y, 4.2);
      pg.addColorStop(0, "rgba(0,0,0,0.55)"); pg.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = pg; d.beginPath(); d.arc(p.x, p.y, 4.2, 0, 7); d.fill();
    }
    // muzzle flashes and blasts
    const flash = (m: { x: number; y: number; t: number } | null, r: number, dur: number) => {
      if (!m || g.t - m.t > dur) return; const a = 1 - (g.t - m.t) / dur;
      const gr = d.createRadialGradient(m.x, m.y, 0, m.x, m.y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr; d.beginPath(); d.arc(m.x, m.y, r, 0, 7); d.fill();
    };
    flash(g.muzzle, p.weapon === "pistol" ? 2.2 : 5, 0.07); flash(g.muzzleEnemy, 4.5, 0.07);
    d.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.dark, 0, 0, W, H);

    // coloured light bloom (additive, subtle)
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    ctx.globalCompositeOperation = "lighter";
    for (const l of L.lights) {
      if (!l.on || l.offUntil > g.t) continue;
      if (Math.abs(l.x - p.x) > 20 || Math.abs(l.y - p.y) > 14) continue;
      const a = (g.alert === 3 ? 0.05 : 0.07) * l.i;
      const gr = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.9);
      gr.addColorStop(0, hexA(g.alert === 3 ? "#ff3322" : l.color, a)); gr.addColorStop(1, hexA(l.color, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 0.9, 0, 7); ctx.fill();
    }
    if (g.empFlash && g.t - g.empFlash.t < 0.6) {
      const a = 1 - (g.t - g.empFlash.t) / 0.6; const e = g.empFlash;
      const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 5 * (1.2 - a * 0.5)); gr.addColorStop(0, `rgba(140,190,255,${a * 0.5})`); gr.addColorStop(1, "rgba(140,190,255,0)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    this.drawParticles(ctx, true);
    ctx.restore();

    // ---- fog of war
    if (this.fogStamp !== Math.floor(g.t * 4)) { this.updateFogImg(); this.fogStamp = Math.floor(g.t * 4); }
    const f = this.fog.getContext("2d")!;
    f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = "source-over";
    f.fillStyle = "rgb(4,5,8)"; f.fillRect(0, 0, this.fog.width, this.fog.height);
    f.clearRect(ox * hs, oy * hs, L.w * s * hs, L.h * s * hs);
    f.imageSmoothingEnabled = true;
    f.drawImage(this.fogImg, ox * hs, oy * hs, L.w * s * hs, L.h * s * hs);
    if (!g.spectator) {
      f.save(); f.translate(ox * hs, oy * hs); f.scale(s * hs, s * hs);
      f.globalCompositeOperation = "destination-out";
      this.visPoly = p.hidden >= 0 ? visibilityPolygon(L, p.x, p.y, 2.5, 90) : visibilityPolygon(L, p.x, p.y, 17, 300);
      f.fillStyle = "#000"; f.beginPath(); this.visPoly.forEach((q, i) => (i ? f.lineTo(q.x, q.y) : f.moveTo(q.x, q.y))); f.closePath(); f.fill();
      f.restore();
    }
    if (!g.spectator)     ctx.drawImage(this.fog, 0, 0, W, H);

    // ---- above fog: thermal, own noise, barks
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    if (g.thermalUntil > g.t) {
      const a = Math.min(1, (g.thermalUntil - g.t) / 0.6);
      for (const gd of g.guards) {
        if (gd.down || dist(gd.x, gd.y, p.x, p.y) > 18) continue;
        ctx.fillStyle = `rgba(255,140,60,${0.55 * a})`; ctx.beginPath(); ctx.arc(gd.x, gd.y, 0.42, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(255,190,120,${0.8 * a})`; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(gd.x, gd.y); ctx.lineTo(gd.x + Math.cos(gd.angle) * 0.8, gd.y + Math.sin(gd.angle) * 0.8); ctx.stroke();
      }
      const r = (1 - (g.thermalUntil - g.t) / 3) * 18;
      ctx.strokeStyle = `rgba(255,150,80,${0.25 * a})`; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
    }
    for (const n of g.noises) {
      if (dist(n.x, n.y, p.x, p.y) > 0.8 || n.kind === "shot" || n.kind === "explosion") continue;
      const age = (g.t - n.t) / 0.9;
      ctx.strokeStyle = `rgba(210,220,230,${0.16 * (1 - age)})`; ctx.lineWidth = 0.04;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * Math.min(1, age * 1.4), 0, 7); ctx.stroke();
    }
    for (const n of g.noises) if (n.kind === "noisemaker" && g.t - n.t < 0.9) {
      const age = (g.t - n.t) / 0.9; ctx.strokeStyle = `rgba(230,180,90,${0.3 * (1 - age)})`; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * age, 0, 7); ctx.stroke();
    }
    ctx.font = "600 0.36px 'Barlow Condensed', 'Arial Narrow', sans-serif"; ctx.textAlign = "center";
    for (const gd of g.guards) {
      if (gd.down || !gd.bark || !this.guardVisible(gd)) continue;
      const a = Math.min(1, 2.6 - (g.t - gd.bark.t));
      ctx.fillStyle = `rgba(0,0,0,${0.55 * a})`;
      const tw = ctx.measureText(gd.bark.text).width + 0.3;
      ctx.fillRect(gd.x - tw / 2, gd.y - 1.25, tw, 0.46);
      ctx.fillStyle = gd.state === "COMBAT" || gd.state === "RAISING" ? `rgba(255,120,100,${a})` : `rgba(235,230,215,${a})`;
      ctx.fillText(gd.bark.text, gd.x, gd.y - 0.9);
    }
    // interaction progress ring
    if (g.holding && g.prompt && g.prompt.hold && g.prompt.progress > 0) {
      ctx.strokeStyle = "rgba(240,200,120,0.9)"; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, g.prompt.progress)); ctx.stroke();
    }
    ctx.restore();

    // ---- screen effects
    if (g.outside(this.cam.x, this.cam.y)) this.drawRain(ctx, W, H, dt);
    if (g.alert === 3) {
      const a = 0.08 + 0.06 * Math.sin(g.t * 5.5);
      ctx.fillStyle = `rgba(160,10,5,${a})`; ctx.fillRect(0, 0, W, H);
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (g.hurtFlash > 0) {
      const hg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      hg.addColorStop(0, "rgba(120,0,0,0)"); hg.addColorStop(1, `rgba(150,10,5,${0.55 * g.hurtFlash})`);
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    }
    if (p.hp / p.maxHp < 0.35 && g.status === "playing") { ctx.fillStyle = `rgba(90,0,0,${0.12 + 0.06 * Math.sin(g.t * 6)})`; ctx.fillRect(0, 0, W, H); }
    if (p.hidden >= 0 && !g.spectator) {
      // peering through locker slats
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      for (let y = 0; y < H; y += 18 * (W / 1200)) ctx.fillRect(0, y, W, 10 * (W / 1200));
    }
    if (this.settings.effects) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = ctx.createPattern(this.grain, "repeat")!;
      ctx.save(); ctx.translate(Math.random() * 160, Math.random() * 160); ctx.fillRect(-160, -160, W + 320, H + 320); ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.08)"; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    }
    if (g.status === "dead") { ctx.fillStyle = "rgba(20,0,0,0.5)"; ctx.fillRect(0, 0, W, H); }
    if (!g.spectator && g.status === "playing") this.drawIndicators(ctx, W, H, wx, wy);
  }

  /** Screen-space awareness arcs (who is noticing you, from where) and an edge marker toward extraction. */
  private drawIndicators(ctx: CanvasRenderingContext2D, W: number, H: number, wx: (x: number) => number, wy: (y: number) => number) {
    const g = this.game, p = g.player;
    const px = wx(p.x), py = wy(p.y);
    const R = Math.min(W, H) * 0.09;
    for (const d of g.exposure().dirs) {
      const col = d.level >= 1 ? "255,70,50" : d.level > 0.5 ? "255,140,60" : "240,200,110";
      ctx.strokeStyle = `rgba(${col},${0.35 + d.level * 0.6})`; ctx.lineWidth = 3 + d.level * 4;
      ctx.beginPath(); ctx.arc(px, py, R, d.angle - 0.22, d.angle + 0.22); ctx.stroke();
      if (d.cam) { ctx.fillStyle = `rgba(${col},0.8)`; ctx.beginPath(); ctx.arc(px + Math.cos(d.angle) * (R + 12), py + Math.sin(d.angle) * (R + 12), 3, 0, 7); ctx.fill(); }
    }
    if (g.objectiveDone || g.hostageOk()) {
      const ex = g.level.extraction;
      const sx = wx(ex.x), sy = wy(ex.y);
      const margin = Math.round(H * 0.14);
      if (sx < margin || sy < margin || sx > W - margin || sy > H - margin) {
        const a = Math.atan2(sy - H / 2, sx - W / 2);
        const t = Math.min((W / 2 - margin) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - margin) / Math.abs(Math.sin(a) || 1e-6));
        const ix = W / 2 + Math.cos(a) * t, iy = H / 2 + Math.sin(a) * t;
        ctx.save(); ctx.translate(ix, iy); ctx.rotate(a);
        ctx.fillStyle = "rgba(240,200,120,0.85)"; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, 9); ctx.lineTo(-2, 0); ctx.lineTo(-6, -9); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(240,200,120,0.85)"; ctx.font = `600 ${Math.round(H / 70)}px 'Barlow Condensed', sans-serif`; ctx.textAlign = "center";
        ctx.fillText(`EXFIL ${Math.round(dist(p.x, p.y, ex.x, ex.y) * 2)}m`, ix - Math.cos(a) * 30, iy - Math.sin(a) * 26 + 4);
      }
    }
  }

  private drawRain(ctx: CanvasRenderingContext2D, W: number, H: number, dt: number) {
    ctx.strokeStyle = "rgba(170,190,210,0.22)"; ctx.lineWidth = Math.max(1, W / 1400);
    ctx.beginPath();
    for (const r of this.rain) {
      r.y += dt * 1.6 * r.s; r.x += dt * 0.12 * r.s;
      if (r.y > 1) { r.y -= 1; r.x = Math.random(); }
      if (r.x > 1) r.x -= 1;
      const x = r.x * W, y = r.y * H;
      ctx.moveTo(x, y); ctx.lineTo(x + 3 * r.s, y + 18 * r.s);
    }
    ctx.stroke();
  }

  private drawExtraction(ctx: CanvasRenderingContext2D) {
    const g = this.game, ex = g.level.extraction;
    const ready = g.objectiveDone || g.hostageOk();
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 3);
    ctx.strokeStyle = ready ? `rgba(255,205,120,${0.35 + pulse * 0.35})` : "rgba(200,200,200,0.18)";
    ctx.lineWidth = 0.06; ctx.setLineDash([0.25, 0.2]);
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (g.extractT > 0) {
      ctx.strokeStyle = "rgba(255,215,140,0.95)"; ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, -Math.PI / 2, -Math.PI / 2 + (g.extractT / 3) * Math.PI * 2); ctx.stroke();
    }
    // tail lights
    ctx.fillStyle = `rgba(255,40,30,${0.5 + pulse * 0.3})`; ctx.fillRect(ex.x + 1.95, ex.y - 0.7, 0.12, 0.25); ctx.fillRect(ex.x + 1.95, ex.y + 0.45, 0.12, 0.25);
  }

  private drawDecals(ctx: CanvasRenderingContext2D) {
    for (const pt of this.game.particles) if (pt.kind === "blood") {
      ctx.fillStyle = `rgba(70,6,6,${0.7 * Math.min(1, pt.life / 2)})`; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * 1.4, 0, 7); ctx.fill();
    }
  }

  private drawDoors(ctx: CanvasRenderingContext2D) {
    const L = this.game.level;
    for (const d of L.doors) {
      const cx = d.x + 0.5, cy = d.y + 0.5;
      const lockCol = d.lock === 2 ? "#c9372c" : d.lock === 1 ? "#3f7dd6" : null;
      if (d.open) {
        ctx.fillStyle = "#1b1d20"; ctx.fillRect(d.x, d.y, 1, 1);
        ctx.strokeStyle = "#5d646c"; ctx.lineWidth = 0.1;
        ctx.beginPath();
        if (d.vertical) { ctx.moveTo(d.x + 0.5, d.y + 0.05); ctx.lineTo(d.x + 1.2, d.y - 0.5); } else { ctx.moveTo(d.x + 0.05, d.y + 0.5); ctx.lineTo(d.x - 0.5, d.y + 1.2); }
        ctx.stroke();
      } else {
        ctx.fillStyle = d.exterior === "dock" ? "#3d4146" : "#4a5057";
        if (d.vertical) ctx.fillRect(d.x + 0.3, d.y, 0.4, 1); else ctx.fillRect(d.x, d.y + 0.3, 1, 0.4);
        ctx.fillStyle = "#2b2f33";
        if (d.vertical) ctx.fillRect(d.x + 0.46, d.y + 0.05, 0.08, 0.9); else ctx.fillRect(d.x + 0.05, d.y + 0.46, 0.9, 0.08);
      }
      if (lockCol) { ctx.fillStyle = lockCol; ctx.fillRect(cx - 0.09, cy - 0.09, 0.18, 0.18); }
    }
  }

  private drawInteractables(ctx: CanvasRenderingContext2D) {
    const g = this.game, p = g.player, t = g.t;
    for (const it of g.level.interactables) {
      if (it.done && it.kind !== "locker" && it.kind !== "alarmPanel" && it.kind !== "secTerminal" && it.kind !== "chargeSite") continue;
      const cx = it.x + 0.5, cy = it.y + 0.5;
      const near = dist(p.x, p.y, cx, cy) < 2.4;
      switch (it.kind) {
        case "loot": {
          const d = LOOT[it.item!]; const rare = d?.rare;
          ctx.fillStyle = rare ? "#d8b35a" : it.item === "ammo" ? "#8a8f6a" : it.item === "medkit" ? "#b8423a" : it.item === "cash" || it.item === "gold" ? "#8fa37a" : it.item === "docs" ? "#d9d6cc" : "#9aa3ad";
          ctx.fillRect(cx - 0.17, cy - 0.12, 0.34, 0.24);
          if (near || rare) { ctx.strokeStyle = `rgba(240,200,120,${0.45 + 0.3 * Math.sin(t * 4)})`; ctx.lineWidth = 0.04; ctx.strokeRect(cx - 0.26, cy - 0.21, 0.52, 0.42); }
          break;
        }
        case "keycard": ctx.fillStyle = "#3f7dd6"; ctx.fillRect(cx - 0.15, cy - 0.1, 0.3, 0.2); if (near) { ctx.strokeStyle = "rgba(120,170,255,0.8)"; ctx.lineWidth = 0.04; ctx.strokeRect(cx - 0.24, cy - 0.19, 0.48, 0.38); } break;
        case "objective": case "evidence": case "chargeSite": case "hostage": {
          if (it.kind === "chargeSite" && it.done) {
            const on = Math.sin(t * (g.charge && g.charge.t < 10 ? 20 : 8)) > 0;
            ctx.fillStyle = on ? "#ff3322" : "#551111"; ctx.beginPath(); ctx.arc(cx, cy, 0.12, 0, 7); ctx.fill(); break;
          }
          if (it.kind === "hostage") break;
          const a = 0.5 + 0.4 * Math.sin(t * 3);
          ctx.strokeStyle = `rgba(255,236,200,${a})`; ctx.lineWidth = 0.05;
          ctx.beginPath(); ctx.arc(cx, cy, 0.34 + 0.05 * Math.sin(t * 3), 0, 7); ctx.stroke();
          ctx.fillStyle = "#e8e0cc"; ctx.fillRect(cx - 0.12, cy - 0.12, 0.24, 0.24);
          break;
        }
        case "safe": if (near) { ctx.strokeStyle = "rgba(240,200,120,0.6)"; ctx.lineWidth = 0.04; ctx.strokeRect(it.x + 0.1, it.y + 0.1, 0.8, 0.8); } break;
        case "secTerminal": if (!it.done) { ctx.fillStyle = `rgba(120,200,255,${0.3 + 0.2 * Math.sin(t * 2)})`; ctx.fillRect(cx - 0.2, cy - 0.35, 0.4, 0.2); } break;
        case "alarmPanel": ctx.fillStyle = it.done ? "#3a2a28" : "#9e2a22"; ctx.fillRect(cx - 0.16, cy - 0.16, 0.32, 0.32);
          if (!it.done && Math.sin(t * 2) > 0.7) { ctx.fillStyle = "#ff5544"; ctx.fillRect(cx - 0.05, cy - 0.05, 0.1, 0.1); } break;
        case "locker": if (near && p.hidden < 0) { ctx.strokeStyle = "rgba(200,210,220,0.45)"; ctx.lineWidth = 0.04; ctx.strokeRect(it.x + 0.08, it.y + 0.08, 0.84, 0.84); } break;
      }
    }
    // server rack LEDs
    for (const pr of g.level.props) if (pr.kind === "rack" && Math.abs(pr.x - p.x) < 16 && Math.abs(pr.y - p.y) < 12) {
      for (let i = 0; i < pr.h * 3; i++) {
        const on = Math.sin(t * (2 + (i % 5)) + pr.x * 3 + i) > 0.2;
        ctx.fillStyle = on ? (i % 7 === 0 ? "#ff6040" : "#60d0a0") : "#153028";
        ctx.fillRect(pr.x + 0.25 + (i % 2) * 0.35, pr.y + 0.25 + (i / 3) * 0.95, 0.07, 0.05);
      }
    }
  }

  private drawCameras(ctx: CanvasRenderingContext2D) {
    const g = this.game, p = g.player;
    for (const c of g.level.cameras) {
      const visible = dist(c.x, c.y, p.x, p.y) < 18;
      if (!visible) continue;
      if (c.state === "active" && los(g.level, p.x, p.y, c.x, c.y)) {
        const pts = visibilityPolygon(g.level, c.x, c.y, c.range, 14, c.angle - c.fov / 2, c.fov);
        const warn = c.suspicion;
        ctx.fillStyle = warn > 0.05 ? `rgba(255,${Math.round(150 - warn * 120)},60,${0.1 + warn * 0.18})` : "rgba(230,230,210,0.06)";
        ctx.beginPath(); ctx.moveTo(c.x, c.y); for (const q of pts) ctx.lineTo(q.x, q.y); ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
      ctx.fillStyle = c.hardened ? "#4b5a55" : "#3a3e43"; ctx.fillRect(-0.18, -0.11, 0.36, 0.22);
      ctx.fillStyle = "#15171a"; ctx.fillRect(0.12, -0.07, 0.1, 0.14);
      ctx.restore();
      const led = c.state === "active" ? (Math.sin(g.t * 4 + c.id) > 0 ? "#ff3b2f" : "#5a1512") : c.state === "emp" ? (Math.random() > 0.5 ? "#7fb8ff" : "#223") : c.state === "looped" ? "#3a6a4a" : "#222";
      ctx.fillStyle = led; ctx.fillRect(c.x - 0.04, c.y - 0.04, 0.08, 0.08);
      if (c.state === "destroyed" && Math.random() < 0.03) g.particles.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, life: 0.3, max: 0.3, kind: "spark", size: 0.03 });
    }
  }

  private drawGuard(ctx: CanvasRenderingContext2D, gd: Guard) {
    const g = this.game;
    if (gd.down) {
      ctx.save(); ctx.translate(gd.x, gd.y); ctx.rotate(gd.angle + 1.3);
      ctx.fillStyle = gd.down === "dead" ? "#30353b" : "#3a4550"; ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.24, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#1c1f22"; ctx.beginPath(); ctx.arc(0.34, 0, 0.13, 0, 7); ctx.fill();
      ctx.restore();
      if (gd.down === "ko") { ctx.fillStyle = "rgba(200,210,230,0.5)"; ctx.font = "600 0.3px sans-serif"; ctx.textAlign = "center"; ctx.fillText("z", gd.x + 0.3, gd.y - 0.35 + Math.sin(g.t * 2) * 0.05); }
      return;
    }
    const body = gd.kind === "contractor" ? "#2f3328" : gd.kind === "chief" ? "#20262e" : "#44505d";
    ctx.save(); ctx.translate(gd.x, gd.y); ctx.rotate(gd.angle);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(0.06, 0.08, 0.36, 0, 7); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 0.3, 0.36, 0, 0, 7); ctx.fill();
    ctx.fillStyle = gd.kind === "contractor" ? "#b8742a" : gd.kind === "chief" ? "#c9c3b0" : "#66737f"; ctx.fillRect(-0.12, -0.34, 0.1, 0.68);
    ctx.fillStyle = "#1a1c1f"; ctx.beginPath(); ctx.arc(0.02, 0, 0.17, 0, 7); ctx.fill();
    ctx.fillStyle = "#111"; ctx.fillRect(0.16, 0.08, 0.36, 0.08);
    if (g.flashlightOn(gd)) { ctx.fillStyle = "#fff5d0"; ctx.fillRect(0.5, 0.08, 0.05, 0.08); }
    ctx.restore();
    // awareness indicator
    const col = gd.state === "COMBAT" || gd.state === "RAISING" ? "#ff4a3a" : gd.state === "SEARCHING" ? "#ff9a3a" : gd.suspicion > 0.05 || gd.state === "SUSPICIOUS" || gd.state === "INVESTIGATING" ? "#f0c060" : null;
    if (col) {
      ctx.strokeStyle = col; ctx.lineWidth = 0.07;
      const frac = gd.state === "COMBAT" || gd.state === "SEARCHING" || gd.state === "RAISING" ? 1 : gd.suspicion;
      ctx.beginPath(); ctx.arc(gd.x, gd.y, 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.05, frac)); ctx.stroke();
      ctx.fillStyle = col; ctx.font = "700 0.42px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(gd.state === "COMBAT" || gd.state === "RAISING" ? "!" : gd.state === "SEARCHING" ? "?!" : "?", gd.x, gd.y - 0.62);
    }
    if (gd.name && dist(gd.x, gd.y, g.player.x, g.player.y) < 6) {
      ctx.fillStyle = "rgba(220,215,200,0.7)"; ctx.font = "500 0.26px sans-serif"; ctx.textAlign = "center"; ctx.fillText(gd.name.toUpperCase(), gd.x, gd.y + 0.78);
    }
  }

  private drawHostage(ctx: CanvasRenderingContext2D) {
    const h = this.game.hostage!;
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(h.x + 0.05, h.y + 0.07, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = "#c8c2b2"; ctx.beginPath(); ctx.arc(h.x, h.y, 0.27, 0, 7); ctx.fill();
    ctx.fillStyle = "#6b5a48"; ctx.beginPath(); ctx.arc(h.x, h.y, 0.14, 0, 7); ctx.fill();
    if (h.state === "waiting") { ctx.strokeStyle = "rgba(240,200,120,0.6)"; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.arc(h.x, h.y, 0.42, 0, 7); ctx.stroke(); }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const g = this.game, p = g.player;
    if (p.hidden >= 0 || g.spectator) return;
    const sc = p.crouch ? 0.85 : 1;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.scale(sc, sc);
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(0.06, 0.08, 0.34, 0, 7); ctx.fill();
    ctx.fillStyle = "#1d2023"; ctx.beginPath(); ctx.ellipse(0, 0, 0.28, 0.34, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#cfc8b6"; ctx.lineWidth = 0.035; ctx.stroke();
    ctx.fillStyle = "#2c3034"; ctx.beginPath(); ctx.arc(0.02, 0, 0.16, 0, 7); ctx.fill();
    ctx.fillStyle = "#9fa7a0"; ctx.fillRect(0.1, -0.02, 0.04, 0.04);
    const len = p.weapon === "shotgun" ? 0.55 : p.weapon === "smg" ? 0.48 : 0.5;
    ctx.fillStyle = "#0d0e10"; ctx.fillRect(0.14, 0.07, len, 0.08);
    ctx.restore();
    // aim line (subtle)
    const a = p.angle, d = castRay(g.level, p.x, p.y, a, 9);
    const grad = ctx.createLinearGradient(p.x, p.y, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    grad.addColorStop(0, "rgba(220,215,200,0.14)"); grad.addColorStop(1, "rgba(220,215,200,0)");
    ctx.strokeStyle = grad; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * 0.6, p.y + Math.sin(a) * 0.6); ctx.lineTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); ctx.stroke();
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D) {
    const g = this.game;
    for (const pr of g.projectiles) {
      let x = pr.x, y = pr.y, lift = 0;
      if (!pr.landed) { const k = pr.t / pr.dur; x = pr.x + (pr.tx - pr.x) * k; y = pr.y + (pr.ty - pr.y) * k; lift = Math.sin(k * Math.PI) * 0.5; }
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(x, y + 0.05, 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = pr.kind === "emp" ? "#7fb8ff" : "#d9a64a";
      ctx.beginPath(); ctx.arc(x, y - lift, 0.1, 0, 7); ctx.fill();
      if (pr.landed && pr.kind === "noisemaker" && Math.sin(g.t * 10) > 0) { ctx.fillStyle = "#ffcc66"; ctx.beginPath(); ctx.arc(x, y, 0.05, 0, 7); ctx.fill(); }
    }
  }

  private drawTracers(ctx: CanvasRenderingContext2D) {
    for (const t of this.game.tracers) {
      const a = 1 - (this.game.t - t.t) / 0.12;
      ctx.strokeStyle = t.enemy ? `rgba(255,170,120,${0.7 * a})` : `rgba(255,240,200,${0.6 * a})`;
      ctx.lineWidth = 0.035; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, additive: boolean) {
    for (const pt of this.game.particles) {
      if (pt.kind === "blood") continue;
      const a = pt.life / pt.max;
      if (additive !== (pt.kind === "spark")) continue;
      if (pt.kind === "spark") { ctx.fillStyle = `rgba(255,200,120,${a})`; ctx.fillRect(pt.x, pt.y, pt.size, pt.size); }
      else if (pt.kind === "smoke" || pt.kind === "dust") { ctx.fillStyle = `rgba(150,150,145,${0.25 * a})`; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * (2 - a), 0, 7); ctx.fill(); }
      else if (pt.kind === "casing") { ctx.fillStyle = `rgba(200,170,90,${a})`; ctx.fillRect(pt.x, pt.y, 0.06, 0.03); }
    }
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ------------------------------------------------------------------------------------------------ tactical map
export function drawMap(ctx: CanvasRenderingContext2D, L: Level, explored: Uint8Array, W: number, H: number, opts: {
  player?: { x: number; y: number; angle: number }; objective?: { x: number; y: number } | null; routes?: { x: number; y: number }[][];
  entrances?: boolean; t?: number; all?: boolean; hostile?: { x: number; y: number }[];
}) {
  const s = Math.min(W / L.w, H / L.h);
  const ox = (W - L.w * s) / 2, oy = (H - L.h * s) / 2;
  ctx.clearRect(0, 0, W, H);
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const i = y * L.w + x; const known = opts.all || explored[i];
    if (!known) continue;
    const t = L.tiles[i];
    ctx.fillStyle = t === T.WALL ? "#9aa3ab" : t === T.DOOR ? (L.doors[L.doorAt[i]].lock === 2 ? "#c9372c" : L.doors[L.doorAt[i]].lock === 1 ? "#3f7dd6" : "#5a6068")
      : t === T.EXT ? "rgba(90,100,110,0.18)" : t === T.PROP_TALL ? "rgba(140,150,160,0.35)" : t === T.PROP_LOW ? "rgba(140,150,160,0.22)" : "rgba(160,170,180,0.12)";
    ctx.fillRect(ox + x * s, oy + y * s, s + 0.4, s + 0.4);
  }
  ctx.font = `600 ${Math.max(9, s * 0.9)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = "rgba(220,225,230,0.6)";
  for (const r of L.rooms) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (opts.all || explored[Math.floor(cy) * L.w + Math.floor(cx)] || explored[r.y * L.w + r.x + 1]) ctx.fillText(r.name.toUpperCase(), ox + cx * s, oy + cy * s + 4);
  }
  if (opts.routes) {
    ctx.strokeStyle = "rgba(255,160,80,0.45)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    for (const r of opts.routes) { if (r.length < 2) continue; ctx.beginPath(); r.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s))); ctx.closePath(); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  if (opts.entrances) for (const e of L.entrances) {
    const d = L.doors[e.door];
    ctx.fillStyle = "#e8d9b0"; ctx.beginPath(); ctx.arc(ox + (d.x + 0.5) * s, oy + (d.y + 0.5) * s, s * 0.9, 0, 7); ctx.fill();
    ctx.fillStyle = "#e8d9b0"; ctx.font = `600 ${Math.max(10, s)}px 'Barlow Condensed', sans-serif`;
    ctx.fillText(e.name.toUpperCase(), ox + (d.x + 0.5) * s, oy + (d.y + 0.5) * s + (d.y < L.h / 2 ? -s * 1.6 : s * 2.4));
  }
  const ex = L.extraction;
  ctx.strokeStyle = "#f0c878"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + ex.x * s, oy + ex.y * s, s * 1.4, 0, 7); ctx.stroke();
  ctx.fillStyle = "#f0c878"; ctx.font = `600 ${Math.max(10, s)}px 'Barlow Condensed', sans-serif`; ctx.fillText("EXFIL", ox + ex.x * s, oy + ex.y * s + (ex.y < L.h / 2 ? s * 2.9 : -s * 2));
  if (opts.objective) {
    const pulse = 0.6 + 0.4 * Math.sin((opts.t ?? 0) * 4);
    ctx.strokeStyle = `rgba(255,240,210,${pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox + opts.objective.x * s, oy + opts.objective.y * s, s * 1.2, 0, 7); ctx.stroke();
  }
  for (const h of opts.hostile ?? []) { ctx.fillStyle = "#ff6a4a"; ctx.beginPath(); ctx.arc(ox + h.x * s, oy + h.y * s, s * 0.5, 0, 7); ctx.fill(); }
  if (opts.player) {
    const p = opts.player;
    ctx.save(); ctx.translate(ox + p.x * s, oy + p.y * s); ctx.rotate(p.angle);
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(s * 1.1, 0); ctx.lineTo(-s * 0.7, s * 0.6); ctx.lineTo(-s * 0.7, -s * 0.6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  void ZERO_HOUR;
}
