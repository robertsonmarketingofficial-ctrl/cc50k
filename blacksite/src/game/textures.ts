// Procedural PBR texture sets (albedo + normal + roughness) drawn on canvases.
// Every surface is generated from a height field so light rakes across it believably.
import * as THREE from "three";

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap?: THREE.Texture }
type Painter = (c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, s: number, r: () => number) => void;

const cache = new Map<string, TexSet>();

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvas(s: number) { const c = document.createElement("canvas"); c.width = c.height = s; return c; }

/** value noise with octaves, drawn into an ImageData-sized float array */
function fbm(s: number, scale: number, oct: number, r: () => number): Float32Array {
  const out = new Float32Array(s * s);
  let amp = 1, total = 0;
  for (let o = 0; o < oct; o++) {
    const g = Math.max(2, Math.round(s / scale) << o);
    const grid = new Float32Array((g + 1) * (g + 1)); for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let i = 0; i <= g; i++) { grid[i * (g + 1) + g] = grid[i * (g + 1)]; grid[g * (g + 1) + i] = grid[i]; } // tileable
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const fx = (x / s) * g, fy = (y / s) * g, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[iy * (g + 1) + ix], b = grid[iy * (g + 1) + ix + 1], c = grid[(iy + 1) * (g + 1) + ix], d = grid[(iy + 1) * (g + 1) + ix + 1];
      out[y * s + x] += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * amp;
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTex(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** normal map from a greyscale height canvas (tileable Sobel) */
function normalFrom(h: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const s = h.width, src = h.getContext("2d")!.getImageData(0, 0, s, s).data;
  const out = canvas(s), ctx = out.getContext("2d")!, img = ctx.createImageData(s, s);
  const H = (x: number, y: number) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * s + x) * 4; img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function texSet(key: string, size: number, strength: number, paint: Painter, rough?: (h: CanvasRenderingContext2D, s: number) => void): TexSet {
  const hit = cache.get(key); if (hit) return hit;
  const c = canvas(size), h = canvas(size);
  const cx = c.getContext("2d")!, hx = h.getContext("2d")!;
  hx.fillStyle = "#808080"; hx.fillRect(0, 0, size, size);
  paint(cx, hx, size, rng(key.length * 7919 + size));
  const set: TexSet = { map: toTex(c, true), normalMap: toTex(normalFrom(h, strength), false) };
  if (rough) { const rc = canvas(size); rough(rc.getContext("2d")!, size); set.roughnessMap = toTex(rc, false); }
  cache.set(key, set);
  return set;
}

// ------------------------------------------------------------------------------------------ helpers
function noiseLayer(ctx: CanvasRenderingContext2D, s: number, n: Float32Array, color: (v: number) => [number, number, number, number]) {
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < s * s; i++) {
    const [r, g, b, a] = color(n[i]);
    const k = i * 4, af = a / 255;
    img.data[k] = img.data[k] * (1 - af) + r * af; img.data[k + 1] = img.data[k + 1] * (1 - af) + g * af; img.data[k + 2] = img.data[k + 2] * (1 - af) + b * af;
  }
  ctx.putImageData(img, 0, 0);
}
function heightNoise(hx: CanvasRenderingContext2D, s: number, n: Float32Array, amp: number) {
  const img = hx.getImageData(0, 0, s, s);
  for (let i = 0; i < s * s; i++) { const v = Math.max(0, Math.min(255, img.data[i * 4] + (n[i] - 0.5) * amp)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; }
  hx.putImageData(img, 0, 0);
}
const hex = (c: string): [number, number, number] => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------------------------------ surfaces
/** sun-baked lime plaster over mudbrick: warm sandstone, patchy, fine grain */
export function plaster(tint = "#d6a574", key = "plaster"): TexSet {
  return texSet(key + tint, 512, 1.1, (c, h, s, r) => {
    const base = hex(tint);
    c.fillStyle = tint; c.fillRect(0, 0, s, s);
    const big = fbm(s, 170, 4, r), mid = fbm(s, 24, 3, r), fine = fbm(s, 3, 2, r);
    // gentle patchiness from uneven lime wash, not blotches
    noiseLayer(c, s, big, v => [...mix(mix(base, [250, 232, 200], 0.18), mix(base, [150, 105, 70], 0.3), v), 70] as [number, number, number, number]);
    noiseLayer(c, s, mid, v => [...mix(base, v > 0.5 ? [245, 225, 195] : [165, 125, 90], Math.abs(v - 0.5) * 0.8), 45] as [number, number, number, number]);
    noiseLayer(c, s, fine, v => [...mix(base, v > 0.5 ? [255, 240, 215] : [120, 90, 65], 0.5), 38] as [number, number, number, number]);
    if (key !== "int" && key !== "ceil") for (let k = 0; k < 26; k++) { const x = r() * s, w = 3 + r() * 14; const g = c.createLinearGradient(0, 0, 0, s); g.addColorStop(0, "rgba(90,60,35,0)"); g.addColorStop(0.2 + r() * 0.6, "rgba(90,60,35,0.08)"); g.addColorStop(1, "rgba(90,60,35,0)"); c.fillStyle = g; c.fillRect(x, 0, w, s); }
    // trowel marks: long soft arcs in the height field
    for (let k = 0; k < 70; k++) { const x = r() * s, y = r() * s, len = 30 + r() * 90, a = r() * Math.PI; h.strokeStyle = `rgba(${r() > 0.5 ? 170 : 95},${r() > 0.5 ? 170 : 95},${r() > 0.5 ? 170 : 95},0.18)`; h.lineWidth = 6 + r() * 14; h.beginPath(); h.moveTo(x, y); h.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 30, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 30, x + Math.cos(a) * len, y + Math.sin(a) * len); h.stroke(); }
    heightNoise(h, s, fine, 34); heightNoise(h, s, mid, 26);
    for (let k = 0; k < 4; k++) { h.fillStyle = "rgba(90,90,90,0.4)"; const x = r() * s, y = r() * s, a = 3 + r() * 8, bb = 2 + r() * 4, rot = r() * 3; h.beginPath(); h.ellipse(x, y, a, bb, rot, 0, 7); h.fill(); c.fillStyle = "rgba(185,145,110,0.3)"; c.beginPath(); c.ellipse(x, y, a, bb, rot, 0, 7); c.fill(); }
  }, x => { x.fillStyle = "#e0e0e0"; x.fillRect(0, 0, 512, 512); });
}

/** coursed sandstone blocks for plinths and towers */
export function stoneBlocks(tint = "#c79a6a"): TexSet {
  return texSet("blocks" + tint, 512, 3.5, (c, h, s, r) => {
    c.fillStyle = "#8a6a4a"; c.fillRect(0, 0, s, s); h.fillStyle = "#303030"; h.fillRect(0, 0, s, s);
    const rows = 8, bh = s / rows;
    const base = hex(tint);
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -bh * 0.9 : 0;
      while (x < s) {
        const bw = bh * (1.4 + r() * 1.2);
        const col = mix(base, r() > 0.5 ? [240, 210, 170] : [150, 110, 75], r() * 0.45);
        c.fillStyle = `rgb(${col.map(Math.round).join(",")})`; c.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4);
        const g = h.createLinearGradient(0, row * bh, 0, row * bh + bh); g.addColorStop(0, "#d8d8d8"); g.addColorStop(0.5, "#c8c8c8"); g.addColorStop(1, "#b0b0b0");
        h.fillStyle = g; h.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
        x += bw;
      }
    }
    const n = fbm(s, 4, 3, r); heightNoise(h, s, n, 70);
    noiseLayer(c, s, fbm(s, 90, 3, r), v => [80, 55, 35, v * 90]);
  }, x => { x.fillStyle = "#d8d8d8"; x.fillRect(0, 0, 512, 512); });
}

