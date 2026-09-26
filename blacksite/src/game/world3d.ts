// Builds the daylit, themed 3D world around the tile-grid level: architecture, floors, ceilings, exterior
// dressing and far scenery. All static level surfaces share one shader extension that adds
//   bake: lamp light baked from the simulation's light map (emissive, so lamps can go out), and
//   occl: sky visibility, so interiors get less sky/bounce light than the sunlit courtyard.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { dome, jerseyBarrier, mountainRing, palmTree, razorWire, sandbagRow, satelliteDish, watchTower, waterTank } from "./models";
import { asphalt, cedar, lattice, stucco, paintedMetal, paving, plaster, rug, sand, signTexture, stoneBlocks, terracotta, zellige, type TexSet } from "./textures";
import type { Theme } from "./theme";
import { getAssets, type PBRSet } from "./assets";
import type { Level } from "./types";
import { T } from "./types";

// ------------------------------------------------------------------------------------------ material
const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`;
/** grime: darkening toward the ground (splash-back, dust) and large-scale tint drift so tiling never reads */
export function levelMaterial(params: THREE.MeshStandardMaterialParameters, grime = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = sh => {
    sh.uniforms.uGrime = { value: grime };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 bake;\nattribute float occl;\nvarying vec3 vBake;\nvarying float vOccl;\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBake = bake; vOccl = occl; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBake;\nvarying float vOccl;\nvarying vec3 vWPos;\nuniform float uGrime;" + NOISE_GLSL)
      .replace("#include <map_fragment>", `#include <map_fragment>
        if (uGrime > 0.0) {
          float n = vnoise(vWPos.xz * 0.23 + vWPos.y * 0.11) * 0.6 + vnoise(vWPos.xz * 1.3 + vWPos.y * 0.9) * 0.4;
          float ground = 1.0 - smoothstep(0.0, 0.9 + n * 0.8, vWPos.y);
          vec3 dirt = diffuseColor.rgb * vec3(0.62, 0.55, 0.47);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirt, ground * 0.75 * uGrime);
          diffuseColor.rgb *= 1.0 + (n - 0.5) * 0.22 * uGrime;
        }
        if (vOccl < 0.999 && abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))).y) < 0.5) { float cAO = mix(0.58, 1.0, smoothstep(0.0, 0.6, vWPos.y)) * mix(0.7, 1.0, smoothstep(3.3, 2.75, vWPos.y)); diffuseColor.rgb *= cAO; }`)
      .replace("#include <lights_fragment_end>", "irradiance *= vOccl;\n#if defined( RE_IndirectSpecular )\niblIrradiance *= vOccl; radiance *= vOccl;\n#endif\n#include <lights_fragment_end>")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBake;\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.68) * clamp(1.0 - vOccl, 0.0, 1.0) * 0.42;");
  };
  m.customProgramCacheKey = () => "lvl";
  return m;
}

function scaled(t: THREE.Texture, metres: number): THREE.Texture {
  const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(1 / metres, 1 / metres); c.needsUpdate = true; return c;
}
/** a photo-scanned CC0 set, tinted to the theme's palette */
function scan(set: PBRSet, metres: number, tint: string, extra: THREE.MeshStandardMaterialParameters = {}, grime = 0): THREE.MeshStandardMaterial {
  return levelMaterial({ map: scaled(set.map, metres), normalMap: scaled(set.normalMap, metres), roughnessMap: scaled(set.roughnessMap, metres), color: new THREE.Color(tint), roughness: 1, metalness: 0, ...extra }, grime);
}
function pbr(set: TexSet, metres: number, extra: THREE.MeshStandardMaterialParameters = {}, grime = 0): THREE.MeshStandardMaterial {
  return levelMaterial({ map: scaled(set.map, metres), normalMap: scaled(set.normalMap, metres), roughnessMap: set.roughnessMap ? scaled(set.roughnessMap, metres) : undefined, roughness: 0.9, metalness: 0, ...extra }, grime);
}

// ------------------------------------------------------------------------------------------ batching
type Sampler = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => { bake: [number, number, number]; occl: number };

export class Batch {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = []; samp: number[] = [];
  count() { return this.pos.length / 3; }
  private pushV(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) this.uv.push(x, z); else if (ax >= az) this.uv.push(nx > 0 ? -z : z, y); else this.uv.push(nz > 0 ? x : -x, y);
    this.samp.push(x, y, z, nx, ny, nz);
  }
  /** quad a,b,c,d counter-clockwise when seen from the normal side */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[]) {
    const v = this.count();
    for (const p of [a, b, c, d]) this.pushV(p[0], p[1], p[2], n[0], n[1], n[2]);
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  geo(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const src = g.index ? g : g;
    if (m) src.applyMatrix4(m);
    const p = src.attributes.position as THREE.BufferAttribute, n = src.attributes.normal as THREE.BufferAttribute;
    const v = this.count();
    for (let i = 0; i < p.count; i++) this.pushV(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    if (src.index) { const ix = src.index.array; for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + v); }
    else for (let i = 0; i < p.count; i++) this.idx.push(v + i);
    g.dispose();
  }
  build(mat: THREE.Material, sampler: Sampler): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    const n = this.count(), bake = new Float32Array(n * 3), occl = new Float32Array(n);
    g.setAttribute("bake", new THREE.BufferAttribute(bake, 3));
    g.setAttribute("occl", new THREE.BufferAttribute(occl, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData.samp = new Float32Array(this.samp);
    resample(mesh, sampler);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
}
export function resample(mesh: THREE.Mesh, sampler: Sampler) {
  const s = mesh.userData.samp as Float32Array; if (!s) return;
  const bake = mesh.geometry.attributes.bake as THREE.BufferAttribute, occl = mesh.geometry.attributes.occl as THREE.BufferAttribute;
  for (let i = 0; i < occl.count; i++) {
    const r = sampler(s[i * 6], s[i * 6 + 1], s[i * 6 + 2], s[i * 6 + 3], s[i * 6 + 4], s[i * 6 + 5]);
    bake.setXYZ(i, r.bake[0], r.bake[1], r.bake[2]); occl.setX(i, r.occl);
  }
  bake.needsUpdate = true; occl.needsUpdate = true;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g;
};
const rbox = (w: number, h: number, d: number, r: number, x: number, y: number, z: number) => {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)); g.translate(x, y, z); return g;
};

/** pointed Moorish arch intrados from +halfW to -halfW */
function archPts(halfW: number, spring: number, rise: number, n = 14): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = halfW - (2 * halfW * i) / n, u = Math.abs(x) / halfW;
    pts.push([x, spring + rise * Math.pow(Math.max(0, 1 - Math.pow(u, 1.7)), 0.62)]);
  }
  return pts;
}
function extrude(pts: [number, number][], depth: number, holes: [number, number][][] = []): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** orientation matrix: local x along the wall, local z along the wall normal, placed at (x,z) */
function place(x: number, z: number, alongX: boolean, y = 0, flip = false): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(alongX ? (flip ? Math.PI : 0) : (flip ? Math.PI / 2 : -Math.PI / 2));
  m.setPosition(x, y, z);
  return m;
}

// ------------------------------------------------------------------------------------------ world
export interface WorldBuild {
  root: THREE.Group;
  walls: THREE.Group;
  meshes: THREE.Mesh[]; // everything that carries bake/occl, for relighting
  doorH: number;
  interiorH: number;
}

export class WorldBuilder {
  L: Level; th: Theme;
  mats: Record<string, THREE.Material> = {};
  sampler: Sampler;
  skyVis: Float32Array;
  lampRGB: [number, number, number];
  lightmap: Float32Array; lightBase: (i: number) => number;
  bx0 = 0; by0 = 0; bx1 = 0; by1 = 0;

  constructor(L: Level, th: Theme, lightmap: Float32Array, lightBase: (i: number) => number) {
    this.L = L; this.th = th; this.lightmap = lightmap; this.lightBase = lightBase;
    const c = new THREE.Color(th.lampColor); this.lampRGB = [c.r, c.g, c.b];
    // building bounds
    let x0 = L.w, y0 = L.h, x1 = 0, y1 = 0;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.tiles[y * L.w + x] !== T.EXT) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
    this.bx0 = x0; this.by0 = y0; this.bx1 = x1; this.by1 = y1;
    this.skyVis = this.computeSkyVis();
    this.sampler = (x, y, z, nx, ny, nz) => this.sample(x, y, z, nx, ny, nz);
    this.makeMaterials();
  }

  private tile(x: number, y: number) { return x < 0 || y < 0 || x >= this.L.w || y >= this.L.h ? T.EXT : this.L.tiles[y * this.L.w + x]; }

  /** daylight reaching each tile: 1 outside; inside, spills in through doorways and falls off */
  private computeSkyVis(): Float32Array {
    const L = this.L, n = L.w * L.h, d = new Float32Array(n).fill(99), q: number[] = [];
    for (let i = 0; i < n; i++) if (L.tiles[i] === T.EXT) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % L.w, y = (i / L.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= L.w || yy >= L.h) continue;
        const j = yy * L.w + xx, t = L.tiles[j]; if (t === T.WALL) continue;
        if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
      }
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = L.tiles[i] === T.EXT ? 1 : 0.5 + 0.45 * Math.exp(-Math.max(0, d[i] - 1) / 2.6);
    return out;
  }

  sample(x: number, y: number, z: number, nx: number, ny: number, nz: number): { bake: [number, number, number]; occl: number } {
    const L = this.L;
    const sx = x + nx * 0.45, sz = z + nz * 0.45;
    if (sx < 0 || sz < 0 || sx >= L.w || sz >= L.h) return { bake: [0, 0, 0], occl: 1 };
    const tx = Math.floor(sx), tz = Math.floor(sz), i = tz * L.w + tx;
    const t = L.tiles[i];
    if (t === T.EXT || t === T.WALL) return { bake: [0, 0, 0], occl: 1 };
    if (y > this.th.interiorH + 0.05) return { bake: [0, 0, 0], occl: 1 };
    const lamp = Math.max(0, (this.lightmap[i] ?? 0) - this.lightBase(i)) * 0.8;
    const vis = this.skyVis[i];
    // ceilings get less sky, floors near doors get more
    const o = ny < -0.5 ? vis * 0.8 : vis;
    return { bake: [lamp * this.lampRGB[0], lamp * this.lampRGB[1], lamp * this.lampRGB[2]], occl: o };
  }

  private makeMaterials() {
    const th = this.th;
    const M = this.mats;
    M.extWall = pbr(plaster(th.exterior.wall, "ext"), 2.2, {}, 1);
    M.plinth = pbr(stoneBlocks(th.exterior.plinth), 2.4, {}, 0.8);
    M.trim = pbr(plaster(th.exterior.trim, "trim"), 2, {}, 0.6);
    M.intWall = pbr(plaster(th.interior.wall, "int"), 2.5, {}, 0.35);
    M.ceiling = pbr(plaster(th.interior.ceiling, "ceil"), 3);
    M.beam = pbr(cedar(), 1.6, { roughness: 0.7 });
    M.wood = pbr(cedar(), 1.2, { roughness: 0.65 });
    M.dado = th.interior.dado === "zellige" ? pbr(zellige(th.interior.dadoPalette), 0.42, { roughness: 0.18, metalness: 0.05 }, 0.3)
      : th.interior.dado === "wood" ? pbr(cedar(), 1.2) : pbr(plaster(th.interior.dadoPaint ?? th.interior.wall, "dado"), 2, { roughness: 0.6 });
    M.skirt = pbr(stoneBlocks(th.exterior.plinth), 1.4);
    M.roof = pbr(plaster(th.exterior.wall, "roof"), 4);
    M.ground = pbr(sand(th.exterior.ground), 7, {}, 0.5);
    M.apron = pbr(paving(th.exterior.apron), 2.2, {}, 0.5);
    M.asphalt = pbr(asphalt(), 6, { roughness: 0.95 });
    M.metal = pbr(paintedMetal("#d6d1c4"), 1.5, { roughness: 0.6, metalness: 0.3 });
    M.darkMetal = pbr(paintedMetal("#3b3f42"), 1.5, { roughness: 0.55, metalness: 0.5 });
    M.glass = levelMaterial({ color: 0x1a2530, roughness: 0.06, metalness: 0.6 });
    M.white = levelMaterial({ color: 0xece8e0, roughness: 0.7 });
    M.red = levelMaterial({ color: 0xb8302a, roughness: 0.7 });
    M.brass = levelMaterial({ color: 0xb58a45, roughness: 0.35, metalness: 0.9 });
    M.threshold = pbr(stoneBlocks(th.exterior.trim), 1.2);
    // swap in real surface scans where we have them (ambientCG, CC0)
    const A = getAssets();
    if (A) {
      const T = A.tex;
      const warm = (hex: string, k = 1.18) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return "#" + c.getHexString(); };
      M.extWall = scan(T.plaster, 2.1, warm(th.exterior.wall), {}, 1.3);
      M.roof = scan(T.plaster, 4, th.exterior.wall);
      M.trim = scan(T.plaster, 1.6, warm(th.exterior.trim, 1.05), {}, 0.5);

      M.plinth = scan(T.brick, 1.6, "#d9b48c", {}, 0.8);
      M.skirt = scan(T.brick, 1.0, "#c9a07a");
      M.apron = scan(T.paving, 3.2, "#f0dcc0", {}, 1.0);
      M.asphalt = scan(T.asphalt, 5, "#b8b0a4", {}); (M.asphalt as THREE.MeshStandardMaterial).roughnessMap = null; (M.asphalt as THREE.MeshStandardMaterial).roughness = 0.93;
      M.metal = scan(T.metal, 2, "#e4ded2", { metalness: 0.45 });
      M.darkMetal = scan(T.metal, 1.5, "#5a5d60", { metalness: 0.6 });
      M.white = scan(T.concrete, 2, "#f2eee6");
    }
    M.zelligeFloor = pbr(zellige(th.interior.dadoPalette), 0.6, { roughness: 0.25 }, 0.3);
    M.stucco = pbr(stucco(), 1.2, { roughness: 0.85 }, 0.4);
    M.sandDrift = pbr(sand(th.exterior.ground), 2.5, { roughness: 1 });
    M.lampPanel = levelMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0.7, roughness: 0.3 });
    M.cardboard = levelMaterial({ color: 0xa47d52, roughness: 0.95 });
    M.leaf = levelMaterial({ color: 0x4d6b2c, roughness: 0.8 });
    M.pot = pbr(terracotta("#b0603a"), 0.8);
    M.screen = levelMaterial({ color: 0x06090c, emissive: 0x3a6f96, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.3 });
    M.ledG = levelMaterial({ color: 0x103018, emissive: 0x40ff80, emissiveIntensity: 1.2 });
    M.ledR = levelMaterial({ color: 0x301010, emissive: 0xff4030, emissiveIntensity: 1.2 });
    M.plastic = levelMaterial({ color: 0x2a2c2f, roughness: 0.55 });
    M.books = levelMaterial({ color: 0x7a3a2a, roughness: 0.8 });
    M.books2 = levelMaterial({ color: 0x2e4a6a, roughness: 0.8 });
    M.books3 = levelMaterial({ color: 0xc9b48a, roughness: 0.8 });
    M.container = pbr(paintedMetal("#2f6a8a"), 2, { roughness: 0.6, metalness: 0.4 });
  }

  floorMat(kind: string, tint: string): THREE.Material {
    const key = "floor-" + kind + tint;
    if (!this.mats[key]) {
      this.mats[key] = kind === "terracotta" ? pbr(terracotta(tint), 1.2, { roughness: 0.75 })
        : kind === "zellige" ? this.mats.zelligeFloor
        : kind === "metal" ? pbr(paintedMetal(tint), 0.6, { roughness: 0.45, metalness: 0.5 })
        : kind === "wood" ? pbr(cedar(), 1.5, { roughness: 0.5, color: new THREE.Color(tint).multiplyScalar(1.6) })
        : pbr(paving(tint), 1.6, { roughness: 0.72 });
    }
    return this.mats[key];
  }

  // ---------------------------------------------------------------------------------------- build
  build(): WorldBuild {
    const root = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const B: Record<string, Batch> = {};
    const b = (k: string) => (B[k] ??= new Batch());
    this.floorsAndCeilings(b);
    this.exterior(b);
    this.dressing(root, b);
    this.props(b);
    for (const [k, batch] of Object.entries(B)) {
      const mat = k.startsWith("floor-") ? this.floorByKey(k) : this.mats[k];
      const m = batch.build(mat, this.sampler); if (m) { m.name = k; root.add(m); meshes.push(m); }
    }
    const walls = this.buildWalls(); root.add(walls);
    walls.children.forEach(c => meshes.push(c as THREE.Mesh));
    return { root, walls, meshes, doorH: 2.2, interiorH: this.th.interiorH };
  }
  private floorKeys = new Map<string, [string, string]>();
  private floorByKey(k: string) { const [kind, tint] = this.floorKeys.get(k)!; return this.floorMat(kind, tint); }

  buildWalls(): THREE.Group {
    const B: Record<string, Batch> = {};
    const b = (k: string) => (B[k] ??= new Batch());
    this.walls(b);
    const g = new THREE.Group();
    for (const [k, batch] of Object.entries(B)) { const m = batch.build(this.mats[k], this.sampler); if (m) { m.name = k; g.add(m); } }
    return g;
  }

  private isExteriorWall(x: number, y: number) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (this.tile(x + dx, y + dy) === T.EXT) return true;
    return false;
  }

  private walls(b: (k: string) => Batch) {
    const L = this.L, IH = this.th.interiorH, EH = this.th.exteriorH;
    const style = this.th.style;
    const roomOf = (x: number, y: number) => { const r = L.roomAt[y * L.w + x]; return r >= 0 ? L.rooms[r] : null; };
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, t = L.tiles[i];
      if (t === T.DOOR) { this.doorway(b, x, y); continue; }
      if (t !== T.WALL) continue;
      const ext = this.isExteriorWall(x, y);
      const hard = L.reinforced.has(i) && !ext;
      const dmg = 1 - Math.max(0, L.wallHp.get(i) ?? 220) / 220;
      const top = ext ? EH : IH;
      const sides: [number, number, number[][], number[]][] = [
        [1, 0, [[x + 1, 0, y + 1], [x + 1, 0, y]], [1, 0, 0]],
        [-1, 0, [[x, 0, y], [x, 0, y + 1]], [-1, 0, 0]],
        [0, 1, [[x, 0, y + 1], [x + 1, 0, y + 1]], [0, 0, 1]],
        [0, -1, [[x + 1, 0, y], [x, 0, y]], [0, 0, -1]],
      ];
      for (const [dx, dy, [p0, p1], n] of sides) {
        const nt = this.tile(x + dx, y + dy);
        if (nt === T.WALL) continue;
        const face = (y0: number, y1: number, key: string, off = 0) => {
          const ox = n[0] * off, oz = n[2] * off;
          b(key).quad([p0[0] + ox, y0, p0[2] + oz], [p1[0] + ox, y0, p1[2] + oz], [p1[0] + ox, y1, p1[2] + oz], [p0[0] + ox, y1, p0[2] + oz], n);
        };
        const strip = (y0: number, y1: number, depth: number, key: string) => {
          const cx = (p0[0] + p1[0]) / 2 + n[0] * depth / 2, cz = (p0[2] + p1[2]) / 2 + n[2] * depth / 2;
          b(key).geo(box(Math.abs(p1[0] - p0[0]) || depth, y1 - y0, Math.abs(p1[2] - p0[2]) || depth, cx, (y0 + y1) / 2, cz));
        };
        if (nt === T.DOOR) { face(0, top, "trim"); continue; }
        if (nt === T.EXT) {
          // exterior facade: stone plinth, rendered wall, cornice, parapet
          strip(0, 0.75, 0.08, "plinth");
          face(0.75, top, "extWall");
          // glazed zellige frieze under a carved cornice
          face(top - 0.98, top - 0.7, "dado", 0.01);
          strip(top - 1.02, top - 0.98, 0.04, "trim");
          strip(top - 0.7, top - 0.52, 0.16, "trim");
          strip(top - 0.52, top - 0.46, 0.08, "trim");
          continue;
        }
        // interior face
        if (hard) { face(0, IH, "darkMetal"); strip(0.3, 0.42, 0.04, "metal"); strip(1.9, 2.02, 0.04, "metal"); continue; }
        const room = roomOf(x + dx, y + dy);
        const plain = !room || ["storage", "dock", "maintenance", "server", "vault", "armory", "holding"].includes(room.type);
        const wallKey = dmg > 0.3 ? "trim" : "intWall";
        strip(0, 0.14, 0.03, "skirt");
        if (!plain && this.th.interior.dado !== "none") { face(0.14, 1.18, "dado"); strip(1.18, 1.26, 0.035, style === "border" ? "wood" : "trim"); face(1.26, IH, wallKey); }
        else { face(0.14, IH, plain && style === "border" ? "trim" : wallKey); }
      }
      // cap
      b(ext ? "extWall" : "intWall").quad([x, top, y], [x, top, y + 1], [x + 1, top, y + 1], [x + 1, top, y], [0, 1, 0]);
      // stepped merlons on the parapet
      if (ext) {
        const outs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.tile(x + dx, y + dy) === T.EXT);
        for (const [dx, dy] of outs) {
          if ((dx === 0 ? x : y) % 2) continue;
          const cx = x + 0.5 + dx * 0.3, cz = y + 0.5 + dy * 0.3, along = dx === 0;
          b("extWall").geo(box(along ? 0.62 : 0.4, 0.55, along ? 0.4 : 0.62, cx, top + 0.27, cz));
          b("extWall").geo(box(along ? 0.36 : 0.4, 0.3, along ? 0.4 : 0.36, cx, top + 0.7, cz));
        }
      }
    }
  }

  private doorway(b: (k: string) => Batch, x: number, y: number) {
    const L = this.L, IH = this.th.interiorH, EH = this.th.exteriorH;
    const d = L.doors[L.doorAt[y * L.w + x]];
    const alongX = !d.vertical; // wall runs along x
    const cx = x + 0.5, cz = y + 0.5;
    const outer = d.rooms.includes(-1);
    const top = outer ? EH : IH;
    // pointed arch lintel through the wall thickness
    const pts: [number, number][] = [[-0.5, IH], ...archPts(0.5, 2.22, 0.5).reverse().map(([px, py]) => [px, py] as [number, number]), [0.5, IH]];
    // archPts goes +x -> -x; reversed goes -x -> +x; outline: (-0.5,IH) -> (-0.5,2.22) ... (0.5,2.22) -> (0.5,IH)
    b("trim").geo(extrude(pts, 1), place(cx, cz, alongX));
    if (outer) b("extWall").geo(box(1, EH - IH, 1, cx, (EH + IH) / 2, cz, alongX ? 0 : Math.PI / 2));
    // soffit cap
    b(outer ? "extWall" : "intWall").quad([x, top, y], [x, top, y + 1], [x + 1, top, y + 1], [x + 1, top, y], [0, 1, 0]);
    // threshold
    b("threshold").quad([x, 0.012, y], [x, 0.012, y + 1], [x + 1, 0.012, y + 1], [x + 1, 0.012, y], [0, 1, 0]);
    if (outer) this.portal(b, d, x, y);
  }

  /** decorative stone surround around an exterior doorway */
  private portal(b: (k: string) => Batch, d: Level["doors"][number], x: number, y: number) {
    const L = this.L;
    const alongX = !d.vertical;
    // which side is outside?
    const [dx, dy] = alongX ? (this.tile(x, y - 1) === T.EXT ? [0, -1] : [0, 1]) : (this.tile(x - 1, y) === T.EXT ? [-1, 0] : [1, 0]);
    const main = L.entrances.find(e => e.door === d.id)?.id === "main";
    const W = main ? 1.6 : 1.0, H = main ? 4.2 : 3.2;
    const frame: [number, number][] = [[-W, 0], [-0.5, 0], ...archPts(0.5, 2.22, 0.5).reverse(), [0.5, 0], [W, 0], [W, H], [-W, H]];
    const fx = x + 0.5 + dx * 0.56, fz = y + 0.5 + dy * 0.56;
    b("trim").geo(extrude(frame, 0.12), place(fx, fz, alongX));
    // zellige spandrels
    const sp: [number, number][] = [[-W + 0.12, 2.0], [-0.62, 2.0], [-0.62, 2.95], [-W + 0.12, 2.95]];
    for (const s of [1, -1]) b("dado").geo(extrude(sp.map(([px, py]) => [px * s, py] as [number, number]).reverse(), 0.02), place(fx + dx * 0.065, fz + dy * 0.065, alongX));
    b("dado").geo(extrude([[-W + 0.12, 3.05], [W - 0.12, 3.05], [W - 0.12, H - 0.18], [-W + 0.12, H - 0.18]], 0.02), place(fx + dx * 0.065, fz + dy * 0.065, alongX));
    // small canopy
    const cm = new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2); cm.setPosition(fx + dx * 0.35, H + 0.1, fz + dy * 0.35);
    b("wood").geo(new THREE.BoxGeometry(W * 2 + 0.3, 0.14, 0.7), cm);
    for (let k = -W; k <= W + 0.01; k += 0.3) b("wood").geo(new THREE.BoxGeometry(0.08, 0.1, 0.62), place(fx + dx * 0.4, fz + dy * 0.4, alongX, H - 0.02).multiply(new THREE.Matrix4().makeTranslation(k, 0, 0)));
    if (main) this.gateTower(b, x, y, dx, dy, alongX);
  }

  private gateTower(b: (k: string) => Batch, x: number, y: number, dx: number, dy: number, alongX: boolean) {
    const EH = this.th.exteriorH, top = EH + 5.2;
    const cx = x + 0.5, cz = y + 0.5;
    // tower rises from the facade: front face flush with the portal frame, body sinks back over the lobby
    const w = 5, d = 4.5;
    const ox = cx + (alongX ? 0 : -dx * (d / 2 - 0.62)), oz = cz + (alongX ? -dy * (d / 2 - 0.62) : 0);
    const bw = alongX ? w : d, bd = alongX ? d : w;
    b("extWall").geo(box(bw, top - 4.5, bd, ox, (top + 4.5) / 2, oz));
    b("trim").geo(box(bw + 0.3, 0.22, bd + 0.3, ox, EH + 0.2, oz));
    b("trim").geo(box(bw + 0.36, 0.28, bd + 0.36, ox, top - 0.1, oz));
    b("plinth").geo(box(bw + 0.1, 0.35, bd + 0.1, ox, 4.6, oz));
    // merlons
    for (let k = -2; k <= 2; k++) for (const s of [-1, 1]) {
      const px = alongX ? ox + k * 1.0 : ox + s * (bd / 2), pz = alongX ? oz + s * (bd / 2) : oz + k * 1.0;
      b("extWall").geo(box(0.5, 0.55, 0.5, px, top + 0.3, pz)); b("extWall").geo(box(0.3, 0.3, 0.5, px, top + 0.72, pz));
    }
    // belfry arches on the front
    const fx = alongX ? ox : ox + dx * (d / 2 + 0.01), fz = alongX ? oz + dy * (d / 2 + 0.01) : oz;
    for (const k of [-1.3, 0, 1.3]) {
      const wpts: [number, number][] = [[-0.42, 0], [0.42, 0], ...archPts(0.42, 1.0, 0.45)];
      const m = place(fx + (alongX ? k : 0), fz + (alongX ? 0 : k), alongX, top - 2.3);
      b("glass").geo(extrude(wpts, 0.04), m);
      const fr: [number, number][] = [[-0.58, -0.12], [0.58, -0.12], [0.58, 1.6], [-0.58, 1.6]];
      b("trim").geo(extrude(fr, 0.06, [[[-0.42, 0], [0.42, 0], ...archPts(0.42, 1.0, 0.45)].reverse() as [number, number][]]), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, dy * 0.02 + dx * 0.02)));
    }
    // clock
    const clk = document.createElement("canvas"); clk.width = clk.height = 256; const c = clk.getContext("2d")!;
    c.fillStyle = "#efe7d6"; c.beginPath(); c.arc(128, 128, 124, 0, 7); c.fill(); c.strokeStyle = "#2a2a2a"; c.lineWidth = 8; c.stroke();
    c.fillStyle = "#2a2a2a"; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; c.fillRect(128 + Math.cos(a) * 100 - 4, 128 + Math.sin(a) * 100 - 10, 8, 20); }
    c.lineCap = "round"; c.lineWidth = 9; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + 55, 128 - 30); c.stroke(); c.lineWidth = 6; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 - 10, 128 - 90); c.stroke();
    const tex = new THREE.CanvasTexture(clk); tex.colorSpace = THREE.SRGBColorSpace;
    this.extras.push(() => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      m.position.set(alongX ? ox : ox + dx * (d / 2 + 0.03), EH + 1.6, alongX ? oz + dy * (d / 2 + 0.03) : oz);
      m.lookAt(m.position.x + dx, m.position.y, m.position.z + dy);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.07, 10, 40), this.mats.brass); ring.position.copy(m.position); ring.lookAt(m.position.x + dx, m.position.y, m.position.z + dy);
      const dm = dome(1.55, 0x3f7f73); dm.position.set(ox, top + 0.1, oz);
      return [m, ring, dm];
    });
  }
  private extras: (() => THREE.Object3D[])[] = [];
  private bays: { x: number; z: number; dx: number; dy: number; y: number }[] = [];

  private floorsAndCeilings(b: (k: string) => Batch) {
    const L = this.L, IH = this.th.interiorH;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const t = L.tiles[y * L.w + x];
      if (t === T.WALL || t === T.EXT || t === T.DOOR) continue;
      const r = L.roomAt[y * L.w + x];
      const spec = (r >= 0 ? this.th.floors[L.rooms[r].type] : undefined) ?? this.th.floors.corridor ?? { kind: "paving", tint: "#c8bca8" };
      const key = "floor-" + spec.kind + spec.tint;
      this.floorKeys.set(key, [spec.kind, spec.tint]);
      b(key).quad([x, 0, y], [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [0, 1, 0]);
      b("ceiling").quad([x, IH, y], [x + 1, IH, y], [x + 1, IH, y + 1], [x, IH, y + 1], [0, -1, 0]);
    }
    // beams across rooms
    if (this.th.interior.beams) for (const r of L.rooms) {
      const acrossX = r.w <= r.h; // beams span the short side
      const len = acrossX ? r.w : r.h, n = Math.floor((acrossX ? r.h : r.w) / 1.4);
      for (let k = 1; k <= n; k++) {
        const t = (acrossX ? r.y : r.x) + (k * (acrossX ? r.h : r.w)) / (n + 1);
        if (acrossX) b("beam").geo(box(len, 0.2, 0.16, r.x + r.w / 2, IH - 0.1, t)); else b("beam").geo(box(0.16, 0.2, len, t, IH - 0.1, r.y + r.h / 2));
      }
      // cornice where wall meets ceiling
      b("trim").geo(box(r.w, 0.1, 0.08, r.x + r.w / 2, IH - 0.05, r.y + 0.04)); b("trim").geo(box(r.w, 0.1, 0.08, r.x + r.w / 2, IH - 0.05, r.y + r.h - 0.04));
      b("trim").geo(box(0.08, 0.1, r.h, r.x + 0.04, IH - 0.05, r.y + r.h / 2)); b("trim").geo(box(0.08, 0.1, r.h, r.x + r.w - 0.04, IH - 0.05, r.y + r.h / 2));
    }
    // roof slab over the building (casts the shade that keeps interiors out of the sun)
    const { bx0, by0, bx1, by1 } = this, RH = this.th.exteriorH - 0.6;
    b("roof").quad([bx0, RH, by0], [bx0, RH, by1], [bx1, RH, by1], [bx1, RH, by0], [0, 1, 0]);
  }

  private exterior(b: (k: string) => Batch) {
    const L = this.L;
    // wind-blown sand drifts banked against exterior walls
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (L.tiles[y * L.w + x] !== T.EXT) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.tile(x + dx, y + dy) !== T.WALL || ((x * 7 + y * 13) % 5) > 2) continue;
        const g = new THREE.CylinderGeometry(0.01, 0.42, 1.02, 3, 1); g.rotateZ(Math.PI / 2); g.scale(1, 0.32, 1);
        if (dy !== 0) { g.rotateY(0); } else g.rotateY(Math.PI / 2);
        g.translate(x + 0.5 + dx * 0.36, 0.0, y + 0.5 + dy * 0.36); b("sandDrift").geo(g);
      }
    }
    // compound paving on exterior tiles
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.tiles[y * L.w + x] === T.EXT) b("apron").quad([x, 0, y], [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [0, 1, 0]);
    // desert beyond (with a hole under the compound to avoid z-fighting)
    const R = 700, cx = L.w / 2, cz = L.h / 2;
    const ring = (x0: number, z0: number, x1: number, z1: number) => b("ground").quad([x0, -0.02, z0], [x0, -0.02, z1], [x1, -0.02, z1], [x1, -0.02, z0], [0, 1, 0]);
    ring(cx - R, cz - R, cx + R, -16); ring(cx - R, L.h, cx + R, cz + R); ring(cx - R, -16, 0, L.h); ring(L.w, -16, cx + R, L.h);
    ring(0, -3.2, L.w, 0);
    // road in front of the compound
    const rz0 = -15.5, rz1 = -3.2;
    b("asphalt").quad([cx - R, 0.0, rz0], [cx - R, 0.0, rz1], [cx + R, 0.0, rz1], [cx + R, 0.0, rz0], [0, 1, 0]);
    for (const z of [rz0 - 0.15, rz1 + 0.15]) for (let x = -80; x < L.w + 80; x += 1) b(x % 2 ? "white" : "red").geo(box(1, 0.16, 0.3, x + 0.5, 0.08, z));
    for (let x = -120; x < L.w + 120; x += 6) b("white").quad([x, 0.01, (rz0 + rz1) / 2 - 0.07], [x, 0.01, (rz0 + rz1) / 2 + 0.07], [x + 3, 0.01, (rz0 + rz1) / 2 + 0.07], [x + 3, 0.01, (rz0 + rz1) / 2 - 0.07], [0, 1, 0]);
    // stop line and hatched customs lane
    b("white").quad([cx - 6, 0.011, rz1 - 5.8], [cx - 6, 0.011, rz1 - 5.5], [cx + 6, 0.011, rz1 - 5.5], [cx + 6, 0.011, rz1 - 5.8], [0, 1, 0]);
  }

  // ---------------------------------------------------------------------------------------- set dressing
  private dressing(root: THREE.Group, b: (k: string) => Batch) {
    const L = this.L, th = this.th, EH = th.exteriorH, IH0 = th.interiorH + 0.05;
    const cx = L.w / 2;
    // perimeter wall on the sides and back, jersey barriers along the front
    const wallH = 3.0;
    const perim = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      b("extWall").geo(box(alongX ? len : 0.5, wallH, alongX ? 0.5 : len, mx, wallH / 2, mz));
      b("plinth").geo(box(alongX ? len : 0.6, 0.5, alongX ? 0.6 : len, mx, 0.25, mz));
      b("trim").geo(box(alongX ? len : 0.62, 0.12, alongX ? 0.62 : len, mx, wallH, mz));
      for (let t = 0.5; t < len; t += 2) { const px = alongX ? Math.min(x0, x1) + t : mx, pz = alongX ? mz : Math.min(z0, z1) + t; b("extWall").geo(box(0.5, 0.45, 0.5, px, wallH + 0.28, pz)); }
      for (let t = 0; t < len; t += 1.2) { const px = alongX ? Math.min(x0, x1) + t : mx, pz = alongX ? mz : Math.min(z0, z1) + t; b("darkMetal").geo(box(0.04, 0.7, 0.04, px, wallH + 0.4, pz)); }
      const wire = razorWire(len); wire.position.set(alongX ? Math.min(x0, x1) : mx, wallH + 0.35, alongX ? mz : Math.min(z0, z1)); if (!alongX) wire.rotation.y = -Math.PI / 2; wire.scale.set(1, 0.8, 0.8); root.add(wire);
    };
    perim(-0.3, L.h + 0.3, L.w + 0.3, L.h + 0.3);
    perim(-0.3, -0.3, -0.3, L.h + 0.3);
    perim(L.w + 0.3, -0.3, L.w + 0.3, L.h + 0.3);
    // front: barriers with a gap on the lane, and the gate booth
    for (let x = 0; x < L.w; x += 3.1) {
      if (Math.abs(x + 1.5 - cx) < 5) continue;
      const jb = jerseyBarrier(3); jb.position.set(x + 1.5, 0, -0.5); root.add(jb);
    }
    const w1 = razorWire(Math.max(1, cx - 6)); w1.position.set(0, 0.7, -1.1); w1.scale.set(1, 0.8, 0.8); root.add(w1);
    const w2 = razorWire(Math.max(1, cx - 6)); w2.position.set(cx + 6, 0.7, -1.1); w2.scale.set(1, 0.8, 0.8); root.add(w2);
    // sandbag positions at the front corners
    for (const x of [3, L.w - 3]) { const s = sandbagRow(3.2, 4); s.position.set(x, 0, -2.2); root.add(s); const s2 = sandbagRow(2, 4); s2.rotation.y = Math.PI / 2; s2.position.set(x + (x < cx ? -1.6 : 1.6), 0, -1.2); root.add(s2); }
    // sign gantry spanning the road, facing traffic in both directions
    const rz0 = -15.5, rz1 = -3.2, rmid = (rz0 + rz1) / 2;
    const gx = cx - 24;
    for (const z of [rz0 - 1.2, rz1 + 1.0]) { b("metal").geo(box(0.4, 7.4, 0.4, gx, 3.7, z)); b("plinth").geo(box(1.0, 0.5, 1.0, gx, 0.25, z)); }
    const spanZ = rz1 + 1.0 - (rz0 - 1.2);
    for (const y of [6.35, 7.15]) for (const dx of [-0.3, 0.3]) b("metal").geo(box(0.12, 0.12, spanZ, gx + dx, y, rmid - 0.1));
    for (let z = rz0 - 1.2; z < rz1 + 1.0; z += 0.8) { const g = new THREE.BoxGeometry(0.05, 0.05, 1.0); g.rotateX(Math.round(z / 0.8) % 2 ? 0.8 : -0.8); for (const dx of [-0.3, 0.3]) { const gg = g.clone(); gg.translate(gx + dx, 6.75, z + 0.4); b("metal").geo(gg); } g.dispose(); }
    const signs: [string[], number, number, string][] = [[["CUSTOMS CLEARANCE", "الجمارك  ·  DOUANE"], -3.2, 6.8, "#2f5f94"], [["ALL VEHICLES STOP", "INSPECTION 200 m"], 3.6, 5.2, "#2f5f94"]];
    for (const [lines, off, w, col] of signs) {
      const tex = signTexture(lines, col);
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 }));
        m.position.set(gx + side * 0.19, 5.35, rmid + off); m.rotation.y = side * Math.PI / 2; m.castShadow = true; root.add(m);
      }
      b("metal").geo(box(0.34, w / 4 + 0.12, w + 0.12, gx, 5.35, rmid + off));
      for (const dz of [-w / 3, w / 3]) b("metal").geo(box(0.08, 0.9, 0.08, gx, 6.1, rmid + off + dz));
    }
    // inspection canopy over the lanes, with a booth on the central island
    const kx = cx + 10, kw = 12;
    b("white").geo(box(kw, 0.7, spanZ + 1, kx, 5.35, rmid - 0.1)); b("red").geo(box(kw + 0.06, 0.26, spanZ + 1.06, kx, 5.05, rmid - 0.1));
    for (const dx of [-kw / 2 + 0.8, kw / 2 - 0.8]) for (const z of [rz0 - 1.2, rmid, rz1 + 1.0]) b("white").geo(rbox(0.5, 5.0, 0.5, 0.06, kx + dx, 2.5, z));
    const ctex = signTexture(["CUSTOMS  ·  الجمارك"], "#b8302a", "#ffffff", 1024, 128);
    for (const side of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(spanZ * 0.6, spanZ * 0.075), new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.5 })); m.position.set(kx + side * (kw / 2 + 0.04), 5.4, rmid - 0.1); m.rotation.y = side * Math.PI / 2; root.add(m); }
    b("plinth").geo(box(kw - 1, 0.25, 2.4, kx, 0.125, rmid));
    for (let z = rz0; z < rz1; z += 2.4) for (const dx of [-3, 0, 3]) b("lampPanel").geo(box(1.4, 0.04, 0.4, kx + dx, 4.98, z + 1));
    const bx = kx, bz = rmid;
    b("white").geo(box(2.2, 2.4, 1.8, bx, 1.45, bz)); b("glass").geo(box(2.25, 0.95, 1.85, bx, 1.85, bz));
    b("white").geo(box(2.8, 0.18, 2.4, bx, 2.74, bz)); b("red").geo(box(2.82, 0.1, 2.42, bx, 2.6, bz));
    for (const [z, dir] of [[bz - 1.3, -1], [bz + 1.3, 1]] as [number, number][]) {
      const boom = new THREE.Group(); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 5.2), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }));
      arm.position.z = dir * 2.6; boom.add(arm);
      for (let k = 0; k < 5; k += 1) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.105, 0.5), new THREE.MeshStandardMaterial({ color: 0xc0302a, roughness: 0.5 })); st.position.z = dir * (k + 0.25); boom.add(st); }
      boom.position.set(kx - kw / 2 + 1.6, 1.0, z); boom.traverse(o => { o.castShadow = true; }); root.add(boom);
      b("darkMetal").geo(box(0.4, 1.1, 0.4, kx - kw / 2 + 1.6, 0.55, z));
    }
    // palms along the road and inside the compound corners
    let seed = 1;
    for (let x = -60; x < L.w + 60; x += 9) { if (Math.abs(x - cx) < 14) continue; const p = palmTree(6.5 + ((seed * 37) % 5) * 0.5, seed++); p.position.set(x, 0, -18.5); root.add(p); }
    for (let x = -40; x < L.w + 40; x += 11) { const p = palmTree(7 + ((seed * 13) % 4) * 0.6, seed++); p.position.set(x + 3, 0, L.h + 4); root.add(p); }
    for (const z of [6, 16, 26, 36]) { for (const x of [-4, L.w + 4]) { const p = palmTree(7.5, seed++); p.position.set(x, 0, z); root.add(p); } }
    // watchtowers on the back corners
    for (const x of [-3.5, L.w + 3.5]) { const t = watchTower(10); t.position.set(x, 0, L.h + 3.5); root.add(t); }
    { const t = watchTower(9); t.position.set(-9, 0, -20); root.add(t); }
    // roof: domes, dish, water tanks
    const lobby = L.rooms.find(r => r.type === "lobby");
    const RH = EH - 0.6;
    for (const r of L.rooms) {
      if (r === lobby) continue;
      if (r.type === "executive" || r.type === "vault") { const d = dome(Math.min(r.w, r.h) * 0.22, 0xc58c52); d.position.set(r.x + r.w / 2, RH, r.y + r.h / 2); root.add(d); }
    }
    const dishes = [[this.bx0 + 4, this.by1 - 4], [this.bx1 - 6, this.by0 + 5]];
    for (const [x, z] of dishes) { const d = satelliteDish(1.1); d.position.set(x, RH, z); d.rotation.y = 2.4; root.add(d); }
    for (const x of [this.bx0 + 10, this.bx0 + 11.4, this.bx1 - 12]) { const t = waterTank(); t.position.set(x, RH, this.by1 - 3); root.add(t); }
    // facade windows and wall lanterns
    this.loggias(b);
    this.facadeWindows(b);
    this.wallDressing(root, b);
    this.pilasters(b);
    // mashrabiya bays: projecting carved-cedar window boxes
    const lat = lattice();
    const latMat = new THREE.MeshStandardMaterial({ map: lat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    for (const bay of this.bays) {
      const g = new THREE.Group(), W2 = 1.35, H2 = 1.8, D2 = 0.5;
      const woodM = this.mats.wood;
      const add = (geo: THREE.BufferGeometry, m2: THREE.Material) => { const mm = new THREE.Mesh(geo, m2); mm.castShadow = true; mm.receiveShadow = true; g.add(mm); return mm; };
      add(new THREE.BoxGeometry(W2 + 0.12, 0.12, D2 + 0.08), woodM).position.set(0, 0, D2 / 2);
      add(new THREE.BoxGeometry(W2 + 0.2, 0.1, D2 + 0.16), woodM).position.set(0, H2, D2 / 2);
      const roof = new THREE.CylinderGeometry(0.02, (W2 + 0.3) * 0.72, 0.35, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1, 1, (D2 + 0.25) / (W2 + 0.3)); add(roof, woodM).position.set(0, H2 + 0.22, D2 / 2);
      for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.06, H2, 0.06), woodM).position.set(sx * W2 / 2, H2 / 2, D2); add(new THREE.BoxGeometry(0.06, H2, 0.06), woodM).position.set(sx * W2 / 2, H2 / 2, 0.03); }
      const front = new THREE.Mesh(new THREE.PlaneGeometry(W2, H2 - 0.14), latMat); front.position.set(0, H2 / 2, D2); g.add(front);
      for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(D2, H2 - 0.14), latMat); side.rotation.y = Math.PI / 2; side.position.set(sx * W2 / 2, H2 / 2, D2 / 2); g.add(side); }
      for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.1, 0.25 - k * 0.06, 0.12 + k * 0.1), woodM).position.set((k - 1) * 0.5, -0.18, 0.1 + k * 0.02);
      g.position.set(bay.x, bay.y, bay.z); g.rotation.y = Math.atan2(bay.dx, bay.dy);
      root.add(g);
    }
    // kasbah corner towers rising above the parapet
    const TH = EH + 3.3, ts = 3.6;
    for (const [cx0, cz0, sx, sz] of [[this.bx0, this.by0, 1, 1], [this.bx1, this.by0, -1, 1], [this.bx0, this.by1, 1, -1], [this.bx1, this.by1, -1, -1]]) {
      const tx = cx0 + sx * ts / 2, tz = cz0 + sz * ts / 2;
      b("extWall").geo(box(ts + 0.06, TH - IH0, ts + 0.06, tx, (TH + IH0) / 2, tz));
      b("trim").geo(box(ts + 0.2, 0.2, ts + 0.2, tx, TH - 0.35, tz));
      b("dado").geo(box(ts + 0.02, 0.3, ts + 0.02, tx, TH - 0.62, tz));
      for (let k = 0; k < 4; k++) for (const [ox, oz] of [[-ts / 2, (k - 1.5) * 0.9], [ts / 2, (k - 1.5) * 0.9], [(k - 1.5) * 0.9, -ts / 2], [(k - 1.5) * 0.9, ts / 2]]) {
        b("extWall").geo(box(0.45, 0.55, 0.45, tx + ox * 0.94, TH + 0.27, tz + oz * 0.94)); b("extWall").geo(box(0.25, 0.3, 0.45, tx + ox * 0.94, TH + 0.68, tz + oz * 0.94));
      }
      for (const [ox, oz, ry] of [[-ts / 2 - 0.01, 0, Math.PI / 2], [ts / 2 + 0.01, 0, Math.PI / 2], [0, -ts / 2 - 0.01, 0], [0, ts / 2 + 0.01, 0]]) {
        const slit: [number, number][] = [[-0.16, 0], [0.16, 0], ...archPts(0.16, 0.8, 0.22)];
        const mm = new THREE.Matrix4().makeRotationY(ry as number); mm.setPosition(tx + (ox as number), EH + 0.6, tz + (oz as number));
        b("glass").geo(extrude(slit, 0.03), mm);
      }
      b("roof").quad([tx - ts / 2, TH, tz - ts / 2], [tx - ts / 2, TH, tz + ts / 2], [tx + ts / 2, TH, tz + ts / 2], [tx + ts / 2, TH, tz - ts / 2], [0, 1, 0]);
      if (sz === 1) this.extras.push(() => { const d = dome(1.25, 0x3f7f73); d.position.set(tx, TH, tz); return [d]; });
    }
    // rugs in the finer rooms
    let rs = 1;
    for (const r of L.rooms) {
      if (!["lobby", "executive", "office", "security"].includes(r.type)) continue;
      const w = Math.min(r.w - 2.5, 3.2), h2 = Math.min(r.h - 2.5, 4.6); if (w < 1.5 || h2 < 1.5) continue;
      const mm = new THREE.Mesh(new THREE.PlaneGeometry(w, h2), new THREE.MeshStandardMaterial({ map: rug(rs++), roughness: 0.95 }));
      mm.rotation.x = -Math.PI / 2; mm.position.set(r.x + r.w / 2, 0.008, r.y + r.h / 2); mm.receiveShadow = true; root.add(mm);
    }
    // far mountains
    if (th.mountains !== null) root.add(mountainRing(560, cx, L.h / 2, th.mountains));
    for (const f of this.extras) for (const o of f()) { o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); root.add(o); }
    // roadside clutter: parked trucks, cones, oil drums, a generator, pallets
    const truck = (x: number, z: number, ry: number, col: number) => {
      const g = new THREE.Group(); const paint = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.35 });
      const add = (geo: THREE.BufferGeometry, mm: THREE.Material, px: number, py: number, pz: number) => { const mesh = new THREE.Mesh(geo, mm); mesh.position.set(px, py, pz); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
      add(new RoundedBoxGeometry(4.6, 2.5, 2.3, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.6 }), -0.9, 1.95, 0);
      add(new RoundedBoxGeometry(1.8, 1.9, 2.25, 3, 0.2), paint, 2.35, 1.55, 0);
      add(new RoundedBoxGeometry(0.1, 0.8, 2.0, 2, 0.04), this.mats.glass, 3.22, 1.95, 0);
      for (const [wx, wz] of [[-2.4, 1.05], [-1.3, 1.05], [2.3, 1.05], [-2.4, -1.05], [-1.3, -1.05], [2.3, -1.05]]) { const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 20), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }), wx, 0.5, wz); w.rotation.x = Math.PI / 2; }
      add(new THREE.BoxGeometry(6.2, 0.25, 2.1), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }), 0, 0.72, 0);
      g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    };
    truck(cx - 38, -12.6, 0, 0x2f5f94); truck(cx - 46, -12.6, 0, 0xb8302a); truck(cx + 30, -6.2, Math.PI, 0xe8e2d4);
    const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 18);
    const drumMats = [0x2f5f94, 0x3d6b3a, 0x9a3a24, 0x6a6a64].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.4 }));
    for (const [x, z, k] of [[-1.4, -1.8, 0], [-2.0, -2.3, 1], [-1.3, -2.6, 2], [L.w + 1.6, -1.9, 3], [L.w + 2.2, -2.5, 0], [-1.5, L.h + 1.8, 1], [-2.1, L.h + 1.4, 2]] as [number, number, number][]) { const d = new THREE.Mesh(drum, drumMats[k]); d.position.set(x, 0.44, z); d.rotation.y = x * 3; d.castShadow = true; root.add(d); }
    const cone = new THREE.ConeGeometry(0.18, 0.7, 16); const coneM = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(cone, coneM); c.position.set(cx - 6 + i * 1.5, 0.35, -4.6); c.castShadow = true; root.add(c); }
    b("darkMetal").geo(box(1.8, 1.2, 1.0, L.w + 3.2, 0.6, 6)); b("metal").geo(box(1.9, 0.12, 1.1, L.w + 3.2, 1.25, 6));
    for (const [x, z] of [[-2.6, 12], [-2.6, 14], [L.w + 2.8, 20]]) { b("wood").geo(box(1.2, 0.14, 1.0, x, 0.07, z)); b("cardboard").geo(box(1.0, 0.8, 0.9, x, 0.55, z)); }
    // distant low outbuildings along the road for scale
    for (const [x, z, w, d, h] of [[-30, -28, 12, 8, 4.5], [-52, -26, 8, 8, 6], [L.w + 22, -30, 14, 9, 5], [L.w + 44, -26, 9, 7, 4]]) {
      b("extWall").geo(box(w, h, d, x, h / 2, z)); b("trim").geo(box(w + 0.3, 0.3, d + 0.3, x, h, z));
      for (let k = -w / 2 + 1; k < w / 2; k += 2.4) { b("glass").geo(box(0.9, 1.3, 0.05, x + k, h * 0.55, z + d / 2 + 0.02)); b("trim").geo(box(1.1, 0.12, 0.2, x + k, h * 0.55 - 0.7, z + d / 2 + 0.05)); }
    }
  }

  /** wall-mounted interior dressing: signs, notices, clocks, AC units, fuse boxes, ceiling fans */
  private wallDressing(root: THREE.Group, b: (k: string) => Batch) {
    const L = this.L, IH = this.th.interiorH;
    let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const sign = (lines: string[], bg: string, fg: string, w: number, h: number) => new THREE.MeshStandardMaterial({ map: signTexture(lines, bg, fg, 1024, Math.round(1024 * h / w)), roughness: 0.5 });
    const notice = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 192; const x = c.getContext("2d")!; x.fillStyle = "#6b4a2c"; x.fillRect(0, 0, 256, 192); x.fillStyle = "#b99a6e"; x.fillRect(8, 8, 240, 176);
      for (let k = 0; k < 9; k++) { x.save(); x.translate(20 + (k % 3) * 76 + rnd() * 10, 18 + Math.floor(k / 3) * 56 + rnd() * 6); x.rotate((rnd() - 0.5) * 0.12); x.fillStyle = ["#f4f0e4", "#fff6c8", "#e8eef4"][k % 3]; x.fillRect(0, 0, 58, 44); x.fillStyle = "#555"; for (let l = 0; l < 5; l++) x.fillRect(5, 6 + l * 7, 30 + rnd() * 18, 2); x.fillStyle = "#c33"; x.beginPath(); x.arc(29, 3, 3, 0, 7); x.fill(); x.restore(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); })();
    const clockTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!; x.fillStyle = "#f6f2e8"; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill(); x.fillStyle = "#222"; for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; x.fillRect(64 + Math.cos(a) * 50 - 2, 64 + Math.sin(a) * 50 - 5, 4, 10); } x.lineWidth = 4; x.strokeStyle = "#222"; x.beginPath(); x.moveTo(64, 64); x.lineTo(90, 50); x.moveTo(64, 64); x.lineTo(58, 22); x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }); })();
    const passport = sign(["PASSPORT CONTROL", "مراقبة الجوازات · CONTRÔLE DES PASSEPORTS"], "#2f5f94", "#ffffff", 2.4, 0.6);
    const staff = sign(["STAFF ONLY", "خاص بالموظفين"], "#b8302a", "#ffffff", 1.0, 0.36);
    const hazard = sign(["DANGER · HIGH VOLTAGE", "خطر"], "#f2c230", "#1a1a1a", 0.9, 0.5);
    const place = (m: THREE.Object3D, x: number, y: number, z: number, nx: number, nz: number) => { m.position.set(x + nx * 0.02, y, z + nz * 0.02); m.rotation.y = Math.atan2(nx, nz); m.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } }); root.add(m); };
    const plane = (w: number, h: number, mt: THREE.Material) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mt);
    for (const r of L.rooms) {
      // wall faces around the room: [x, z, nx, nz] at tile centres along each side
      const faces: [number, number, number, number][] = [];
      for (let x = r.x; x < r.x + r.w; x++) { if (L.tiles[(r.y - 1) * L.w + x] === T.WALL) faces.push([x + 0.5, r.y, 0, 1]); if (L.tiles[(r.y + r.h) * L.w + x] === T.WALL) faces.push([x + 0.5, r.y + r.h, 0, -1]); }
      for (let y = r.y; y < r.y + r.h; y++) { if (L.tiles[y * L.w + r.x - 1] === T.WALL) faces.push([r.x, y + 0.5, 1, 0]); if (L.tiles[y * L.w + r.x + r.w] === T.WALL) faces.push([r.x + r.w, y + 0.5, -1, 0]); }
      const pick = () => faces.splice(Math.floor(rnd() * faces.length), 1)[0];
      const n = Math.min(faces.length, 2 + Math.floor(r.w * r.h / 30));
      for (let k = 0; k < n; k++) {
        const f = pick(); if (!f) break;
        const [x, z, nx, nz] = f;
        const t = r.type;
        const roll = rnd();
        if (t === "lobby" && k === 0) place(plane(2.4, 0.6, passport), x, 2.55, z, nx, nz);
        else if ((t === "lobby" || t === "office" || t === "security") && roll < 0.3) { const g = new THREE.Group(); g.add(plane(0.9, 0.68, notice)); const fr = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.74, 0.03), this.mats.wood); fr.position.z = -0.018; g.add(fr); place(g, x, 1.65, z, nx, nz); }
        else if (roll < 0.45) { const g = new THREE.Group(); const cl = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), clockTex); cl.position.z = 0.03; g.add(cl); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 32), this.mats.darkMetal); rim.position.z = 0.03; g.add(rim); place(g, x, 2.45, z, nx, nz); }
        else if (roll < 0.65) { const g = new THREE.Group(); const ac = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.3, 0.22, 2, 0.04), this.mats.white); ac.position.z = 0.11; g.add(ac); const grill = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.01), this.mats.darkMetal); grill.position.set(0, -0.1, 0.225); g.add(grill); place(g, x, IH - 0.45, z, nx, nz); }
        else if ((t === "storage" || t === "dock" || t === "maintenance" || t === "server") && roll < 0.85) { const g = new THREE.Group(); const bx2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.16), this.mats.metal); bx2.position.z = 0.08; g.add(bx2); const hz = plane(0.4, 0.22, hazard); hz.position.set(0, 0.1, 0.161); g.add(hz); const cond = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, IH - 1.7, 8), this.mats.darkMetal); cond.position.set(0.15, (IH - 1.7) / 2 + 0.33, 0.03); g.add(cond); place(g, x, 1.4, z, nx, nz); }
        else place(plane(0.8, 0.29, staff), x, 2.2, z, nx, nz);
      }
      // ceiling fans in the finer rooms
      if (["lobby", "office", "executive", "security"].includes(r.type)) {
        const fan = new THREE.Group();
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), this.mats.brass); rod.position.y = -0.2; fan.add(rod);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 16), this.mats.brass); hub.position.y = -0.45; fan.add(hub);
        for (let k = 0; k < 4; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.012, 0.14), this.mats.wood); bl.position.set(Math.cos(k * Math.PI / 2) * 0.38, -0.47, Math.sin(k * Math.PI / 2) * 0.38); bl.rotation.set(0.12, -k * Math.PI / 2, 0); fan.add(bl); }
        fan.position.set(r.x + r.w * 0.3, IH, r.y + r.h * 0.4); fan.traverse(o => { (o as THREE.Mesh).castShadow = true; }); root.add(fan);
      }
    }
    // lobby: a large zellige star medallion set into the floor
    const lobby = L.rooms.find(r => r.type === "lobby");
    if (lobby) {
      const mm = (this.mats.zelligeFloor as THREE.MeshStandardMaterial).clone(); for (const k of ["map", "normalMap"] as const) { const t = mm[k]!.clone(); t.repeat.set(3.5, 3.5); t.needsUpdate = true; mm[k] = t; }
      const med = new THREE.Mesh(new THREE.CircleGeometry(Math.min(lobby.w, lobby.h) * 0.28, 48), mm);
      med.rotation.x = -Math.PI / 2; med.position.set(lobby.x + lobby.w * 0.62, 0.006, lobby.y + lobby.h * 0.5); med.receiveShadow = true; root.add(med);
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(lobby.w, lobby.h) * 0.28, Math.min(lobby.w, lobby.h) * 0.3, 48), this.mats.threshold); ring.rotation.x = -Math.PI / 2; ring.position.copy(med.position).setY(0.007); root.add(ring);
    }
  }

  /** arched upper-floor loggias either side of the gate tower: horseshoe arcade, zellige balustrade, corbels */
  private loggias(b: (k: string) => Batch) {
    const L = this.L, IH = this.th.interiorH, EH = this.th.exteriorH;
    const main = L.doors[L.entrances.find(e => e.id === "main")!.door];
    if (main.vertical) return;
    const z0 = main.y; // facade plane (outer face of the front wall)
    const D = 1.35, top = EH - 1.05, base = IH + 0.15, Hh = top - base;
    for (const side of [-1, 1]) {
      const W = 8.4, x0 = side < 0 ? main.x + 0.5 - 3.2 - W : main.x + 0.5 + 3.2, cx = x0 + W / 2;
      if (x0 < this.bx0 + 2 || x0 + W > this.bx1 - 2) continue;
      this.loggiaSpans.push([x0 - 0.3, x0 + W + 0.3]);
      const n = 6, bay = W / n, hw = bay * 0.34;
      const holes: [number, number][][] = [];
      for (let i = 0; i < n; i++) { const hx = -W / 2 + bay * (i + 0.5); holes.push(([[hx - hw, 0.95], [hx + hw, 0.95]] as [number, number][]).concat( ...archPts(hw, Hh - 0.75, 0.42).map(([px, py]) => [px + hx, py] as [number, number])).reverse()); }
      const front = extrude([[-W / 2, 0], [W / 2, 0], [W / 2, Hh], [-W / 2, Hh]], 0.28, holes);
      const m = new THREE.Matrix4().makeTranslation(cx, base, z0 - D);
      b("trim").geo(front, m);
      // carved arch surrounds and zellige spandrels
      for (let i = 0; i < n; i++) {
        const hx = -W / 2 + bay * (i + 0.5);
        const ring: [number, number][] = [[hx - hw - 0.08, Hh - 0.75], ...archPts(hw + 0.08, Hh - 0.75, 0.48).map(([px, py]) => [px + hx, py] as [number, number]).reverse(), [hx + hw + 0.08, Hh - 0.75], [hx + hw, Hh - 0.75], ...archPts(hw, Hh - 0.75, 0.42).map(([px, py]) => [px + hx, py] as [number, number]), [hx - hw, Hh - 0.75]];
        b("wood").geo(extrude(ring, 0.05), new THREE.Matrix4().makeTranslation(cx, base, z0 - D - 0.16));
        b("dado").geo(extrude([[hx - bay / 2 + 0.06, 0.1], [hx + bay / 2 - 0.06, 0.1], [hx + bay / 2 - 0.06, 0.85], [hx - bay / 2 + 0.06, 0.85]], 0.02), new THREE.Matrix4().makeTranslation(cx, base, z0 - D - 0.15));
      }
      // floor slab on carved corbels, entablature, frieze, merlons
      b("trim").geo(box(W + 0.3, 0.22, D + 0.1, cx, base - 0.11, z0 - D / 2));
      for (let i = 0; i <= n; i++) {
        const kx = x0 + i * bay;
        // carved corbel: ogee profile tapering back into the wall, with a scroll at the tip
        const prof: [number, number][] = [[0, 0], [0, -0.75], ...Array.from({ length: 9 }, (_, j) => { const u = (j + 1) / 9; return [u * (D - 0.05), -0.75 + 0.75 * Math.pow(u, 0.55) - 0.08 * Math.sin(u * Math.PI)] as [number, number]; }), [D - 0.05, 0]];
        const cm = new THREE.Matrix4().makeRotationY(Math.PI / 2); cm.setPosition(kx, base - 0.22, z0);
        b("trim").geo(extrude(prof, 0.2), cm);
      }
      b("trim").geo(box(W + 0.4, 0.2, D + 0.2, cx, base + Hh + 0.1, z0 - D / 2));
      b("dado").geo(box(W + 0.02, 0.26, 0.02, cx, base + Hh - 0.17, z0 - D - 0.15));
      for (let i = 0; i < n * 2; i++) { const kx = x0 + 0.35 + i * (W - 0.7) / (n * 2 - 1); b("extWall").geo(box(0.34, 0.4, 0.34, kx, base + Hh + 0.4, z0 - D + 0.05)); b("extWall").geo(box(0.2, 0.22, 0.34, kx, base + Hh + 0.71, z0 - D + 0.05)); }
      // side walls with a single arch, dark interior back wall and ceiling
      for (const sx of [x0, x0 + W]) {
        const sideHole: [number, number][] = [[-0.35, 0.95], [0.35, 0.95], ...archPts(0.35, Hh - 0.75, 0.4)];
        const sm = new THREE.Matrix4().makeRotationY(Math.PI / 2); sm.setPosition(sx, base, z0 - D / 2);
        b("trim").geo(extrude([[-D / 2, 0], [D / 2, 0], [D / 2, Hh], [-D / 2, Hh]], 0.22, [sideHole.reverse()]), sm);
      }
      b("wood").quad([x0, base + Hh - 0.01, z0], [x0 + W, base + Hh - 0.01, z0], [x0 + W, base + Hh - 0.01, z0 - D], [x0, base + Hh - 0.01, z0 - D], [0, -1, 0]);
      b("threshold").quad([x0, base + 0.005, z0 - D], [x0 + W, base + 0.005, z0 - D], [x0 + W, base + 0.005, z0], [x0, base + 0.005, z0], [0, 1, 0]);
    }
  }
  private loggiaSpans: [number, number][] = [];

  /** shallow pilasters and quoined corners so long walls read as masonry, not planes */
  private pilasters(b: (k: string) => Batch) {
    const L = this.L, EH = this.th.exteriorH;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (L.tiles[y * L.w + x] !== T.WALL) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (this.tile(x + dx, y + dy) !== T.EXT) continue;
        const alongX = dx === 0, coord = alongX ? x : y;
        const fx = x + 0.5 + dx * 0.5, fz = y + 0.5 + dy * 0.5;
        const corner = this.tile(x + (alongX ? 1 : 0), y + (alongX ? 0 : 1)) === T.EXT || this.tile(x - (alongX ? 1 : 0), y - (alongX ? 0 : 1)) === T.EXT;
        if (corner) {
          // quoins: alternating long/short dressed blocks up the corner
          const endSign = this.tile(x + (alongX ? 1 : 0), y + (alongX ? 0 : 1)) === T.EXT ? 1 : -1;
          for (let k = 0; k < 11; k++) {
            const len = k % 2 ? 0.5 : 0.8, hy = 0.8 + k * 0.48;
            if (hy > EH - 0.8) break;
            const px = fx + (alongX ? endSign * (0.5 - len / 2) : 0) + dx * 0.04, pz = fz + (alongX ? 0 : endSign * (0.5 - len / 2)) + dy * 0.04;
            b("plinth").geo(box(alongX ? len : 0.08, 0.42, alongX ? 0.08 : len, px, hy, pz));
          }
          continue;
        }
        if (coord % 8 !== 6) continue;
        if (alongX && dy < 0 && this.loggiaSpans.some(([a, bb]) => x + 0.5 > a && x + 0.5 < bb)) continue;
        b("trim").geo(box(alongX ? 0.5 : 0.12, EH - 1.6, alongX ? 0.12 : 0.5, fx + dx * 0.06, 0.8 + (EH - 1.6) / 2, fz + dy * 0.06));
        b("trim").geo(box(alongX ? 0.62 : 0.2, 0.2, alongX ? 0.2 : 0.62, fx + dx * 0.1, 0.85, fz + dy * 0.1));
      }
    }
  }

  private facadeWindows(b: (k: string) => Batch) {
    const L = this.L, IH = this.th.interiorH;
    const doorsOut = L.doors.filter(d => d.rooms.includes(-1));
    const nearDoor = (x: number, y: number, r: number) => doorsOut.some(d => Math.abs(d.x - x) <= r && Math.abs(d.y - y) <= r);
    const mainDoor = L.doors[L.entrances.find(e => e.id === "main")!.door];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (L.tiles[y * L.w + x] !== T.WALL) continue;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (this.tile(x + dx, y + dy) !== T.EXT) continue;
        // wall face must be straight here (neighbours along the wall are wall too)
        const alongX = dx === 0;
        const coord = alongX ? x : y;
        if (coord % 4 !== 2) continue;
        if (this.tile(x + (alongX ? 1 : 0), y + (alongX ? 0 : 1)) === T.EXT || this.tile(x - (alongX ? 1 : 0), y - (alongX ? 0 : 1)) === T.EXT) continue;
        if (Math.abs(mainDoor.x - x) <= 3 && Math.abs(mainDoor.y - y) <= 3) continue;
        const inLoggia = alongX && dy < 0 && this.loggiaSpans.some(([a, bb]) => x + 0.5 > a && x + 0.5 < bb);
        const fx = x + 0.5 + dx * 0.5, fz = y + 0.5 + dy * 0.5;
        const m = (yy: number, off: number) => place(fx + dx * off, fz + dy * off, alongX, yy);
        // upper storey: tall arched window with frame, glass and cedar mashrabiya
        const win: [number, number][] = [[-0.45, 0], [0.45, 0], ...archPts(0.45, 1.25, 0.45)];
        const UW = IH + 0.25;
        if (!inLoggia) {
        b("glass").geo(extrude(win, 0.02), m(UW, 0.012));
        b("trim").geo(extrude([[-0.66, -0.16], [0.66, -0.16], [0.66, 1.85], [-0.66, 1.85]], 0.08, [[...win].reverse()]), m(UW, 0.2));
        b("extWall").geo(extrude([[-0.52, -0.02], [0.52, -0.02], [0.52, 1.78], [-0.52, 1.78]], 0.2, [[...win].reverse()]), m(UW, 0.1)); // deep reveal
        if (coord % 8 === 2) this.bays.push({ x: fx, z: fz, dx, dy, y: UW - 0.2 });
        else {
          for (let k = -0.3; k <= 0.31; k += 0.15) b("wood").geo(box(0.035, 1.3, 0.035, 0, 0.62, 0), m(UW, 0.04).multiply(new THREE.Matrix4().makeTranslation(k, 0, 0)));
          for (let k = 0.2; k <= 1.2; k += 0.25) b("wood").geo(box(0.86, 0.035, 0.035, 0, k, 0), m(UW, 0.04));
        }
        b("trim").geo(box(1.25, 0.09, 0.36, 0, 0, 0), m(UW - 0.15, 0.18));
        } else { b("glass").geo(extrude(win, 0.02), m(UW + 0.05, 0.012)); b("wood").geo(box(0.9, 1.6, 0.05, 0, 0.8, 0), m(UW + 0.05, 0.03)); }
        // ground floor: barred window, unless next to a door
        if (!nearDoor(x, y, 2)) {
          const low: [number, number][] = [[-0.4, 0], [0.4, 0], [0.4, 1.15], ...archPts(0.4, 1.15, 0.3).slice(1, -1), [-0.4, 1.15]];
          b("glass").geo(extrude(low, 0.02), m(1.05, 0.012));
          b("trim").geo(extrude([[-0.58, -0.14], [0.58, -0.14], [0.58, 1.6], [-0.58, 1.6]], 0.07, [[...low].reverse()]), m(1.05, 0.215));
          b("extWall").geo(extrude([[-0.48, -0.03], [0.48, -0.03], [0.48, 1.52], [-0.48, 1.52]], 0.2, [[...low].reverse()]), m(1.05, 0.1)); // deep reveal
          for (let k = -0.3; k <= 0.31; k += 0.12) { const g = new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6); g.translate(k, 0.62, 0); b("darkMetal").geo(g, m(1.05, 0.16)); }
          b("trim").geo(box(1.1, 0.09, 0.34, 0, 0, 0), m(1.0, 0.17));
          b("stucco").geo(box(1.16, 0.62, 0.05, 0, 0, 0), m(2.95, 0.03)); b("trim").geo(box(1.3, 0.07, 0.12, 0, 0, 0), m(3.3, 0.06)); b("trim").geo(box(1.3, 0.07, 0.12, 0, 0, 0), m(2.6, 0.06));
        } else if (coord % 8 === 2) {
          // wall lantern
          b("brass").geo(box(0.2, 0.34, 0.2, 0, 0, 0), m(2.7, 0.2));
          b("brass").geo(box(0.04, 0.04, 0.2, 0, 0, 0), m(2.95, 0.1));
        }
      }
    }
  }
  // ---------------------------------------------------------------------------------------- furniture
  private props(b: (k: string) => Batch) {
    const L = this.L;
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const p of L.props) {
      const x0 = p.x, z0 = p.y, w = p.w, d = p.h, cx = x0 + w / 2, cz = z0 + d / 2;
      const long = w >= d; // long axis along x?
      const len = long ? w : d, dep = long ? d : w;
      const bx = (key: string, lw: number, h: number, ld: number, ox: number, y: number, oz: number, round = 0) => {
        // box in prop-local coords (x along long axis)
        const [ww, dd, xx, zz] = long ? [lw, ld, cx + ox, cz + oz] : [ld, lw, cx + oz, cz + ox];
        b(key).geo(round ? rbox(ww, h, dd, round, xx, y + h / 2, zz) : box(ww, h, dd, xx, y + h / 2, zz));
      };
      const cyl = (key: string, rad: number, h: number, ox: number, y: number, oz: number, horiz = false) => {
        const g = new THREE.CylinderGeometry(rad, rad, h, 18); if (horiz) g.rotateZ(Math.PI / 2);
        const [xx, zz] = long ? [cx + ox, cz + oz] : [cx + oz, cz + ox];
        if (horiz && !long) g.rotateY(Math.PI / 2);
        g.translate(xx, y, zz); b(key).geo(g);
      };
      const L2 = len - 0.12, D2 = dep - 0.12;
      switch (p.kind) {
        case "desk": case "execdesk": {
          const wood = "wood";
          bx(wood, L2, 0.05, Math.min(D2, 0.8), 0, 0.72, 0, 0.01);
          for (const s of [-1, 1]) bx(wood, 0.05, 0.72, Math.min(D2, 0.8) - 0.05, s * (L2 / 2 - 0.03), 0, 0);
          bx(wood, L2 - 0.1, 0.4, 0.03, 0, 0.3, Math.min(D2, 0.8) / 2 - 0.1);
          for (let k = 0; k < Math.floor(len); k++) {
            const ox = -len / 2 + k + 0.5;
            bx("plastic", 0.5, 0.3, 0.03, ox, 0.92, -0.12, 0.01); bx("screen", 0.46, 0.26, 0.005, ox, 0.94, -0.103);
            bx("plastic", 0.05, 0.16, 0.05, ox, 0.77, -0.14); bx("plastic", 0.2, 0.015, 0.15, ox, 0.77, -0.14);
            bx("plastic", 0.42, 0.02, 0.14, ox, 0.77, 0.14, 0.005);
            if (r() < 0.5) bx("white", 0.21, 0.01, 0.3, ox + 0.3, 0.77, 0.1);
          }
          break;
        }
        case "reception": {
          bx("dado", L2, 1.0, D2 * 0.6, 0, 0, 0);
          bx("wood", L2 + 0.08, 0.06, D2 * 0.6 + 0.1, 0, 1.0, 0, 0.01);
          bx("screen", 0.46, 0.26, 0.005, -len / 4, 1.2, -0.05); bx("plastic", 0.5, 0.3, 0.03, -len / 4, 1.18, -0.07, 0.01);
          break;
        }
        case "console": {
          bx("darkMetal", L2, 0.78, D2 * 0.8, 0, 0, 0, 0.02);
          for (let k = 0; k < Math.floor(len * 1.6); k++) { const ox = -L2 / 2 + 0.3 + k * 0.62; bx("plastic", 0.56, 0.36, 0.04, ox, 0.95, -0.15, 0.01); bx("screen", 0.52, 0.32, 0.005, ox, 0.97, -0.128); }
          break;
        }
        case "bench": bx("white", L2, 0.06, D2 * 0.85, 0, 0.88, 0); bx("metal", L2 - 0.1, 0.86, D2 * 0.75, 0, 0, 0, 0.02);
          for (let k = 0; k < len; k += 0.7) cyl("glass", 0.04, 0.18, -len / 2 + 0.4 + k, 1.03, 0.1);
          break;
        case "cabinet": case "locker": case "fridge": {
          const n = Math.max(1, Math.round(len / 0.6)), h = p.kind === "fridge" ? 1.9 : p.kind === "locker" ? 1.95 : 1.4;
          for (let k = 0; k < n; k++) {
            const ox = -len / 2 + (k + 0.5) * (len / n);
            bx(p.kind === "fridge" ? "white" : "metal", len / n - 0.03, h, D2 * 0.8, ox, 0, 0, 0.015);
            bx("darkMetal", 0.02, 0.18, 0.03, ox + len / n / 2 - 0.12, h * 0.55, -D2 * 0.4);
            if (p.kind === "locker") for (let v = 0; v < 4; v++) bx("darkMetal", len / n - 0.2, 0.01, 0.01, ox, h - 0.2 - v * 0.03, -D2 * 0.4 - 0.005);
          }
          break;
        }
        case "bookshelf": case "shelf": {
          const frame = p.kind === "bookshelf" ? "wood" : "metal", h = 2.0;
          for (const s of [-1, 1]) bx(frame, 0.04, h, D2 * 0.7, s * (L2 / 2 - 0.02), 0, 0);
          for (let y = 0.05; y < h; y += 0.45) {
            bx(frame, L2, 0.03, D2 * 0.7, 0, y, 0);
            let ox = -L2 / 2 + 0.06;
            while (ox < L2 / 2 - 0.15) {
              if (p.kind === "bookshelf") { const bw = 0.03 + r() * 0.04, bh = 0.24 + r() * 0.12; bx(["books", "books2", "books3"][Math.floor(r() * 3)], bw, bh, D2 * 0.55, ox + bw / 2, y + 0.03, 0); ox += bw + 0.004; if (r() < 0.05) ox += 0.15; }
              else { const bw = 0.3 + r() * 0.2, bh = 0.2 + r() * 0.18; if (r() < 0.8) bx("cardboard", bw, bh, D2 * 0.6, ox + bw / 2, y + 0.03, 0, 0.01); ox += bw + 0.05; }
            }
          }
          break;
        }
        case "rack": {
          const n = Math.max(1, Math.round(dep / 0.8));
          for (let k = 0; k < Math.round(len / 0.65); k++) {
            const ox = -len / 2 + 0.33 + k * 0.65;
            bx("plastic", 0.6, 2.05, D2 * 0.9, ox, 0, 0, 0.01);
            for (let v = 0; v < 14; v++) { bx(v % 3 ? "darkMetal" : "metal", 0.54, 0.09, 0.02, ox, 0.2 + v * 0.13, -D2 * 0.45); if (r() < 0.6) bx(r() < 0.85 ? "ledG" : "ledR", 0.012, 0.012, 0.01, ox - 0.22 + r() * 0.1, 0.24 + v * 0.13, -D2 * 0.45 - 0.012); }
          }
          void n; break;
        }
        case "crate": {
          const n = Math.max(1, Math.round(len));
          for (let k = 0; k < n; k++) {
            const ox = -len / 2 + k + 0.5, s = 0.78 + r() * 0.12;
            bx("wood", s, s, Math.min(s, D2), ox, 0, 0, 0.01);
            if (r() < 0.5) bx("wood", s * 0.8, s * 0.8, Math.min(s * 0.8, D2), ox + (r() - 0.5) * 0.1, s, 0, 0.01);
          }
          break;
        }
        case "trailer": {
          bx("container", L2, 2.5, D2, 0, 0, 0);
          for (let k = -L2 / 2 + 0.1; k < L2 / 2; k += 0.28) bx("container", 0.12, 2.4, D2 + 0.06, k, 0.05, 0);
          break;
        }
        case "tank": case "boiler": {
          for (let k = 0; k < Math.max(1, Math.round(len / 1.2)); k++) { const ox = -len / 2 + 0.6 + k * 1.2; cyl(p.kind === "boiler" ? "darkMetal" : "metal", Math.min(0.5, D2 / 2), 1.8, ox, 0.95, 0); cyl("darkMetal", 0.06, 1.2, ox, 2.1, 0); }
          break;
        }
        case "pipes": for (let k = 0; k < 3; k++) cyl("darkMetal", 0.08, len, 0, 0.6 + k * 0.5, (k - 1) * 0.18, true); break;
        case "gunrack": bx("darkMetal", L2, 1.8, D2 * 0.5, 0, 0, 0, 0.01); for (let k = -L2 / 2 + 0.15; k < L2 / 2; k += 0.18) bx("plastic", 0.06, 0.95, 0.05, k, 0.5, -D2 * 0.28); break;
        case "safe": bx("darkMetal", Math.min(L2, 0.9), 1.1, Math.min(D2, 0.8), 0, 0, 0, 0.03); cyl("brass", 0.06, 0.04, 0, 0.7, -Math.min(D2, 0.8) / 2 - 0.02); break;
        case "plant": { const pot = new THREE.CylinderGeometry(0.28, 0.2, 0.5, 16); pot.translate(cx, 0.25, cz); b("pot").geo(pot); const f = new THREE.IcosahedronGeometry(0.5, 1); f.scale(1, 1.3, 1); f.translate(cx, 1.1, cz); b("leaf").geo(f); break; }
        case "bars": for (let k = -len / 2 + 0.1; k < len / 2; k += 0.14) cyl("darkMetal", 0.018, 2.6, k, 1.3, 0); bx("darkMetal", len, 0.06, 0.06, 0, 2.5, 0); bx("darkMetal", len, 0.06, 0.06, 0, 1.0, 0); break;
        case "deposit": { const h = 2.2; bx("metal", L2, h, D2 * 0.7, 0, 0, 0); for (let y = 0.1; y < h - 0.1; y += 0.22) for (let k = -L2 / 2 + 0.12; k < L2 / 2 - 0.1; k += 0.3) bx("brass", 0.26, 0.18, 0.01, k + 0.13, y, -D2 * 0.35 - 0.005); break; }
        case "pedestal": bx("trim", 0.6, 1.0, 0.6, 0, 0, 0, 0.02); bx("glass", 0.55, 0.45, 0.55, 0, 1.0, 0); break;
        case "terminal": bx("darkMetal", 0.6, 1.1, 0.5, 0, 0, 0, 0.03); bx("screen", 0.48, 0.36, 0.01, 0, 1.12, -0.18); bx("darkMetal", 0.56, 0.44, 0.06, 0, 1.08, -0.15); break;
        default: bx(p.tall ? "metal" : "wood", L2, p.tall ? 1.9 : 0.8, D2, 0, 0, 0, 0.02);
      }
    }
  }
}
