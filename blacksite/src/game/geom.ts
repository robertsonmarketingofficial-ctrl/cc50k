// Line of sight, visibility polygons and A* pathfinding on the tile grid.
import type { Level, Vec } from "./types";
import { T } from "./types";
import { blocksSight } from "./facility";

/** Walks the grid from a to b (Amanatides-Woo DDA). Returns true if nothing blocks the view. */
export function los(level: Level, ax: number, ay: number, bx: number, by: number): boolean {
  let x = Math.floor(ax), y = Math.floor(ay);
  const tx = Math.floor(bx), ty = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ax : ax - x) * tDX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - ay : ay - y) * tDY : Infinity;
  for (let n = 0; n < 200; n++) {
    if (x === tx && y === ty) return true;
    if (tMaxX < tMaxY) { tMaxX += tDX; x += stepX; } else { tMaxY += tDY; y += stepY; }
    if (x === tx && y === ty) return true;
    if (blocksSight(level, x, y)) return false;
  }
  return false;
}

/** Distance a ray travels before hitting something that blocks sight (max `max`). */
export function castRay(level: Level, ax: number, ay: number, ang: number, max: number): number {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let x = Math.floor(ax), y = Math.floor(ay);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ax : ax - x) * tDX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - ay : ay - y) * tDY : Infinity;
  let t = 0;
  while (t < max) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDX; x += stepX; } else { t = tMaxY; tMaxY += tDY; y += stepY; }
    if (blocksSight(level, x, y)) return Math.min(t, max);
  }
  return max;
}

export function visibilityPolygon(level: Level, x: number, y: number, max: number, rays = 240, a0 = 0, span = Math.PI * 2): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= rays; i++) {
    const a = a0 + (span * i) / rays;
    const d = castRay(level, x, y, a, max);
    pts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d });
  }
  return pts;
}

// ------------------------------------------------------------------------------ A*
export function walkable(level: Level, x: number, y: number, clearance: number): boolean {
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false;
  const t = level.tiles[y * level.w + x];
  if (t === T.FLOOR || t === T.EXT) return true;
  if (t === T.DOOR) { const d = level.doors[level.doorAt[y * level.w + x]]; return d.open || d.lock <= clearance; }
  return false;
}

class Heap {
  private a: number[] = []; private f: Float64Array;
  constructor(size: number) { this.f = new Float64Array(size); }
  get size() { return this.a.length; }
  push(n: number, f: number) {
    this.f[n] = f; const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.f[a[p]] <= this.f[a[i]]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): number {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** A* over tiles, 8-directional without cutting corners. Returns tile-centre waypoints (excluding start). */
export function findPath(level: Level, sx: number, sy: number, gx: number, gy: number, clearance = 1, maxNodes = 6000): Vec[] | null {
  const w = level.w, h = level.h, N = w * h;
  sx = Math.floor(sx); sy = Math.floor(sy); gx = Math.floor(gx); gy = Math.floor(gy);
  if (!walkable(level, gx, gy, clearance)) {
    // aim for the nearest walkable tile to the goal
    let best: Vec | null = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (walkable(level, gx + dx, gy + dy, clearance) && Math.abs(dx) + Math.abs(dy) < bd) { bd = Math.abs(dx) + Math.abs(dy); best = { x: gx + dx, y: gy + dy }; }
    }
    if (!best) return null; gx = best.x; gy = best.y;
  }
  const start = sy * w + sx, goal = gy * w + gx;
  if (start === goal) return [];
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = new Heap(N);
  const hfn = (i: number) => { const x = i % w, y = (i / w) | 0; const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  g[start] = 0; open.push(start, hfn(start));
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(level, nx, ny, clearance)) continue;
      if (dx && dy && (!walkable(level, cx + dx, cy, clearance) || !walkable(level, cx, cy + dy, clearance))) continue;
      const n = ny * w + nx;
      const cost = g[cur] + (dx && dy ? 1.414 : 1) + (level.tiles[n] === T.DOOR ? 0.6 : 0);
      if (cost < g[n]) { g[n] = cost; came[n] = cur; open.push(n, cost + hfn(n)); }
    }
  }
  if (came[goal] < 0) return null;
  const out: Vec[] = [];
  for (let c = goal; c !== start; c = came[c]) out.push({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5 });
  out.reverse();
  return smooth(level, { x: sx + 0.5, y: sy + 0.5 }, out, clearance);
}

// drop waypoints that can be skipped in a straight, clear line (keeps door tiles so agents open them)
function smooth(level: Level, s: Vec, pts: Vec[], clearance: number): Vec[] {
  if (pts.length < 3) return pts;
  const out: Vec[] = [];
  let anchor = s;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    const isDoor = level.tiles[Math.floor(pts[i].y) * level.w + Math.floor(pts[i].x)] === T.DOOR;
    if (!next || isDoor || !clearLine(level, anchor, next, clearance)) { out.push(pts[i]); anchor = pts[i]; }
  }
  return out;
}
function clearLine(level: Level, a: Vec, b: Vec, clearance: number): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
    for (const [ox, oy] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
      const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
      if (!walkable(level, tx, ty, clearance) || level.tiles[ty * level.w + tx] === T.DOOR) return false;
    }
  }
  return true;
}