/** zellige: hand-cut glazed tile mosaic in an eight-point star pattern */
export function zellige(palette = ["#1f5f7a", "#2f7d5e", "#e9e2cf", "#b9542e", "#1c2e4a"]): TexSet {
  return texSet("zellige" + palette.join(""), 512, 2.4, (c, h, s, r) => {
    const cell = s / 4;
    c.fillStyle = "#d9d1bd"; c.fillRect(0, 0, s, s); h.fillStyle = "#606060"; h.fillRect(0, 0, s, s);
    const star = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) => {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + Math.PI / 16; const rr = i % 2 ? R * 0.62 : R; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      ctx.closePath();
    };
    for (let gy = 0; gy <= 4; gy++) for (let gx = 0; gx <= 4; gx++) {
      const cx = gx * cell, cy = gy * cell;
      // each glazed piece is slightly different: hand-made glaze
      const pick = (i: number) => { const b = hex(palette[i]); return `rgb(${mix(b, [255, 255, 255], r() * 0.18).map(Math.round).join(",")})`; };
      c.fillStyle = pick(0); star(c, cx, cy, cell * 0.46); c.fill();
      c.fillStyle = pick(2); star(c, cx, cy, cell * 0.3); c.fill();
      c.fillStyle = pick(3); c.beginPath(); c.arc(cx, cy, cell * 0.1, 0, 7); c.fill();
      c.fillStyle = pick(1); star(c, cx + cell / 2, cy + cell / 2, cell * 0.24); c.fill();
      c.fillStyle = pick(4); c.save(); c.translate(cx + cell / 2, cy); c.rotate(Math.PI / 4); c.fillRect(-cell * 0.08, -cell * 0.08, cell * 0.16, cell * 0.16); c.restore();
      c.fillStyle = pick(4); c.save(); c.translate(cx, cy + cell / 2); c.rotate(Math.PI / 4); c.fillRect(-cell * 0.08, -cell * 0.08, cell * 0.16, cell * 0.16); c.restore();
      // grout lines in the height map
      h.strokeStyle = "#202020"; h.lineWidth = 3;
      star(h, cx, cy, cell * 0.46); h.stroke(); star(h, cx, cy, cell * 0.3); h.stroke(); star(h, cx + cell / 2, cy + cell / 2, cell * 0.24); h.stroke();
      h.fillStyle = "#909090"; star(h, cx, cy, cell * 0.44); h.fill();
    }
    c.strokeStyle = "rgba(180,170,150,0.9)"; c.lineWidth = 2;
    for (let gy = 0; gy <= 4; gy++) for (let gx = 0; gx <= 4; gx++) { star(c, gx * cell, gy * cell, cell * 0.46); c.stroke(); }
    heightNoise(h, s, fbm(s, 3, 2, r), 18);
  }, x => { x.fillStyle = "#505050"; x.fillRect(0, 0, 512, 512); });
}

/** terracotta floor tiles with lime grout */
export function terracotta(tint = "#b8643e"): TexSet {
  return texSet("terracotta" + tint, 512, 2.5, (c, h, s, r) => {
    const n = 4, t = s / n, base = hex(tint);
    c.fillStyle = "#cdbca0"; c.fillRect(0, 0, s, s); h.fillStyle = "#383838"; h.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = mix(base, r() > 0.5 ? [220, 140, 90] : [120, 60, 40], r() * 0.35);
      c.fillStyle = `rgb(${col.map(Math.round).join(",")})`; c.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
      h.fillStyle = "#b8b8b8"; h.fillRect(x * t + 4, y * t + 4, t - 8, t - 8);
    }
    noiseLayer(c, s, fbm(s, 30, 3, r), v => [60, 30, 15, v * 70]);
    noiseLayer(c, s, fbm(s, 3, 2, r), v => [255, 230, 200, (v - 0.4) * 60]);
    heightNoise(h, s, fbm(s, 5, 3, r), 40);
  }, x => { x.fillStyle = "#c8c8c8"; x.fillRect(0, 0, 512, 512); });
}

/** wind-rippled sand with pebbles and tyre-packed patches */
export function sand(tint = "#d2ab78"): TexSet {
  return texSet("sand" + tint, 512, 2.0, (c, h, s, r) => {
    const base = hex(tint);
    c.fillStyle = tint; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 140, 4, r), v => [...mix(mix(base, [240, 215, 175], 0.4), mix(base, [150, 110, 70], 0.5), v), 150] as [number, number, number, number]);
    const fine = fbm(s, 2, 2, r); noiseLayer(c, s, fine, v => [...mix(base, v > 0.5 ? [255, 240, 210] : [120, 90, 60], 0.6), 70] as [number, number, number, number]);
    // ripples
    for (let y = 0; y < s; y += 6) { h.strokeStyle = `rgba(${r() > 0.5 ? 200 : 90},${r() > 0.5 ? 200 : 90},${r() > 0.5 ? 200 : 90},0.25)`; h.lineWidth = 2; h.beginPath(); for (let x = 0; x <= s; x += 16) h.lineTo(x, y + Math.sin(x * 0.03 + y) * 3); h.stroke(); }
    for (let k = 0; k < 220; k++) { const x = r() * s, y = r() * s, rr = 1 + r() * 3; c.fillStyle = r() > 0.5 ? "#8a7560" : "#e8d8c0"; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); h.fillStyle = "#e0e0e0"; h.beginPath(); h.arc(x, y, rr, 0, 7); h.fill(); }
    heightNoise(h, s, fine, 60);
  }, x => { x.fillStyle = "#f0f0f0"; x.fillRect(0, 0, 512, 512); });
}

/** sun-faded asphalt */
export function asphalt(): TexSet {
  return texSet("asphalt", 512, 1.6, (c, h, s, r) => {
    c.fillStyle = "#4a4845"; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 2, 2, r), v => [v * 130, v * 125, v * 118, 140]);
    noiseLayer(c, s, fbm(s, 120, 3, r), v => [170, 150, 120, v * 70]);
    heightNoise(h, s, fbm(s, 2, 2, r), 80);
    for (let k = 0; k < 6; k++) { c.strokeStyle = "rgba(20,20,20,0.5)"; c.lineWidth = 1.5; c.beginPath(); let x = r() * s, y = r() * s; c.moveTo(x, y); for (let i = 0; i < 8; i++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; c.lineTo(x, y); } c.stroke(); }
  }, x => { x.fillStyle = "#f4f4f4"; x.fillRect(0, 0, 512, 512); });
}

/** paved concrete slabs */
export function paving(tint = "#bfae95"): TexSet {
  return texSet("paving" + tint, 512, 2.2, (c, h, s, r) => {
    const n = 2, t = s / n, base = hex(tint);
    c.fillStyle = "#8a7d6a"; c.fillRect(0, 0, s, s); h.fillStyle = "#404040"; h.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const col = mix(base, r() > 0.5 ? [230, 215, 190] : [140, 125, 100], r() * 0.3);
      c.fillStyle = `rgb(${col.map(Math.round).join(",")})`; c.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
      h.fillStyle = "#c0c0c0"; h.fillRect(x * t + 4, y * t + 4, t - 8, t - 8);
    }
    noiseLayer(c, s, fbm(s, 3, 3, r), v => [v * 200, v * 190, v * 170, 60]);
    noiseLayer(c, s, fbm(s, 80, 3, r), v => [90, 70, 50, v * 60]);
    heightNoise(h, s, fbm(s, 4, 3, r), 50);
  }, x => { x.fillStyle = "#e4e4e4"; x.fillRect(0, 0, 512, 512); });
}

/** carved cedar: plank door with studs and a lattice panel */
export function cedar(): TexSet {
  return texSet("cedar", 512, 3.0, (c, h, s, r) => {
    c.fillStyle = "#6b4527"; c.fillRect(0, 0, s, s);
    const grain = fbm(s, 3, 2, r);
    const img = c.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = y * s + x; const g = Math.sin(x * 0.12 + grain[i] * 9) * 0.5 + 0.5; const k = i * 4; img.data[k] = 90 + g * 50; img.data[k + 1] = 55 + g * 32; img.data[k + 2] = 30 + g * 18; }
    c.putImageData(img, 0, 0);
    h.fillStyle = "#909090"; h.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += s / 6) { h.fillStyle = "#303030"; h.fillRect(x, 0, 3, s); c.fillStyle = "rgba(30,15,5,0.7)"; c.fillRect(x, 0, 3, s); }
    for (let y = 40; y < s; y += 110) for (let x = 20; x < s; x += s / 6) { c.fillStyle = "#3a3530"; c.beginPath(); c.arc(x + 18, y, 7, 0, 7); c.fill(); h.fillStyle = "#f0f0f0"; h.beginPath(); h.arc(x + 18, y, 7, 0, 7); h.fill(); }
  }, x => { x.fillStyle = "#b0b0b0"; x.fillRect(0, 0, 512, 512); });
}

/** painted steel for gates, barriers and frames */
export function paintedMetal(tint = "#d9d4c8"): TexSet {
  return texSet("metal" + tint, 256, 1.2, (c, h, s, r) => {
    c.fillStyle = tint; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 60, 3, r), v => [120, 90, 60, v * 60]);
    for (let k = 0; k < 25; k++) { c.fillStyle = `rgba(${110 + r() * 40},${60 + r() * 20},30,${0.2 + r() * 0.4})`; c.beginPath(); c.arc(r() * s, r() * s, 1 + r() * 6, 0, 7); c.fill(); }
    heightNoise(h, s, fbm(s, 3, 2, r), 20);
  });
}

/** multicam-style uniform fabric */
export function camo(palette = ["#b9a27e", "#8f7b58", "#6f6448", "#c9b894", "#4f4a38"], key = "camo"): TexSet {
  return texSet(key + palette.join(""), 256, 2.0, (c, h, s, r) => {
    c.fillStyle = palette[0]; c.fillRect(0, 0, s, s);
    for (let layer = 1; layer < palette.length; layer++) {
      const n = fbm(s, 40 / layer + 10, 3, r);
      noiseLayer(c, s, n, v => [...hex(palette[layer]), v > 0.56 ? 220 : 0] as [number, number, number, number]);
    }
    // weave
    for (let y = 0; y < s; y += 2) { c.fillStyle = "rgba(0,0,0,0.05)"; c.fillRect(0, y, s, 1); h.fillStyle = "rgba(0,0,0,0.25)"; h.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { h.fillStyle = "rgba(255,255,255,0.15)"; h.fillRect(x, 0, 1, s); }
    heightNoise(h, s, fbm(s, 30, 3, r), 40);
  }, x => { x.fillStyle = "#e8e8e8"; x.fillRect(0, 0, 256, 256); });
}

/** matte polymer / parkerized steel with machining and wear on edges */
export function gunMetal(tint = "#2b2c2e", key = "gun"): TexSet {
  return texSet(key + tint, 256, 0.8, (c, h, s, r) => {
    c.fillStyle = tint; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 2, 2, r), v => [v * 90, v * 90, v * 92, 50]);
    noiseLayer(c, s, fbm(s, 50, 3, r), v => [160, 155, 145, v > 0.62 ? 40 : 0]);
    heightNoise(h, s, fbm(s, 2, 2, r), 30);
  }, x => { const g = x.createLinearGradient(0, 0, 256, 256); g.addColorStop(0, "#a8a8a8"); g.addColorStop(1, "#c0c0c0"); x.fillStyle = g; x.fillRect(0, 0, 256, 256); });
}

/** canvas text sign (road/customs signage) */
export function signTexture(lines: string[], bg = "#2d5f96", fg = "#ffffff", w = 1024, h = 256): THREE.Texture {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(14, 14, w - 28, h - 28);
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
  lines.forEach((l, i) => { x.font = `${i === 0 ? 700 : 500} ${i === 0 ? 74 : 44}px "Barlow Condensed", "Arial Narrow", sans-serif`; x.fillText(l, w / 2, h * ((i + 1) / (lines.length + 1)) + (i === 0 ? 0 : 6)); });
  // weathering
  for (let k = 0; k < 400; k++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 20, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** mashrabiya lattice: turned-wood grid with see-through gaps (alpha) */
export function lattice(): THREE.Texture {
  const key = "lattice"; const hit = cache.get(key); if (hit) return hit.map;
  const c = canvas(256), x = c.getContext("2d")!;
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = "#6a4426"; x.lineWidth = 7;
  for (let k = -256; k < 512; k += 32) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 256, 256); x.stroke(); x.beginPath(); x.moveTo(k, 256); x.lineTo(k + 256, 0); x.stroke(); }
  x.fillStyle = "#7a5230"; for (let a = 0; a < 256; a += 32) for (let b = 0; b < 256; b += 32) { x.beginPath(); x.arc(a, b, 6, 0, 7); x.fill(); x.beginPath(); x.arc(a + 16, b + 16, 5, 0, 7); x.fill(); }
  x.strokeStyle = "#4a2e18"; x.lineWidth = 12; x.strokeRect(0, 0, 256, 256);
  const t = toTex(c, true); cache.set(key, { map: t, normalMap: t });
  return t;
}

/** hand-knotted Moroccan rug */
export function rug(seed = 1, palette = ["#8e2a22", "#1f3a5a", "#e6d8bc", "#c98a3a", "#2a2320"]): THREE.Texture {
  const key = "rug" + seed; const hit = cache.get(key); if (hit) return hit.map;
  const W = 512, H = 768, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d")!;
  const rr = rng(seed * 97 + 5);
  x.fillStyle = palette[0]; x.fillRect(0, 0, W, H);
  // borders
  const band = (m: number, col: string, w: number) => { x.strokeStyle = col; x.lineWidth = w; x.strokeRect(m, m, W - 2 * m, H - 2 * m); };
  band(18, palette[4], 12); band(40, palette[2], 10); band(62, palette[1], 22); band(84, palette[2], 6);
  for (let k = 0; k < W; k += 24) { x.fillStyle = palette[3]; x.beginPath(); x.moveTo(k, 52); x.lineTo(k + 12, 62); x.lineTo(k, 72); x.lineTo(k - 12, 62); x.fill(); x.beginPath(); x.moveTo(k, H - 52); x.lineTo(k + 12, H - 62); x.lineTo(k, H - 72); x.lineTo(k - 12, H - 62); x.fill(); }
  // central medallions and lozenges
  for (let row = 0; row < 3; row++) {
    const cy = 200 + row * 184, cx = W / 2;
    for (let s2 = 5; s2 >= 1; s2--) { x.fillStyle = [palette[1], palette[2], palette[3], palette[4], palette[2]][s2 - 1]; x.beginPath(); x.moveTo(cx, cy - s2 * 16); x.lineTo(cx + s2 * 26, cy); x.lineTo(cx, cy + s2 * 16); x.lineTo(cx - s2 * 26, cy); x.fill(); }
  }
  for (let k = 0; k < 40; k++) { x.fillStyle = palette[2]; const px = 110 + rr() * (W - 220), py = 110 + rr() * (H - 220); x.fillRect(px, py, 6, 6); }
  // wool pile
  const img = x.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) { const v = (rr() - 0.5) * 34; img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v; }
  x.putImageData(img, 0, 0);
  const t = toTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; cache.set(key, { map: t, normalMap: t });
  return t;
}

/** nylon with MOLLE/PALS webbing rows and bar-tack stitching */
export function molle(base = "#8e7c5a"): TexSet {
  return texSet("molle" + base, 256, 3.0, (c, h, s, r) => {
    const b = hex(base);
    c.fillStyle = base; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 2, 2, r), v => [...mix(b, v > 0.5 ? [255, 255, 240] : [0, 0, 0], 0.12), 90] as [number, number, number, number]);
    const rows = 8, rh = s / rows;
    for (let k = 0; k < rows; k++) {
      const y = k * rh + rh * 0.25;
      c.fillStyle = `rgb(${mix(b, [0, 0, 0], 0.18).map(Math.round).join(",")})`; c.fillRect(0, y, s, rh * 0.42);
      h.fillStyle = "#c8c8c8"; h.fillRect(0, y, s, rh * 0.42);
      h.fillStyle = "#505050"; h.fillRect(0, y - 1, s, 1); h.fillRect(0, y + rh * 0.42, s, 1);
      for (let x = 0; x < s; x += s / 6) { c.fillStyle = `rgba(0,0,0,0.35)`; c.fillRect(x, y, 3, rh * 0.42); h.fillStyle = "#606060"; h.fillRect(x, y, 3, rh * 0.42); }
    }
    for (let y = 0; y < s; y += 2) { h.fillStyle = "rgba(0,0,0,0.12)"; h.fillRect(0, y, s, 1); }
  }, x => { x.fillStyle = "#e8e8e8"; x.fillRect(0, 0, 256, 256); });
}

/** cast concrete: form lines, pinholes, chips and grime */
export function concrete(tint = "#c7c1b6"): TexSet {
  return texSet("concrete" + tint, 512, 1.8, (c, h, s, r) => {
    const b = hex(tint);
    c.fillStyle = tint; c.fillRect(0, 0, s, s);
    noiseLayer(c, s, fbm(s, 120, 4, r), v => [...mix(mix(b, [235, 230, 220], 0.3), mix(b, [120, 110, 95], 0.45), v), 120] as [number, number, number, number]);
    noiseLayer(c, s, fbm(s, 3, 2, r), v => [...mix(b, v > 0.5 ? [250, 248, 240] : [90, 85, 75], 0.5), 50] as [number, number, number, number]);
    for (let k = 0; k < 260; k++) { const x = r() * s, y = r() * s, rr = 0.6 + r() * 1.8; c.fillStyle = "rgba(60,55,50,0.6)"; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill(); h.fillStyle = "#303030"; h.beginPath(); h.arc(x, y, rr, 0, 7); h.fill(); }
    for (let k = 0; k < 10; k++) { const x = r() * s, y = r() * s, w = 8 + r() * 30, hh = 4 + r() * 14; c.fillStyle = "rgba(150,140,125,0.7)"; c.beginPath(); c.ellipse(x, y, w, hh, r() * 3, 0, 7); c.fill(); h.fillStyle = "rgba(40,40,40,0.8)"; h.beginPath(); h.ellipse(x, y, w, hh, r() * 3, 0, 7); h.fill(); }
    for (let y = 0; y < s; y += 128) { h.fillStyle = "rgba(60,60,60,0.5)"; h.fillRect(0, y, s, 2); c.fillStyle = "rgba(90,80,70,0.15)"; c.fillRect(0, y, s, 2); }
    heightNoise(h, s, fbm(s, 4, 3, r), 40);
  }, x => { x.fillStyle = "#e6e6e6"; x.fillRect(0, 0, 512, 512); });
}

/** carved gypsum stucco: interlaced eight-point star lattice, deep relief */
export function stucco(tint = "#e9dcc4"): TexSet {
  return texSet("stucco" + tint, 512, 5.0, (c, h, s, r) => {
    c.fillStyle = tint; c.fillRect(0, 0, s, s); h.fillStyle = "#909090"; h.fillRect(0, 0, s, s);
    const cell = s / 4;
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
      const cx = (xx + 0.5) * cell, cy = (yy + 0.5) * cell;
      for (const [lw, col] of [[14, "#d8d8d8"], [6, "#f4f4f4"]] as [number, string][]) {
        h.strokeStyle = col; h.lineWidth = lw; h.beginPath();
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, rr = k % 2 ? cell * 0.24 : cell * 0.44; const px = cx + Math.cos(a + Math.PI / 8) * rr, py = cy + Math.sin(a + Math.PI / 8) * rr; k ? h.lineTo(px, py) : h.moveTo(px, py); }
        h.closePath(); h.stroke();
        h.beginPath(); h.arc(cx, cy, cell * 0.12, 0, 7); h.stroke();
        h.beginPath(); h.moveTo(cx - cell / 2, cy - cell / 2); h.lineTo(cx - cell * 0.3, cy - cell * 0.3); h.moveTo(cx + cell / 2, cy - cell / 2); h.lineTo(cx + cell * 0.3, cy - cell * 0.3); h.stroke();
      }
      c.fillStyle = "rgba(120,90,60,0.12)"; c.beginPath(); c.arc(cx, cy, cell * 0.3, 0, 7); c.fill();
    }
    noiseLayer(c, s, fbm(s, 60, 3, r), v => [110, 85, 60, v * 50]);
    heightNoise(h, s, fbm(s, 3, 2, r), 20);
  }, x => { x.fillStyle = "#d0d0d0"; x.fillRect(0, 0, 512, 512); });
}
