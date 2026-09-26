// Procedural models: firearms built from published dimensions (side profiles extruded with bevels, then
// detailed with receivers, rails, sights and furniture), gloved hands that wrap around what they hold,
// soldiers with anatomical proportions, gear and two-bone IK arms, and set dressing. Units are metres.
// Guns point along +x with y up and +z to the gun's right.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { camo, concrete, gunMetal, molle } from "./textures";
import { getAssets } from "./assets";
import type { WeaponId } from "./types";

// ------------------------------------------------------------------------------------------ materials
const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material { let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; }
function rep(t: THREE.Texture, r: number): THREE.Texture { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(r, r); c.needsUpdate = true; return c; }
function fabric(key: string, palette: string[], repeat: number, tint = 0xffffff): THREE.Material {
  return mat("fab-" + key + repeat, () => { const t = camo(palette, key); return new THREE.MeshStandardMaterial({ map: rep(t.map, repeat), normalMap: rep(t.normalMap, repeat), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.95, metalness: 0, color: tint }); });
}
const MULTICAM = ["#a8926c", "#8a7552", "#6b5f43", "#c2b08a", "#4c4533"];
export const M = {
  anodized: () => mat("anod", () => { const t = gunMetal("#1c1d1f", "anod"); return new THREE.MeshStandardMaterial({ color: 0x5a5c60, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0.45, roughness: 0.48 }); }),
  steel: () => mat("steel", () => { const t = gunMetal("#2c2d30", "steel"); return new THREE.MeshStandardMaterial({ color: 0x55575b, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0.7, roughness: 0.4 }); }),
  blued: () => mat("blued", () => new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.8, roughness: 0.32 })),
  alu: () => mat("alu", () => new THREE.MeshStandardMaterial({ color: 0x303134, metalness: 0.55, roughness: 0.45 })),
  polymer: () => mat("polymer", () => { const t = gunMetal("#1d1e20", "poly"); return new THREE.MeshStandardMaterial({ color: 0x46484c, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0.02, roughness: 0.66 }); }),
  grip: () => mat("gripTex", () => { const t = gunMetal("#1a1a1b", "gripstip"); return new THREE.MeshStandardMaterial({ color: 0x404144, map: rep(t.map, 4), normalMap: rep(t.normalMap, 4), normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.85 }); }),
  tanPoly: () => mat("tan", () => { const t = gunMetal("#8a7757", "tanpoly"); return new THREE.MeshStandardMaterial({ color: 0xa08a64, map: t.map, normalMap: t.normalMap, metalness: 0.03, roughness: 0.78 }); }),
  rubber: () => mat("rubber", () => new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0, roughness: 0.95 })),
  dark: () => mat("dark", () => new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.3, roughness: 0.6 })),
  wood: () => mat("wood", () => new THREE.MeshStandardMaterial({ color: 0x6a4428, metalness: 0, roughness: 0.55 })),
  glass: () => mat("glass", () => new THREE.MeshStandardMaterial({ color: 0x3a5068, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.28, depthWrite: false })),
  lens: () => mat("lens", () => new THREE.MeshStandardMaterial({ color: 0x0a1420, metalness: 1, roughness: 0.05, emissive: 0x05101a })),
  brass: () => mat("brass", () => new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 1, roughness: 0.3 })),
  glove: () => mat("glove", () => { const t = camo(["#9a8563", "#8c7757", "#a48f6c", "#83704f", "#95805e"], "glove"); return new THREE.MeshStandardMaterial({ map: rep(t.map, 2), normalMap: rep(t.normalMap, 3), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.82, metalness: 0 }); }),
  gloveKnuckle: () => mat("knuckle", () => new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.5 })),
  gloveTan: () => mat("gloveTan", () => new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 0.8 })),
  sleeve: () => mat("sleeveM", () => { const t = camo(MULTICAM, "camo"); const a = rep(t.map, 1), n = rep(t.normalMap, 1); a.repeat.set(1.5, 4); n.repeat.set(1.5, 4); return new THREE.MeshStandardMaterial({ map: a, normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.95 }); }),
  skin: () => mat("skin", () => new THREE.MeshStandardMaterial({ color: 0xa87a5e, roughness: 0.62 })),
};

// ------------------------------------------------------------------------------------------ geometry helpers
type P = [number, number][];
function shapeOf(pts: P, holes: P[] = []): THREE.Shape {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}
/** quadratic bezier as a point list (excluding the first point) */
function qb(p0: [number, number], c: [number, number], p1: [number, number], n = 6): P {
  const out: P = [];
  for (let i = 1; i <= n; i++) { const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; out.push([a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1]]); }
  return out;
}
/** side profile extruded to a thickness, centred on z=0, with a bevel so edges catch light */
function prof(pts: P, width: number, m: THREE.Material, bevel = 0.0025, holes: P[] = [], z = 0): THREE.Mesh {
  const b = Math.min(bevel, width / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth: Math.max(1e-4, width - b * 2), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(width - b * 2) / 2 + z);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
/** cylinder along x from x0 to x1 */
function tubeX(x0: number, x1: number, r: number, y: number, m: THREE.Material, seg = 20, z = 0, r1?: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1 ?? r, r, x1 - x0, seg); g.rotateZ(-Math.PI / 2); g.translate((x0 + x1) / 2, y, z);
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; return mesh;
}
function rbox(w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))); g.translate(x, y, z);
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
function bx(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; return mesh;
}
/** a curved box magazine: front and back edges follow an arc, ribbed */
function curvedMag(topFront: [number, number], depth: number, len: number, sweep: number, width: number, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const n = 12, front: P = [], back: P = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = sweep * t; // rotate the magazine's axis forward as it goes down
    const cx = topFront[0] + Math.sin(a) * len * t * 0.5 + (Math.sin(sweep * t) * len * t) * 0.35, cy = topFront[1] - len * t;
    front.push([cx + Math.sin(a) * 0.0, cy]);
    back.unshift([cx - depth * Math.cos(a) + 0.0, cy + depth * Math.sin(a) * 0.3]);
  }
  g.add(prof([...front, ...back], width, m, 0.0022));
  // floor plate and a couple of stamped ribs
  const last = front[front.length - 1], lb = back[0];
  g.add(prof([[lb[0] - 0.004, lb[1] - 0.004], [last[0] + 0.004, last[1] - 0.006], [last[0] + 0.004, last[1] + 0.006], [lb[0] - 0.004, lb[1] + 0.008]], width + 0.004, m, 0.0015));
  for (const s of [-1, 1]) {
    const rib: P = [];
    for (let i = 1; i < n - 1; i++) { const f = front[i], b = back[n - i]; rib.push([f[0] * 0.55 + b[0] * 0.45, f[1] * 0.55 + b[1] * 0.45]); }
    for (let i = rib.length - 1; i >= 0; i--) rib.push([rib[i][0] - 0.006, rib[i][1] + 0.001]);
    g.add(prof(rib, 0.003, m, 0.0008, [], s * (width / 2)));
  }
  return g;
}
/** picatinny rail: base plus teeth */
function rail(x0: number, x1: number, y: number, m: THREE.Material, w = 0.021): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(x1 - x0, 0.0055, w, 0.001, m, (x0 + x1) / 2, y, 0));
  for (let x = x0 + 0.004; x < x1 - 0.004; x += 0.01) g.add(rbox(0.0052, 0.0045, w, 0.0008, m, x, y + 0.0045, 0));
  return g;
}
function holoSight(x: number, y: number): THREE.Group {
  // EOTech EXPS3: ~100 mm long, 30x23 mm window inside a thin hood, side buttons, QD lever
  const g = new THREE.Group(), body = M.anodized();
  g.add(rbox(0.1, 0.014, 0.034, 0.004, body, x - 0.004, y + 0.007, 0));
  g.add(rbox(0.036, 0.018, 0.03, 0.006, body, x - 0.03, y + 0.02, 0)); // battery/laser housing
  g.add(rbox(0.014, 0.012, 0.004, 0.002, body, x - 0.02, y + 0.004, -0.019)); // QD lever
  const wy = y + 0.032;
  const frame = (fx: number, depth: number) => prof([[-0.021, -0.017], [0.021, -0.017], [0.021, 0.012], ...qb([0.021, 0.012], [0.021, 0.019], [0.014, 0.019]), [-0.014, 0.019], ...qb([-0.014, 0.019], [-0.021, 0.019], [-0.021, 0.012])], depth, body, 0.002,
    [[[-0.015, -0.011], [0.015, -0.011], [0.015, 0.012], [-0.015, 0.012]]]);
  const f1 = frame(0, 0.012); f1.rotation.y = Math.PI / 2; f1.position.set(x + 0.034, wy, 0); g.add(f1);
  const f2 = frame(0, 0.01); f2.rotation.y = Math.PI / 2; f2.position.set(x - 0.004, wy, 0); g.add(f2);
  g.add(rbox(0.04, 0.003, 0.036, 0.001, body, x + 0.015, wy + 0.018, 0));
  for (const s of [-1, 1]) g.add(rbox(0.04, 0.03, 0.003, 0.001, body, x + 0.015, wy + 0.001, s * 0.0195));
  for (const [bx2, bz] of [[x - 0.036, 0.016], [x - 0.024, 0.016]]) g.add(rbox(0.007, 0.007, 0.004, 0.002, M.rubber(), bx2, y + 0.022, bz));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.023), M.glass()); glass.position.set(x + 0.028, wy, 0); glass.rotation.y = Math.PI / 2; g.add(glass);
  // 68 MOA ring + 1 MOA dot
  const red = new THREE.MeshBasicMaterial({ color: 0xff3a24, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0046, 0.0053, 40), red); ring.position.set(x + 0.027, wy, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0005, 12), red); dot.position.set(x + 0.027, wy, 0); dot.rotation.y = Math.PI / 2; g.add(dot);
  g.userData.lineY = wy;
  return g;
}
function redDot(x: number, y: number): THREE.Group {
  const g = new THREE.Group(), m = M.anodized();
  g.add(tubeX(x - 0.03, x + 0.03, 0.017, y + 0.03, m, 28));
  g.add(rbox(0.045, 0.014, 0.03, 0.003, m, x, y + 0.007, 0));
  g.add(rbox(0.012, 0.012, 0.012, 0.003, m, x - 0.005, y + 0.03, 0.018));
  g.add(rbox(0.012, 0.012, 0.012, 0.003, m, x - 0.005, y + 0.05, 0));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0145, 24), M.glass()); lens.position.set(x + 0.0305, y + 0.03, 0); lens.rotation.y = Math.PI / 2; g.add(lens);
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.001, 10), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); d.position.set(x + 0.031, y + 0.03, 0); d.rotation.y = Math.PI / 2; g.add(d);
  g.userData.lineY = y + 0.03;
  return g;
}
function scope(x0: number, x1: number, y: number): THREE.Group {
  const g = new THREE.Group(), m = M.anodized();
  g.add(tubeX(x0 + 0.06, x1 - 0.07, 0.0127, y, m, 28));
  g.add(tubeX(x1 - 0.07, x1 - 0.045, 0.021, y, m, 28, 0, 0.0127));
  g.add(tubeX(x1 - 0.045, x1, 0.021, y, m, 28));
  g.add(tubeX(x0, x0 + 0.04, 0.019, y, m, 28));
  g.add(tubeX(x0 + 0.04, x0 + 0.06, 0.0127, y, m, 28, 0, 0.019));
  const mid = (x0 + x1) / 2;
  const t1 = new THREE.CylinderGeometry(0.011, 0.011, 0.026, 20); t1.translate(mid, y + 0.022, 0); g.add(new THREE.Mesh(t1, m));
  const t2 = new THREE.CylinderGeometry(0.011, 0.011, 0.026, 20); t2.rotateX(Math.PI / 2); t2.translate(mid, y, 0.022); g.add(new THREE.Mesh(t2, m));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 28), M.lens()); lens.position.set(x1 + 0.0005, y, 0); lens.rotation.y = Math.PI / 2; g.add(lens);
  for (const mx of [x0 + 0.08, x1 - 0.1]) { g.add(rbox(0.018, 0.024, 0.03, 0.003, m, mx, y - 0.02, 0)); g.add(tubeX(mx - 0.009, mx + 0.009, 0.0145, y, m, 20)); }
  g.userData.lineY = y;
  return g;
}

// ------------------------------------------------------------------------------------------ firearms
/** roll-marked engraving decal on the gun's left side (faces -z) */
function engrave(lines: string[], w: number, h: number, x: number, y: number, z: number, size = 22): THREE.Mesh {
  const c = document.createElement("canvas"); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height); g.fillStyle = "rgba(205,205,200,0.75)"; g.textBaseline = "middle";
  lines.forEach((l, i) => { g.font = `600 ${size}px "Arial Narrow", Arial, sans-serif`; g.fillText(l, 6, (c.height / (lines.length + 1)) * (i + 1)); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(x, y, z); m.rotation.y = Math.PI;
  return m;
}
/** a row of small cross pins */
function pins(g: THREE.Group, pts: [number, number][], z: number, m: THREE.Material) {
  for (const [x, y] of pts) { const p = new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 10); p.rotateX(Math.PI / 2); p.translate(x, y, z); g.add(new THREE.Mesh(p, m)); }
}
export interface GunModel extends THREE.Group { userData: { grip: THREE.Vector3; gripTilt: number; fore: THREE.Vector3; foreR: number; sightY: number; muzzle: THREE.Vector3; pistol: boolean; stockX: number } }

function ar15Lower(g: THREE.Group, A: THREE.Material, Pl: THREE.Material) {
  // lower receiver with flared magwell and integral trigger guard
  g.add(prof([[-0.108, 0], [0.086, 0], [0.086, -0.012], [0.09, -0.052], [0.084, -0.064], [0.02, -0.064], [0.018, -0.036], [-0.036, -0.034], [-0.07, -0.022], [-0.108, -0.016]], 0.032, A, 0.0028));
  g.add(prof([[-0.04, -0.036], [0.02, -0.036], [0.02, -0.04], [0.012, -0.056], [-0.03, -0.056], [-0.04, -0.046]], 0.018, A, 0.0015, [[[-0.03, -0.051], [0.01, -0.051], [0.014, -0.041], [-0.034, -0.041]]]));
  // A2-style grip with finger nub
  g.add(prof([[-0.036, -0.03], [-0.008, -0.032], [-0.02, -0.07], [-0.014, -0.08], [-0.028, -0.093], [-0.044, -0.128], [-0.078, -0.124], [-0.074, -0.1], [-0.06, -0.034]], 0.03, M.grip(), 0.005));
  g.add(bx(0.004, 0.018, 0.006, M.steel(), -0.006, -0.042, 0)); // trigger
  // selector, bolt catch, mag release
  g.add(rbox(0.016, 0.008, 0.006, 0.002, M.steel(), -0.058, -0.016, -0.019));
  g.add(rbox(0.012, 0.022, 0.004, 0.0015, A, 0.012, -0.02, -0.018));
  const mr = new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 14); mr.rotateX(Math.PI / 2); mr.translate(0.03, -0.028, 0.018); g.add(new THREE.Mesh(mr, A));
  void Pl;
}
function ar15Upper(g: THREE.Group, A: THREE.Material) {
  g.add(prof([[-0.11, 0], [0.1, 0], [0.1, 0.044], [-0.11, 0.044]], 0.03, A, 0.003));
  g.add(rail(-0.108, 0.1, 0.047, A));
  // ejection port with dust cover on the right, forward assist, brass deflector
  g.add(rbox(0.058, 0.019, 0.003, 0.001, M.dark(), 0.012, 0.022, 0.0152));
  g.add(rbox(0.062, 0.022, 0.002, 0.001, A, 0.012, 0.022, 0.0172));
  g.add(rbox(0.012, 0.018, 0.012, 0.004, A, -0.022, 0.03, 0.017));
  const fa = new THREE.CylinderGeometry(0.0065, 0.0075, 0.03, 16); fa.rotateZ(-Math.PI / 2); fa.rotateY(0.35); fa.translate(-0.07, 0.026, 0.018); g.add(new THREE.Mesh(fa, A));
  // charging handle
  g.add(rbox(0.03, 0.008, 0.024, 0.002, A, -0.118, 0.042, 0));
  g.add(rbox(0.012, 0.009, 0.05, 0.003, A, -0.13, 0.042, 0));
}

export function buildGun(id: WeaponId): GunModel {
  const g = new THREE.Group() as GunModel;
  const S = M.steel(), A = M.anodized(), Pl = M.polymer(), B = M.blued();
  const add = (o: THREE.Object3D) => { g.add(o); return o; };
  let grip = new THREE.Vector3(-0.05, -0.07, 0), gripTilt = 0.32, fore = new THREE.Vector3(0.2, 0.02, 0), foreR = 0.028, sightY = 0.07, muzzle = new THREE.Vector3(0.36, 0.02, 0), pistol = false, stockX = -0.33;

  if (id === "m4a1") { // Colt M4A1: 838 mm stock extended, 14.5" (368 mm) barrel, EOTech holographic sight
    ar15Upper(g, A); ar15Lower(g, A, Pl);
    add(curvedMag([0.084, -0.02], 0.062, 0.19, 0.2, 0.023, A));
    // buffer tube and SOPMOD-style stock
    add(tubeX(-0.31, -0.108, 0.0148, 0.024, A, 24));
    add(prof([[-0.19, 0.046], [-0.33, 0.05], [-0.352, 0.044], [-0.358, 0.02], [-0.356, -0.082], [-0.336, -0.088], [-0.3, -0.05], [-0.26, -0.014], [-0.2, 0.004]], 0.04, Pl, 0.006, [[[-0.285, 0.03], [-0.22, 0.03], [-0.22, 0.012], [-0.262, 0.006]]]));
    add(rbox(0.014, 0.14, 0.042, 0.005, M.rubber(), -0.362, -0.016, 0));
    add(rbox(0.05, 0.018, 0.046, 0.006, Pl, -0.26, 0.052, 0)); // cheek riser
    // delta ring and quad-rail handguard
    add(tubeX(0.1, 0.112, 0.033, 0.022, A, 28));
    const hg = new THREE.CylinderGeometry(0.029, 0.029, 0.19, 8); hg.rotateZ(-Math.PI / 2); hg.rotateX(Math.PI / 8); hg.translate(0.207, 0.022, 0); add(new THREE.Mesh(hg, A)).castShadow = true;
    add(rail(0.11, 0.3, 0.051, A));
    for (const ang of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const r = rail(0.12, 0.29, 0, A, 0.019); r.rotation.x = ang; r.position.set(0, 0.022, 0); const wrap = new THREE.Group(); wrap.add(r); r.position.y = 0; r.children.forEach(c => { c.position.y += 0.029; }); wrap.rotation.x = ang; wrap.position.y = 0.022; add(wrap); }
    for (let x = 0.13; x < 0.29; x += 0.035) for (const s of [-1, 1]) add(rbox(0.024, 0.014, 0.004, 0.003, M.rubber(), x, 0.004, s * 0.026)); // rail covers
    // barrel, front sight base with A-frame post, birdcage flash hider
    add(tubeX(0.3, 0.44, 0.0092, 0.024, B, 20));
    add(prof([[0.33, 0.004], [0.356, 0.004], [0.356, 0.034], [0.35, 0.036], [0.349, 0.074], [0.337, 0.074], [0.336, 0.036], [0.33, 0.034]], 0.018, B, 0.0015, [[[0.3395, 0.042], [0.3465, 0.042], [0.3465, 0.066], [0.3395, 0.066]]]));
    add(bx(0.004, 0.012, 0.003, B, 0.343, 0.07, 0));
    add(tubeX(0.44, 0.49, 0.0112, 0.024, B, 16));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; add(bx(0.03, 0.003, 0.004, M.dark(), 0.468, 0.024 + Math.cos(a) * 0.0105, Math.sin(a) * 0.0105)).rotation.x = a; }
    const sight = holoSight(-0.02, 0.052); add(sight);
    add(engrave(["COLT FIREARMS  HARTFORD CONN USA", "M4A1 CARBINE   CAL 5.56 MM"], 0.075, 0.02, 0.035, -0.02, -0.0172, 20));
    add(engrave(["SAFE", "SEMI", "AUTO"], 0.018, 0.022, -0.052, -0.02, -0.0172, 26));
    pins(g, [[-0.075, -0.012], [0.05, -0.008], [-0.02, -0.024], [0.0, -0.024]], -0.0168, M.steel());
    grip.set(-0.046, -0.07, 0); fore.set(0.2, 0.022, 0); foreR = 0.033; sightY = sight.userData.lineY; muzzle.set(0.49, 0.024, 0); stockX = -0.36;
  } else if (id === "mp5") { // HK MP5A2: 680 mm, 225 mm barrel, 260 mm tall with magazine
    // stamped receiver: round-topped tube with side ribs
    add(prof([[-0.1, 0.0], [0.19, 0.0], [0.19, 0.036], ...qb([0.19, 0.036], [0.19, 0.058], [0.17, 0.058]), [-0.08, 0.058], ...qb([-0.08, 0.058], [-0.1, 0.058], [-0.1, 0.036])], 0.042, S, 0.004));
    for (const s of [-1, 1]) add(rbox(0.25, 0.006, 0.004, 0.002, S, 0.045, 0.03, s * 0.021));
    add(rbox(0.05, 0.016, 0.004, 0.001, M.dark(), 0.03, 0.03, 0.022)); // ejection port
    add(tubeX(0.08, 0.33, 0.012, 0.05, S, 20)); // cocking tube
    add(rbox(0.04, 0.012, 0.018, 0.003, S, 0.25, 0.042, 0));
    const ch = new THREE.CylinderGeometry(0.004, 0.004, 0.03, 10); ch.rotateX(Math.PI / 2); ch.rotateZ(0.5); ch.translate(0.258, 0.058, -0.022); add(new THREE.Mesh(ch, S));
    add(rbox(0.012, 0.012, 0.012, 0.004, Pl, 0.265, 0.065, -0.034));
    // drum rear sight and hooded front sight
    add(prof([[-0.098, 0.056], [-0.058, 0.056], [-0.06, 0.066], [-0.096, 0.066]], 0.03, S, 0.0015));
    const drum = new THREE.CylinderGeometry(0.016, 0.016, 0.024, 24); drum.rotateX(Math.PI / 2); drum.translate(-0.08, 0.08, 0); add(new THREE.Mesh(drum, S));
    add(prof([[0.31, 0.058], [0.335, 0.058], [0.33, 0.075], [0.316, 0.075]], 0.012, S, 0.001));
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.003, 8, 24), S); hood.position.set(0.326, 0.083, 0); hood.rotation.y = Math.PI / 2; add(hood);
    add(bx(0.003, 0.014, 0.002, S, 0.326, 0.078, 0));
    // slimline handguard with finger grooves
    const hgPts: P = [[0.105, -0.004], ...qb([0.105, -0.004], [0.2, -0.038], [0.29, -0.02], 8), [0.302, -0.006], [0.302, 0.032], [0.105, 0.034]];
    add(prof(hgPts, 0.05, Pl, 0.008));
    for (let x = 0.13; x < 0.28; x += 0.022) add(rbox(0.009, 0.004, 0.054, 0.0015, Pl, x, -0.016 - Math.sin((x - 0.105) / 0.19 * Math.PI) * 0.01, 0));
    add(tubeX(0.302, 0.36, 0.0085, 0.022, B, 18));
    for (let k = 0; k < 3; k++) add(bx(0.008, 0.004, 0.004, B, 0.35, 0.022 + Math.cos(k * 2.1) * 0.009, Math.sin(k * 2.1) * 0.009));
    // polymer trigger group with paddle and pistol grip
    add(prof([[-0.1, 0.0], [0.07, 0.0], [0.07, -0.014], [0.05, -0.02], [0.046, -0.052], [-0.03, -0.052], [-0.052, -0.03], [-0.1, -0.024]], 0.036, Pl, 0.003, [[[-0.022, -0.046], [0.036, -0.046], [0.04, -0.022], [-0.018, -0.022]]]));
    add(prof([[-0.05, -0.026], [-0.02, -0.03], [-0.035, -0.075], [-0.05, -0.12], [-0.086, -0.148], [-0.12, -0.14], [-0.098, -0.08], [-0.08, -0.026]], 0.034, M.grip(), 0.005));
    add(bx(0.004, 0.02, 0.006, S, 0.012, -0.034, 0));
    add(rbox(0.018, 0.012, 0.004, 0.003, S, -0.07, -0.012, -0.02)); // selector
    // steeply curved 30-round magazine
    add(curvedMag([0.1, -0.004], 0.03, 0.21, 0.55, 0.024, S));
    add(prof([[0.062, 0.0], [0.105, 0.0], [0.104, -0.018], [0.064, -0.018]], 0.034, S, 0.002)); // magwell
    // fixed A2 stock
    add(prof([[-0.1, 0.05], [-0.1, -0.02], [-0.16, -0.036], [-0.31, -0.07], [-0.33, -0.078], [-0.345, -0.07], [-0.345, 0.05], [-0.33, 0.058], [-0.12, 0.058]], 0.042, Pl, 0.006));
    add(rbox(0.016, 0.135, 0.046, 0.005, M.rubber(), -0.35, -0.008, 0));
    add(engrave(["MP5  Kal. 9mm x19", "HECKLER & KOCH GmbH"], 0.08, 0.018, 0.04, 0.014, -0.0215, 20));
    add(engrave(["S   E   F"], 0.03, 0.01, -0.07, -0.02, -0.0185, 26));
    pins(g, [[-0.085, -0.012], [0.03, -0.01], [-0.04, -0.01]], -0.0185, M.steel());
    grip.set(-0.058, -0.07, 0); gripTilt = 0.42; fore.set(0.2, 0.01, 0); foreR = 0.03; sightY = 0.083; muzzle.set(0.36, 0.022, 0); stockX = -0.355;
  } else if (id === "ak12") { // AK-12: 922 mm, 415 mm barrel
    add(prof([[-0.14, 0], [0.14, 0], [0.14, 0.052], [-0.1, 0.058], [-0.14, 0.05]], 0.04, S, 0.003));
    for (const s of [-1, 1]) add(rbox(0.26, 0.004, 0.003, 0.001, S, 0.0, 0.038, s * 0.0205));
    add(rbox(0.08, 0.014, 0.003, 0.001, M.dark(), 0.06, 0.036, 0.021)); // ejection port
    add(prof([[0.0, 0.03], [0.1, 0.03], [0.1, 0.042], [0.0, 0.042]], 0.004, S, 0.001, [], 0.023)); // safety lever
    add(rbox(0.01, 0.012, 0.024, 0.003, S, 0.1, 0.034, 0.03)); // charging handle
    add(rail(-0.13, 0.13, 0.061, S));
    add(prof([[0.14, -0.014], [0.34, -0.006], [0.35, 0.008], [0.35, 0.058], [0.14, 0.06]], 0.05, Pl, 0.006));
    for (let x = 0.16; x < 0.33; x += 0.03) for (const s of [-1, 1]) add(rbox(0.018, 0.012, 0.003, 0.002, M.dark(), x, 0.02, s * 0.025));
    add(rail(0.15, 0.345, 0.061, S));
    add(tubeX(0.35, 0.51, 0.0095, 0.024, B));
    add(tubeX(0.35, 0.41, 0.011, 0.05, S)); // gas tube
    add(prof([[0.4, 0.012], [0.42, 0.012], [0.42, 0.062], [0.4, 0.062]], 0.02, S, 0.002));
    add(prof([[0.5, 0.008], [0.57, 0.01], [0.57, 0.04], [0.5, 0.042]], 0.03, S, 0.004));
    for (let k = 0; k < 3; k++) add(bx(0.03, 0.02, 0.004, M.dark(), 0.54, 0.025, (k - 1) * 0.01)).position.y = 0.035;
    add(prof([[-0.06, -0.005], [-0.03, -0.005], [-0.046, -0.06], [-0.07, -0.122], [-0.104, -0.116], [-0.085, -0.005]], 0.03, M.grip(), 0.005));
    add(prof([[-0.035, -0.036], [0.04, -0.036], [0.04, -0.03], [-0.035, -0.03]], 0.02, S, 0.001));
    add(bx(0.004, 0.02, 0.006, S, 0.0, -0.02, 0));
    add(curvedMag([0.11, 0.0], 0.05, 0.2, 0.7, 0.028, Pl));
    add(prof([[-0.14, 0.05], [-0.3, 0.05], [-0.36, 0.045], [-0.37, 0.03], [-0.37, -0.075], [-0.34, -0.085], [-0.3, -0.03], [-0.14, -0.005]], 0.034, Pl, 0.005, [[[-0.29, 0.032], [-0.19, 0.034], [-0.19, 0.008], [-0.27, -0.012]]]));
    add(rbox(0.014, 0.12, 0.04, 0.004, M.rubber(), -0.375, -0.02, 0));
    const dot = redDot(0.0, 0.064); add(dot);
    add(engrave(["AK-12   5.45x39", "KALASHNIKOV  IZHEVSK"], 0.09, 0.02, -0.03, 0.02, -0.0205, 20));
    grip.set(-0.07, -0.065, 0); gripTilt = 0.3; fore.set(0.25, 0.024, 0); foreR = 0.03; sightY = dot.userData.lineY; muzzle.set(0.57, 0.025, 0); stockX = -0.375;
  } else if (id === "m870") { // Remington 870 with 18.5" barrel, synthetic furniture
    add(prof([[-0.08, -0.012], [0.13, -0.012], [0.13, 0.058], [-0.06, 0.062], ...qb([-0.06, 0.062], [-0.08, 0.062], [-0.08, 0.04])], 0.046, B, 0.004));
    add(rbox(0.07, 0.024, 0.003, 0.002, M.dark(), 0.03, 0.028, 0.0235));
    add(tubeX(0.13, 0.6, 0.0118, 0.044, B, 22));
    add(tubeX(0.13, 0.5, 0.0115, 0.012, B, 22));
    add(tubeX(0.5, 0.52, 0.014, 0.012, S, 20));
    add(prof([[0.49, 0.012], [0.51, 0.012], [0.51, 0.044], [0.49, 0.044]], 0.01, B, 0.001));
    const pump = new THREE.Group();
    pump.add(prof([[0.2, -0.014], [0.375, -0.014], [0.385, 0.0], [0.385, 0.032], [0.2, 0.036], [0.195, 0.01]], 0.056, Pl, 0.008));
    for (let x = 0.22; x < 0.37; x += 0.016) pump.add(rbox(0.006, 0.05, 0.06, 0.002, Pl, x, 0.01, 0));
    pump.name = "pump"; add(pump);
    add(prof([[-0.05, -0.012], [0.04, -0.012], [0.04, -0.03], [-0.03, -0.036]], 0.024, B, 0.002, [[[-0.02, -0.029], [0.03, -0.029], [0.03, -0.016], [-0.02, -0.016]]]));
    add(bx(0.004, 0.018, 0.006, S, 0.005, -0.022, 0));
    add(prof([[-0.08, 0.05], [-0.08, -0.012], [-0.1, -0.03], [-0.128, -0.1], [-0.156, -0.1], [-0.14, -0.04], [-0.4, -0.098], [-0.42, -0.094], [-0.42, 0.04], [-0.38, 0.05], [-0.12, 0.048]], 0.042, Pl, 0.005));
    add(rbox(0.018, 0.15, 0.044, 0.005, M.rubber(), -0.425, -0.03, 0));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), M.brass()); bead.position.set(0.59, 0.059, 0); add(bead);
    for (let k = 0; k < 4; k++) add(tubeX(-0.3 + k * 0.022, -0.3 + k * 0.022 + 0.018, 0.0105, -0.03, new THREE.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.5 }), 14, 0.024)); // side saddle shells
    grip.set(-0.12, -0.06, 0); gripTilt = 0.55; fore.set(0.29, 0.012, 0); foreR = 0.03; sightY = 0.062; muzzle.set(0.6, 0.044, 0); stockX = -0.425;
  } else if (id === "mk14") { // Mk 14 EBR chassis with a 3-9x scope
    const tan = M.tanPoly();
    add(prof([[-0.15, -0.012], [0.34, -0.012], [0.36, 0.01], [0.36, 0.062], [-0.15, 0.064]], 0.05, tan, 0.005));
    add(rail(-0.14, 0.35, 0.067, A));
    for (let x = -0.1; x < 0.34; x += 0.045) for (const s of [-1, 1]) add(rbox(0.03, 0.018, 0.003, 0.002, M.dark(), x, 0.026, s * 0.0255));
    add(tubeX(0.36, 0.6, 0.011, 0.028, B));
    add(prof([[0.58, 0.012], [0.64, 0.012], [0.64, 0.044], [0.58, 0.044]], 0.028, S, 0.004));
    for (let k = 0; k < 4; k++) add(bx(0.04, 0.02, 0.003, M.dark(), 0.61, 0.028, (k - 1.5) * 0.007));
    add(prof([[0.02, -0.012], [0.078, -0.012], [0.078, -0.13], [0.022, -0.13]], 0.03, S, 0.003));
    add(prof([[-0.06, -0.012], [-0.03, -0.012], [-0.044, -0.06], [-0.07, -0.12], [-0.104, -0.114], [-0.085, -0.012]], 0.03, M.grip(), 0.005));
    add(bx(0.004, 0.018, 0.006, S, -0.01, -0.024, 0));
    add(prof([[-0.15, 0.062], [-0.4, 0.06], [-0.42, 0.045], [-0.42, -0.085], [-0.39, -0.09], [-0.33, -0.04], [-0.15, -0.012]], 0.04, tan, 0.005, [[[-0.34, 0.03], [-0.2, 0.036], [-0.2, 0.012], [-0.32, -0.016]]]));
    add(rbox(0.016, 0.14, 0.044, 0.005, M.rubber(), -0.425, -0.02, 0));
    const sc = scope(-0.12, 0.22, 0.106); add(sc);
    grip.set(-0.075, -0.066, 0); gripTilt = 0.3; fore.set(0.24, 0.024, 0); foreR = 0.03; sightY = sc.userData.lineY; muzzle.set(0.64, 0.028, 0); stockX = -0.425;
  } else { // pistols: SIG P226 with suppressor, Glock 17
    pistol = true;
    const glock = id === "g17";
    const slide = glock ? M.polymer() : B;
    add(prof([[-0.095, 0.0], [0.092, 0.0], [0.097, 0.006], [0.097, 0.029], ...qb([0.097, 0.029], [0.096, 0.036], [0.088, 0.036]), [-0.088, 0.036], [-0.095, 0.03]], glock ? 0.026 : 0.028, slide, 0.003));
    for (let x = -0.085; x < -0.05; x += 0.0055) for (const s of [-1, 1]) add(bx(0.0022, 0.024, 0.0015, M.dark(), x, 0.018, s * (glock ? 0.0132 : 0.0142)));
    add(rbox(0.036, 0.013, 0.002, 0.001, M.dark(), 0.0, 0.028, glock ? 0.013 : 0.014)); // ejection port
    add(prof([[-0.075, 0.0], [0.08, 0.0], [0.08, -0.016], [0.028, -0.018], [0.022, -0.036], [-0.02, -0.036], [-0.036, -0.02], [-0.075, -0.015]], 0.027, glock ? Pl : A, 0.002,
      [[[-0.012, -0.031], [0.017, -0.031], [0.019, -0.018], [-0.012, -0.018]]]));
    add(prof([[-0.076, -0.012], [-0.036, -0.014], [-0.048, -0.06], [-0.056, -0.118], [-0.1, -0.113], [-0.092, -0.06], [-0.09, -0.02]], 0.031, M.grip(), 0.005));
    add(bx(0.004, 0.013, 0.004, S, 0.004, -0.025, 0));
    add(rbox(0.008, 0.007, 0.013, 0.001, S, -0.086, 0.04, 0));
    add(rbox(0.005, 0.007, 0.004, 0.001, S, 0.084, 0.04, 0));
    if (!glock) {
      add(prof([[-0.06, -0.003], [-0.03, -0.004], [-0.03, 0.004], [-0.06, 0.004]], 0.004, S, 0.001, [], -0.016)); // decocker
      add(tubeX(0.097, 0.27, 0.0165, 0.018, A, 28)); add(tubeX(0.093, 0.1, 0.012, 0.018, S));
      for (let x = 0.12; x < 0.26; x += 0.035) add(tubeX(x, x + 0.003, 0.0168, 0.018, M.dark(), 28));
    }
    grip.set(-0.072, -0.06, 0); gripTilt = 0.22; fore.set(-0.07, -0.07, 0); sightY = 0.044; muzzle.set(glock ? 0.097 : 0.27, 0.018, 0); stockX = -0.1;
  }
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { grip, gripTilt, fore, foreR, sightY, muzzle, pistol, stockX };
  return g;
}

// ------------------------------------------------------------------------------------------ hands
/** capsule between two points */
function seg(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, r2 = r): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = r2 === r ? new THREE.CapsuleGeometry(r, Math.max(1e-3, len), 5, 12) : new THREE.CylinderGeometry(r2, r, Math.max(1e-3, len), 14, 1, false);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  return mesh;
}
const FINGER_LEN = [[0.046, 0.027, 0.022], [0.05, 0.031, 0.024], [0.047, 0.029, 0.023], [0.037, 0.022, 0.02]];
const FINGER_R = [0.0098, 0.0102, 0.0098, 0.0088];

/**
 * A gloved hand gripping a cylinder of radius `objR` whose axis is local +Y, through the origin.
 * Angles are measured in the local XZ plane from +X toward +Z. Fingers start at `knuckle` and wrap
 * (increasing angle if dir=1). The palm sits over [palmFrom, knuckle]. `index` "trigger" keeps the index finger straight.
 */
export function wrapHand(o: { objR: number; knuckle: number; palmFrom: number; dir: 1 | -1; ys: number[]; index?: "trigger" | "wrap"; thumb?: THREE.Vector3[]; wristDir: THREE.Vector3 }): THREE.Group {
  const h = new THREE.Group(), G = M.glove(), K = M.gloveKnuckle();
  const R = o.objR + 0.0105;
  const at = (th: number, y: number, r = R) => new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
  o.ys.forEach((y, i) => {
    let th = o.knuckle;
    let p = at(th, y, R + 0.006);
    const lens = FINGER_LEN[i];
    if (i === 0 && o.index === "trigger") {
      // index finger laid straight along the frame (trigger discipline), slightly bent
      const k0 = p.clone(), k1 = k0.clone().add(new THREE.Vector3(0.045, 0.004, 0.004)), k2 = k1.clone().add(new THREE.Vector3(0.028, -0.002, -0.004)), k3 = k2.clone().add(new THREE.Vector3(0.02, -0.004, -0.008));
      h.add(seg(k0, k1, FINGER_R[0], G), seg(k1, k2, FINGER_R[0] * 0.95, G), seg(k2, k3, FINGER_R[0] * 0.9, G));
      h.add(rbox(0.02, 0.012, 0.01, 0.004, K, (k0.x + k1.x) / 2, (k0.y + k1.y) / 2 + 0.004, (k0.z + k1.z) / 2 + 0.005));
      return;
    }
    for (let k = 0; k < 3; k++) {
      const L = lens[k], dth = 2 * Math.asin(Math.min(0.99, L / (2 * R))) * o.dir;
      th += dth;
      const q = at(th, y - k * 0.001, R - k * 0.0012);
      h.add(seg(p, q, FINGER_R[i] * (1 - k * 0.06), G));
      if (k === 0) h.add(rbox(0.018, 0.012, 0.011, 0.004, K, (p.x + q.x) / 2 * 1.08, y + 0.001, (p.z + q.z) / 2 * 1.08)); // knuckle pad
      p = q;
    }
  });
  // palm: a rounded slab tangent to the object between palmFrom and the knuckles, plus the back of the hand
  const mid = (o.palmFrom + o.knuckle) / 2, span = Math.abs(o.knuckle - o.palmFrom) * (R + 0.012);
  const top = Math.max(...o.ys) + 0.012, bot = Math.min(...o.ys) - 0.012;
  const palm = rbox(Math.max(0.05, span), top - bot, 0.03, 0.012, G);
  palm.position.copy(at(mid, (top + bot) / 2, R + 0.012)); palm.rotation.y = Math.PI / 2 - mid; h.add(palm);
  const back = rbox(Math.max(0.045, span * 0.9), (top - bot) * 0.92, 0.012, 0.006, K);
  back.position.copy(at(mid, (top + bot) / 2, R + 0.026)); back.rotation.y = Math.PI / 2 - mid; h.add(back);
  // thumb
  if (o.thumb) for (let k = 0; k < o.thumb.length - 1; k++) h.add(seg(o.thumb[k], o.thumb[k + 1], 0.0112 - k * 0.0008, G));
  // cuff: glove gauntlet heading toward the forearm
  const wrist = at(o.palmFrom + (o.knuckle - o.palmFrom) * 0.35, bot + 0.004, R + 0.02);
  h.add(seg(wrist, wrist.clone().addScaledVector(o.wristDir, 0.06), 0.034, K, 0.037));
  h.userData.wrist = wrist.clone().addScaledVector(o.wristDir, 0.06);
  return h;
}

/** right hand on a pistol grip. Returns the hand and the wrist position, both in gun space. */
export function gripHand(gun: GunModel): { hand: THREE.Group; wrist: THREE.Vector3 } {
  const u = gun.userData;
  const h = wrapHand({
    objR: 0.018, knuckle: 0.95, palmFrom: Math.PI * 0.98, dir: -1, ys: [0.03, 0.006, -0.018, -0.04], index: "trigger",
    thumb: [new THREE.Vector3(-0.03, 0.05, 0.0), new THREE.Vector3(-0.012, 0.062, -0.02), new THREE.Vector3(0.018, 0.066, -0.026), new THREE.Vector3(0.042, 0.066, -0.026)],
    wristDir: new THREE.Vector3(-0.85, -0.45, 0.25).normalize(),
  });
  h.position.copy(u.grip); h.rotation.z = u.gripTilt;
  h.updateMatrix();
  const wrist = (h.userData.wrist as THREE.Vector3).clone().applyMatrix4(h.matrix);
  return { hand: h, wrist };
}
/** left hand cradling the handguard (C-clamp-ish: palm under, fingers up the far side, thumb along the near side) */
export function supportHand(gun: GunModel): { hand: THREE.Group; wrist: THREE.Vector3 } {
  const u = gun.userData;
  const h = wrapHand({
    objR: u.foreR, knuckle: -2.15, palmFrom: -Math.PI + 0.05, dir: 1, ys: [0.028, 0.006, -0.016, -0.036],
    thumb: [new THREE.Vector3(-0.02, 0.028, u.foreR * 0.2 + 0.02), new THREE.Vector3(0.008, 0.042, u.foreR + 0.012), new THREE.Vector3(0.012, 0.075, u.foreR + 0.008), new THREE.Vector3(0.006, 0.098, u.foreR + 0.004)],
    wristDir: new THREE.Vector3(-0.8, -0.2, 0.55).normalize(),
  });
  // local Y -> gun +x (along the barrel), local X -> gun +y (up), local Z -> gun -z (the shooter's side)
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
  h.quaternion.setFromRotationMatrix(basis);
  h.position.copy(u.fore);
  h.updateMatrix();
  const wrist = (h.userData.wrist as THREE.Vector3).clone().applyMatrix4(h.matrix);
  return { hand: h, wrist };
}
/** kept for gadget viewmodels: a loosely closed hand */
export function buildHand(side: 1 | -1, curl = 1): THREE.Group {
  const h = wrapHand({ objR: 0.02 * curl, knuckle: 0.9, palmFrom: Math.PI, dir: -1, ys: [0.03, 0.008, -0.014, -0.034], wristDir: new THREE.Vector3(-1, -0.3, 0).normalize() });
  if (side < 0) h.scale.z = -1;
  return h;
}

// ------------------------------------------------------------------------------------------ soldiers
export type SoldierKind = "guard" | "contractor" | "chief" | "hostage";
interface Arm { shoulder: THREE.Vector3; upper: THREE.Mesh; elbow: THREE.Mesh; fore: THREE.Mesh; fist: THREE.Object3D; pole: THREE.Vector3 }
export interface Soldier extends THREE.Group {
  userData: { legs: THREE.Object3D[]; knees: THREE.Object3D[]; torso: THREE.Object3D; head: THREE.Object3D; gun: GunModel | null; arms: Arm[]; kind: SoldierKind; aimT: number };
}

function isChild(parent: THREE.Object3D, o: THREE.Object3D): boolean { let p: THREE.Object3D | null = o; while (p) { if (p === parent) return true; p = p.parent; } return false; }
function lathe(profile: [number, number][], seg = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** two-bone IK: returns the elbow position */
function solveElbow(s: THREE.Vector3, h: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = h.clone().sub(s); const len = Math.min(d.length(), a + b - 1e-3); d.normalize();
  const x = (a * a - b * b + len * len) / (2 * len), y = Math.sqrt(Math.max(0, a * a - x * x));
  const pn = pole.clone().sub(s); pn.sub(d.clone().multiplyScalar(pn.dot(d))).normalize();
  return s.clone().addScaledVector(d, x).addScaledVector(pn, y);
}
function placeSeg(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const len = a.distanceTo(b); m.scale.set(1, len / (m.userData.len as number), 1);
}

const rimmed = new WeakSet<THREE.Material>();
/** fresnel rim so figures separate from busy backgrounds, as in the reference's character lighting */
export function addRim(m: THREE.Material) {
  if (rimmed.has(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  rimmed.add(m);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal) * -1.0 + 0.0, 0.0, 1.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * fr * 0.8 + vec3(0.02, 0.018, 0.015) * fr; }");
  };
  m.customProgramCacheKey = () => "rim";
  m.needsUpdate = true;
}

export function buildSoldier(kind: SoldierKind): Soldier {
  const s = new THREE.Group() as Soldier;
  const uniform = kind === "contractor" ? fabric("u-multi", MULTICAM, 4)
    : kind === "hostage" ? mat("u-host", () => new THREE.MeshStandardMaterial({ color: 0xbdb5a4, roughness: 0.95 }))
    : kind === "chief" ? fabric("u-olive", ["#59603f", "#4a5033", "#666d4b", "#3e432b", "#535a3b"], 4)
    : fabric("u-guard", ["#3c4a5a", "#34414f", "#43525f", "#2e3945", "#3a4755"], 4); // navy border-police fatigues
  const vestCol = kind === "contractor" ? "#8e7c5a" : kind === "chief" ? "#4d5238" : "#26292d";
  const vestMat = mat("vest-" + vestCol, () => { const t = molle(vestCol); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9 }); });
  const pouchMat = kind === "contractor" ? fabric("p-cb", ["#8e7c5a", "#86744f", "#958360"], 1) : kind === "chief" ? fabric("p-ol", ["#4a4f37", "#43482f", "#50553c"], 1) : fabric("p-bk", ["#24272b", "#202326", "#282b2f"], 1);
  const shirt = kind === "contractor" ? fabric("shirt-tan", ["#a8966f", "#a08e68", "#b09e78"], 2) : uniform;
  const boot = mat("boot" + kind, () => new THREE.MeshStandardMaterial({ color: kind === "contractor" ? 0x7c6a4e : 0x1e1c1a, roughness: 0.7 }));
  const skin = mat("skin" + kind, () => new THREE.MeshStandardMaterial({ color: kind === "chief" ? 0x7a5440 : kind === "guard" ? 0xa87b5f : 0x8f6650, roughness: 0.55 }));
  const legs: THREE.Object3D[] = [], knees: THREE.Object3D[] = [];
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, y: number) => { const g = new THREE.CylinderGeometry(rt, rb, h, 16); g.translate(0, y, 0); const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; return mesh; };
  const sph = (r: number, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; return mesh; };
  // legs: hip joint at 0.93, knee 0.5, ankle 0.09
  for (const side of [1, -1]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.93, 0.105 * side);
    hip.add(sph(0.092, uniform, 0, -0.02, 0, 1, 1, 1));
    hip.add(cyl(0.092, 0.066, 0.4, uniform, -0.21));
    if (kind !== "hostage") { const pocket = rbox(0.1, 0.13, 0.04, 0.012, uniform, 0.0, -0.2, 0.068 * side); hip.add(pocket); }
    const knee = new THREE.Group(); knee.position.y = -0.43; hip.add(knee);
    knee.add(sph(0.064, uniform));
    if (kind !== "hostage") knee.add(rbox(0.05, 0.1, 0.09, 0.02, M.polymer(), 0.05, -0.02, 0));
    knee.add(cyl(0.064, 0.05, 0.37, uniform, -0.2));
    // boot: shaft + foot + sole + toe
    knee.add(cyl(0.056, 0.058, 0.16, boot, -0.36));
    knee.add(rbox(0.25, 0.085, 0.11, 0.035, boot, 0.05, -0.425, 0));
    knee.add(rbox(0.27, 0.025, 0.115, 0.01, M.rubber(), 0.05, -0.465, 0));
    s.add(hip); legs.push(hip); knees.push(knee);
  }
  // (holster is attached to the right thigh after the torso is built)
  // torso pivot at the waist so the upper body can lean into an aim
  const torso = new THREE.Group(); torso.position.y = 1.0; s.add(torso);
  s.add(rbox(0.25, 0.22, 0.4, 0.08, uniform, 0, 0.96, 0)); // pelvis
  if (kind !== "hostage") s.add(rbox(0.26, 0.05, 0.39, 0.02, M.polymer(), 0, 1.03, 0)); // belt
  const chest = new THREE.Mesh(lathe([[0.13, 0], [0.15, 0.08], [0.17, 0.2], [0.18, 0.32], [0.16, 0.42], [0.1, 0.48], [0.05, 0.5]]), shirt);
  chest.scale.set(0.72, 1, 1.18); chest.castShadow = true; torso.add(chest);
  // shoulders (deltoids)
  for (const z of [0.2, -0.2]) torso.add(sph(0.065, uniform, 0, 0.43, z, 1, 0.9, 1));
  if (kind !== "hostage") {
    // combat shirt collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 16, 1, true), shirt); collar.position.y = 0.5; collar.scale.set(0.9, 1, 1.1); torso.add(collar);
    // plate carrier: front and back plates with webbing, cummerbund, shoulder straps
    torso.add(rbox(0.06, 0.34, 0.31, 0.02, vestMat, 0.15, 0.25, 0));
    torso.add(rbox(0.055, 0.35, 0.31, 0.02, vestMat, -0.145, 0.26, 0));
    const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.18, 0.17, 22, 1, true), vestMat); cb.scale.set(0.82, 1, 1.2); cb.position.y = 0.16; torso.add(cb);
    for (const z of [0.105, -0.105]) { const st = rbox(0.32, 0.03, 0.055, 0.012, vestMat, 0.0, 0.445, z); torso.add(st); torso.add(rbox(0.06, 0.1, 0.06, 0.02, pouchMat, 0.02, 0.44, z * 1.9)); }
    // triple mag pouches with flaps and bungee tabs, admin pouch, radio, IFAK
    for (let i = -1; i <= 1; i++) {
      torso.add(rbox(0.055, 0.13, 0.085, 0.012, pouchMat, 0.205, 0.19, i * 0.094));
      torso.add(rbox(0.06, 0.03, 0.09, 0.008, pouchMat, 0.21, 0.26, i * 0.094));
      torso.add(rbox(0.008, 0.02, 0.02, 0.003, M.polymer(), 0.24, 0.255, i * 0.094));
    }
    torso.add(rbox(0.035, 0.1, 0.15, 0.01, pouchMat, 0.195, 0.345, 0));
    torso.add(rbox(0.055, 0.14, 0.065, 0.012, M.polymer(), -0.02, 0.26, -0.215));
    const ant = cyl(0.003, 0.004, 0.32, M.polymer(), 0.46); ant.position.set(-0.03, 0, -0.215); torso.add(ant);
    torso.add(rbox(0.08, 0.1, 0.06, 0.015, mat("ifak", () => new THREE.MeshStandardMaterial({ color: 0x7a1f1a, roughness: 0.85 })), -0.02, 0.15, 0.225));
    // back: assault pack (contractor) or hydration carrier
    if (kind === "contractor") { torso.add(rbox(0.16, 0.36, 0.3, 0.05, pouchMat, -0.25, 0.25, 0)); torso.add(rbox(0.06, 0.2, 0.22, 0.03, pouchMat, -0.34, 0.2, 0)); }
    else torso.add(rbox(0.06, 0.3, 0.2, 0.03, pouchMat, -0.2, 0.27, 0));
    if (kind === "guard") { const patch = rbox(0.004, 0.05, 0.13, 0.002, mat("patch", () => new THREE.MeshStandardMaterial({ color: 0xd8d3c4, roughness: 0.8 })), 0.183, 0.4, 0); torso.add(patch); }
    // pistol in a drop-leg holster on the right thigh
    const hol = rbox(0.05, 0.19, 0.06, 0.015, M.polymer(), 0.01, -0.15, 0.085); hol.rotation.z = 0.08; (s as unknown as { userData_hol?: THREE.Object3D }).userData_hol = hol;
  }
  // neck and head
  const head = new THREE.Group(); head.position.set(0.01, 0.64, 0); torso.add(head);
  head.add(cyl(0.05, 0.055, 0.1, skin, -0.1));
  const skull = sph(0.1, skin, 0, 0.01, 0, 0.98, 1.16, 0.88); head.add(skull);
  head.add(rbox(0.1, 0.07, 0.13, 0.03, skin, 0.03, -0.06, 0)); // jaw
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 4), skin); nose.rotation.z = -Math.PI / 2 - 0.25; nose.rotation.x = Math.PI / 4; nose.position.set(0.1, -0.005, 0); nose.scale.set(1, 1, 0.7); head.add(nose);
  for (const z of [0.035, -0.035]) {
    head.add(sph(0.016, mat("eyeS", () => new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.4 })), 0.084, 0.025, z, 0.5, 0.6, 1));
    head.add(rbox(0.012, 0.01, 0.034, 0.004, skin, 0.092, 0.042, z)); // brow
    head.add(sph(0.022, skin, -0.005, 0.005, z * 2.55, 0.6, 1, 0.45)); // ears
  }
  if (kind === "contractor") {
    // FAST-style helmet with cover, rails, NVG shroud, counterweight; comms headset; shooting glasses; shemagh
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.128, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), fabric("helm", MULTICAM, 1)); helm.position.y = 0.03; helm.scale.set(1.05, 1, 0.98); helm.castShadow = true; head.add(helm);
    for (const z of [1, -1]) head.add(rbox(0.12, 0.022, 0.012, 0.004, M.polymer(), -0.005, 0.02, 0.126 * z));
    head.add(rbox(0.035, 0.03, 0.05, 0.008, M.polymer(), 0.122, 0.085, 0));
    head.add(rbox(0.06, 0.05, 0.08, 0.01, vestMat, -0.13, 0.03, 0));
    for (const z of [1, -1]) { const cup = cyl(0.042, 0.042, 0.04, M.polymer(), 0); cup.rotation.x = Math.PI / 2; cup.position.set(-0.005, -0.005, 0.105 * z); head.add(cup); }
    head.add(rbox(0.02, 0.028, 0.19, 0.01, M.lens(), 0.095, 0.022, 0));
    head.add(rbox(0.11, 0.07, 0.19, 0.03, fabric("shemagh", ["#c9bb9a", "#b8a988", "#d6c9aa"], 3), 0.035, -0.07, 0));
  } else if (kind === "guard") {
    const capM = mat("cap", () => new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.85 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.108, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capM); cap.position.y = 0.035; cap.scale.set(1.05, 0.8, 0.95); head.add(cap);
    const brim = rbox(0.08, 0.01, 0.15, 0.004, capM, 0.1, 0.04, 0); brim.rotation.z = -0.12; head.add(brim);
    head.add(rbox(0.004, 0.025, 0.035, 0.002, M.brass(), 0.104, 0.07, 0));
    head.add(rbox(0.018, 0.026, 0.19, 0.009, M.lens(), 0.094, 0.024, 0)); // wraparound sunglasses
    head.add(rbox(0.07, 0.06, 0.13, 0.025, mat("beard", () => new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 1 })), 0.05, -0.075, 0)); // short beard
  } else if (kind === "chief") {
    const beret = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), mat("beret", () => new THREE.MeshStandardMaterial({ color: 0x5a1a18, roughness: 0.95 }))); beret.position.set(-0.01, 0.06, 0.02); beret.rotation.x = 0.25; beret.scale.set(1.1, 0.7, 1.1); head.add(beret);
    head.add(rbox(0.06, 0.018, 0.1, 0.008, mat("mous", () => new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 0.9 })), 0.098, -0.04, 0));
  } else {
    head.add(sph(0.104, mat("hair", () => new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 })), -0.01, 0.04, 0, 1, 0.95, 0.92));
  }
  const hol = (s as unknown as { userData_hol?: THREE.Object3D }).userData_hol; if (hol) legs[0].add(hol);
  // arms: segments are rebuilt by IK each pose
  const arms: Arm[] = [];
  for (const side of [1, -1]) {
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 1, 14), uniform); up.userData.len = 1; up.castShadow = true;
    const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 1, 14), uniform); fo.userData.len = 1; fo.castShadow = true;
    const el = sph(0.047, uniform); if (kind !== "hostage") { const pad = rbox(0.06, 0.07, 0.07, 0.02, M.polymer(), -0.03, 0, 0); el.add(pad); }
    const fist = new THREE.Group(); fist.add(rbox(0.09, 0.05, 0.09, 0.022, M.glove(), 0.02, 0, 0)); fist.add(rbox(0.04, 0.035, 0.05, 0.012, M.glove(), -0.035, 0, 0));
    torso.add(up, fo, el, fist);
    arms.push({ shoulder: new THREE.Vector3(0.0, 0.42, 0.2 * side), upper: up, elbow: el, fore: fo, fist, pole: new THREE.Vector3(-0.3, -0.2, 0.55 * side) });
  }
  let gun: GunModel | null = null;
  if (kind !== "hostage") { gun = buildGun(kind === "contractor" ? "m4a1" : kind === "chief" ? "ak12" : "mp5"); torso.add(gun); }
  s.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (!(gun && isChild(gun, m))) addRim(m.material as THREE.Material); } });
  s.userData = { legs, knees, torso, head, gun, arms, kind, aimT: 0 };
  poseSoldier(s, 0, 0, false);
  return s;
}

/** walk cycle + weapon carry. `aim` blends from low ready to shouldered. */
const a0 = (u: Soldier["userData"]) => u.aimT;
export function poseSoldier(s: Soldier, phase: number, amount: number, aiming: boolean, dt = 1) {
  const u = s.userData;
  const [l, r] = u.legs, [kl, kr] = u.knees;
  l.rotation.z = Math.sin(phase) * 0.45 * amount; r.rotation.z = -Math.sin(phase) * 0.45 * amount;
  kl.rotation.z = -Math.max(0, Math.sin(phase - 1.1)) * 0.75 * amount; kr.rotation.z = -Math.max(0, Math.sin(phase - 1.1 + Math.PI)) * 0.75 * amount;
  u.aimT += ((aiming ? 1 : 0) - u.aimT) * Math.min(1, dt * 6);
  const a = u.aimT;
  const now = performance.now() / 1000 + (s.id % 7);
  u.torso.position.y = 1.0 + Math.abs(Math.cos(phase)) * 0.02 * amount + Math.sin(now * 1.6) * 0.006 * (1 - amount);
  u.head.rotation.y = Math.sin(now * 0.37) * 0.25 * (1 - amount) * (1 - a0(u));
  u.torso.rotation.z = -0.04 - a * 0.06; // lean into the gun a little
  u.torso.rotation.y = a * 0.12;
  const gun = u.gun;
  if (!gun) {
    // hostage: hands bound behind the back
    for (const [i, arm] of u.arms.entries()) { const hnd = new THREE.Vector3(-0.2, 0.08, (i ? -1 : 1) * 0.06); const e = solveElbow(arm.shoulder, hnd, 0.29, 0.27, new THREE.Vector3(-0.2, 0.3, arm.shoulder.z * 2)); placeSeg(arm.upper, arm.shoulder, e); placeSeg(arm.fore, e, hnd); arm.elbow.position.copy(e); arm.fist.position.copy(hnd); }
    return;
  }
  // gun transform in torso space: low ready (muzzle down) -> shouldered at eye line
  const low = { p: new THREE.Vector3(0.3, 0.25, 0.1), rz: -0.55, ry: 0.15 };
  const hi = { p: new THREE.Vector3(0.28 - gun.userData.stockX * 0.35, 0.52, 0.13), rz: 0.0, ry: 0.05 };
  gun.position.lerpVectors(low.p, hi.p, a);
  gun.rotation.set(0, low.ry + (hi.ry - low.ry) * a, low.rz + (hi.rz - low.rz) * a);
  gun.updateMatrix();
  const handR = gun.userData.grip.clone().add(new THREE.Vector3(-0.01, 0.0, 0)).applyMatrix4(gun.matrix);
  const handL = (gun.userData.pistol ? gun.userData.grip.clone().add(new THREE.Vector3(0.0, -0.02, -0.03)) : gun.userData.fore.clone().add(new THREE.Vector3(0, -0.03, 0))).applyMatrix4(gun.matrix);
  [handR, handL].forEach((hnd, i) => {
    const arm = u.arms[i];
    const e = solveElbow(arm.shoulder, hnd, 0.29, 0.27, arm.shoulder.clone().add(arm.pole));
    placeSeg(arm.upper, arm.shoulder, e); placeSeg(arm.fore, e, hnd);
    arm.elbow.position.copy(e);
    arm.fist.position.copy(hnd); arm.fist.quaternion.copy(gun.quaternion);
  });
}


// ------------------------------------------------------------------------------------------ set dressing
/** shared wind clock for foliage */
export const WIND = { value: 0 };
function windy<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind;").replace("#include <begin_vertex>", `#include <begin_vertex>
      { vec4 wp = modelMatrix * vec4(position, 1.0); float tip = clamp(position.x / 2.6, 0.0, 1.0);
        transformed.z += sin(uWind * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.09 * tip * tip + sin(uWind * 4.3 + wp.x) * 0.02 * tip; }`);
  };
  m.customProgramCacheKey = () => "windy";
  return m;
}
export function palmTree(h = 7, seed = 1): THREE.Group {
  const g = new THREE.Group();
  const r = (i: number) => { const x = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const bend = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2 * (r(1) - 0.5), h * 0.35, 0.2 * (r(2) - 0.5)), new THREE.Vector3(0.6 * (r(3) - 0.5), h * 0.7, 0.5 * (r(4) - 0.5)), new THREE.Vector3(0.9 * (r(5) - 0.5), h, 0.7 * (r(6) - 0.5))]);
  const barkTex = (() => { const c = document.createElement("canvas"); c.width = 64; c.height = 256; const x = c.getContext("2d")!; x.fillStyle = "#6e5a44"; x.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 10) { x.fillStyle = "#4e3f30"; x.beginPath(); x.moveTo(0, y); x.lineTo(64, y + 4); x.lineTo(64, y + 7); x.lineTo(0, y + 3); x.fill(); x.fillStyle = "#8a7458"; x.fillRect(0, y + 5, 64, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, h * 1.4); return t; })();
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(bend, 24, 0.17, 10), new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 }));
  trunk.castShadow = true; trunk.receiveShadow = true; g.add(trunk);
  const top = bend.getPoint(1);
  const leafTex = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 64; const x = c.getContext("2d")!;
    x.strokeStyle = "#3a4a1c"; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 32); x.lineTo(256, 32); x.stroke();
    for (let i = 4; i < 250; i += 6) { const len = 28 * Math.sin((i / 256) * Math.PI) + 4; x.strokeStyle = i % 12 ? "#4d6a24" : "#5f7c2c"; x.lineWidth = 3; x.beginPath(); x.moveTo(i, 32); x.lineTo(i + 10, 32 - len); x.stroke(); x.beginPath(); x.moveTo(i, 32); x.lineTo(i + 10, 32 + len); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const leafMat = windy(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, alphaToCoverage: true, transparent: false, side: THREE.DoubleSide, roughness: 0.7 }));
  const deadMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, color: 0xb08850 });
  const frond = (len: number, droop: number, m: THREE.Material, yaw: number, tilt: number) => {
    const geo = new THREE.PlaneGeometry(len, 0.75, 14, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k) + len / 2, t = x / len; pos.setX(k, x); pos.setZ(k, -droop * t * t * len * 0.5); pos.setY(k, pos.getY(k) * (1 - t * 0.55) + Math.abs(pos.getY(k)) * 0.35); }
    geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, m); mm.castShadow = true;
    const holder = new THREE.Group(); holder.position.copy(top); holder.rotation.y = yaw;
    mm.rotation.x = Math.PI / 2; mm.rotation.y = -tilt; holder.add(mm); g.add(holder);
  };
  for (let i = 0; i < 20; i++) frond(2.4 + r(i + 40) * 0.8, 0.45 + r(i + 20) * 0.5, leafMat, (i / 20) * Math.PI * 2 + r(i) * 0.4, -0.35 + (i % 3) * 0.25 + r(i + 7) * 0.2);
  for (let i = 0; i < 6; i++) frond(2.0, 1.4, deadMat, (i / 6) * Math.PI * 2 + 0.3, 0.9);
  // boots of old frond stems on the trunk top
  for (let i = 0; i < 10; i++) { const st = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 5), new THREE.MeshStandardMaterial({ color: 0x6a553c, roughness: 1 })); const a = (i / 10) * Math.PI * 2; st.position.copy(top).add(new THREE.Vector3(Math.cos(a) * 0.14, -0.35 - (i % 3) * 0.12, Math.sin(a) * 0.14)); st.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(st); }
  for (let i = 0; i < 5; i++) { const nut = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6a4a20, roughness: 0.8 })); nut.position.copy(top).add(new THREE.Vector3(Math.cos(i) * 0.15, -0.15, Math.sin(i) * 0.15)); g.add(nut); }
  return g;
}

export function sandbagRow(len: number, rows = 3): THREE.Group {
  const g = new THREE.Group();
  const tex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!; x.fillStyle = "#b39a70"; x.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 3) { x.fillStyle = `rgba(80,60,40,${0.1 + Math.random() * 0.1})`; x.fillRect(0, y, 128, 1); } for (let xx = 0; xx < 128; xx += 3) { x.fillStyle = "rgba(255,240,210,0.07)"; x.fillRect(xx, 0, 1, 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const m = mat("sandbag", () => new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  for (let row = 0; row < rows; row++) {
    const n = Math.floor(len / 0.62);
    for (let i = 0; i < n; i++) {
      const b = rbox(0.6, 0.16, 0.34, 0.07, m, -len / 2 + 0.31 + i * 0.62 + (row % 2) * 0.3, 0.08 + row * 0.15, 0);
      b.rotation.y = (Math.random() - 0.5) * 0.1; b.scale.set(1, 1 + (Math.random() - 0.5) * 0.15, 1); g.add(b);
    }
  }
  return g;
}

export function jerseyBarrier(len = 3): THREE.Group {
  const g = new THREE.Group();
  const shape = shapeOf([[-0.3, 0], [0.3, 0], [0.27, 0.08], [0.1, 0.33], [0.08, 0.81], [-0.08, 0.81], [-0.1, 0.33], [-0.27, 0.08]]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2);
  const scanSet = getAssets()?.tex.concrete;
  const m = new THREE.Mesh(geo, mat("concrete", () => { const t = scanSet ?? concrete(); const mm = new THREE.MeshStandardMaterial({ map: t.map.clone(), normalMap: t.normalMap.clone(), roughness: 0.95 }); for (const tx of [mm.map!, mm.normalMap!]) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(0.7, 0.7); tx.needsUpdate = true; } return mm; })); m.castShadow = true; m.receiveShadow = true; g.add(m);
  for (let z = -len / 2 + 0.25; z < len / 2; z += 0.5) { const s = rbox(0.21, 0.16, 0.24, 0.01, new THREE.MeshStandardMaterial({ color: (Math.round(z * 2) % 2) ? 0xc2322a : 0xf0ece4, roughness: 0.7 }), 0, 0.6, z); s.scale.x = 0.9; g.add(s); }
  g.rotation.y = Math.PI / 2;
  const w = new THREE.Group(); w.add(g); return w;
}

export function razorWire(len: number): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  for (let t = 0; t <= len * 14; t++) { const a = t * 0.9; pts.push(new THREE.Vector3(t / 14, Math.sin(a) * 0.3 + 0.3, Math.cos(a) * 0.3)); }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.floor(len * 60), 0.006, 4);
  const m = new THREE.Mesh(geo, mat("wire", () => new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.9, roughness: 0.35 }))); m.castShadow = true;
  return m;
}

export function dome(r: number, color = 0xc89060): THREE.Group {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 1.02, r * 0.55, 40), new THREE.MeshStandardMaterial({ color: 0xd6a574, roughness: 0.9 }));
  drum.position.y = r * 0.27; drum.castShadow = true; g.add(drum);
  // ribbed dome
  const pts: THREE.Vector2[] = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r * (1 - 0.06 * Math.sin(a * 2)), Math.sin(a) * r * 1.15)); }
  const lathe = new THREE.LatheGeometry(pts, 48);
  const pos = lathe.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), z = pos.getZ(k), ang = Math.atan2(z, x); const rib = 1 + 0.018 * Math.cos(ang * 24); pos.setX(k, x * rib); pos.setZ(k, z * rib); }
  lathe.computeVertexNormals();
  const d = new THREE.Mesh(lathe, new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 })); d.position.y = r * 0.55; d.castShadow = true; g.add(d);
  const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, r * 0.6, 8), M.brass()); fin.position.y = r * 0.55 + r * 1.15 + r * 0.25; g.add(fin);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.07 - i * 0.015, 12, 8), M.brass()); b.position.y = r * 1.75 + r * 0.1 + i * 0.13; g.add(b); }
  // arched windows around the drum
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const w = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.22, r * 0.34), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 })); w.position.set(Math.cos(a) * r * 1.03, r * 0.28, Math.sin(a) * r * 1.03); w.lookAt(Math.cos(a) * r * 3, r * 0.28, Math.sin(a) * r * 3); g.add(w); }
  return g;
}

export function watchTower(h = 11): THREE.Group {
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0xb8ab98, roughness: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, h, 28), conc); shaft.position.y = h / 2; shaft.castShadow = true; g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.6, 2.6, 28), conc); cab.position.y = h + 1.3; cab.castShadow = true; g.add(cab);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.12, 2.12, 0.9, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x1e2a33, metalness: 0.6, roughness: 0.2 })); band.position.y = h + 1.6; g.add(band);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.25, 28), conc); roof.position.y = h + 2.75; g.add(roof);
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), M.steel()); p.position.set(Math.cos(a) * 2.25, h + 3.35, Math.sin(a) * 2.25); g.add(p); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.03, 6, 40), M.steel()); ring.rotation.x = Math.PI / 2; ring.position.y = h + 3.85; g.add(ring);
  return g;
}

export function satelliteDish(r = 0.9): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = []; for (let i = 0; i <= 12; i++) { const x = (i / 12) * r; pts.push(new THREE.Vector2(x, x * x * 0.35)); }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.5, side: THREE.DoubleSide }));
  dish.rotation.x = -Math.PI / 2 + 0.6; dish.position.y = 1.1; dish.castShadow = true; g.add(dish);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.2, 8), M.steel()); pole.position.y = 0.6; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, r * 0.9, 6), M.steel()); arm.position.set(0, 1.35, 0.35); arm.rotation.x = 0.9; g.add(arm);
  return g;
}

export function waterTank(): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 20), new THREE.MeshStandardMaterial({ color: 0xd8e2e6, roughness: 0.6 })); t.position.y = 0.95; t.castShadow = true; g.add(t);
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), M.steel()); l.position.set(x, 0.15, z); g.add(l); }
  return g;
}

export function mountainRing(radius: number, cx: number, cz: number, color = 0x9a6f4a): THREE.Group {
  // eroded rocky ridgelines: ridged noise for crests, 2D noise carves gullies and scree fans, smooth shading
  // with a world-space triplanar rock texture for close detail and strata banding
  const grp = new THREE.Group();
  const hash2 = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const n2 = (x: number, y: number) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return (hash2(ix, iy) * (1 - ux) + hash2(ix + 1, iy) * ux) * (1 - uy) + (hash2(ix, iy + 1) * (1 - ux) + hash2(ix + 1, iy + 1) * ux) * uy; };
  const ridged = (x: number, y: number, oct: number) => { let v = 0, amp = 1, fr = 1, tot = 0; for (let k = 0; k < oct; k++) { v += (1 - Math.abs(n2(x * fr + k * 7.1, y * fr) * 2 - 1)) ** 2 * amp; tot += amp; amp *= 0.5; fr *= 2.03; } return v / tot; };
  const rockMat = (shade: number) => {
    const t = rockTexture();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.BackSide, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.4, 1.4) });
    m.color.setScalar(shade);
    m.onBeforeCompile = sh => {
      // triplanar: sample by world position instead of the cylinder's stretched UVs
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWp; varying vec3 vWn;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWp; varying vec3 vWn;\nvec4 tri(sampler2D t, float s){ vec3 b = pow(abs(vWn), vec3(4.0)); b /= (b.x + b.y + b.z); return texture2D(t, vWp.zy * s) * b.x + texture2D(t, vWp.xz * s) * b.y + texture2D(t, vWp.xy * s) * b.z; }")
        .replace("#include <map_fragment>", "diffuseColor *= mix(tri(map, 0.021), tri(map, 0.0043), 0.5) * 1.35;")
        .replace("#include <normal_fragment_maps>", "{ vec3 nm = tri(normalMap, 0.021).xyz * 2.0 - 1.0; normal = normalize(normal + vec3(nm.xy * normalScale * 0.5, 0.0)); }");
    };
    return m;
  };
  const base = new THREE.Color(color), dark = base.clone().multiplyScalar(0.62), light = base.clone().lerp(new THREE.Color(0xf6dcb4), 0.6);
  const layer = (R: number, hMin: number, hMax: number, freq: number, seg: number, rows: number, shade: number) => {
    const geo = new THREE.CylinderGeometry(R, R * 1.05, 1, seg, rows, true);
    const pos = geo.attributes.position as THREE.BufferAttribute, cols = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k), t = pos.getY(k) + 0.5, a = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
      const crest = hMin + (hMax - hMin) * ridged(a * freq, 0.3, 5) ** 1.3 * (0.6 + 0.4 * n2(a * 3, 9.1));
      // gullies: deeper towards the crest, scree fans at the bottom
      const gully = ridged(a * freq * 6, t * 2.5, 3);
      const crag = (ridged(a * freq * 28, t * 6, 3) - 0.5) * 0.09 * crest * t;
      const y = crest * (t - (1 - gully) * 0.12 * t * t) + crag;
      const out = 1 - t * 0.25 + (1 - gully) * 0.025 * t + (n2(a * freq * 40, t * 9) - 0.5) * 0.012;
      pos.setXYZ(k, x * out, Math.max(0, y), z * out);
      const strata = 0.5 + 0.5 * Math.sin(y * 0.22 + n2(a * 90, t * 3) * 2.5);
      const c = dark.clone().lerp(base, 0.35 + strata * 0.45).lerp(light, Math.max(0, gully - 0.55) * 0.9 * t).multiplyScalar(0.92 + n2(a * 400, t * 10) * 0.16);
      cols.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockMat(shade));
    m.position.set(cx, -2, cz); grp.add(m);
  };
  layer(radius * 1.3, 70, 260, 6, 1100, 60, 1.05);
  layer(radius, 30, 140, 10, 1400, 48, 1.25);
  layer(radius * 0.55, 4, 26, 16, 400, 8, 1.05); // foothills and dunes
  return grp;
}

let rockCache: { map: THREE.Texture; normalMap: THREE.Texture } | null = null;
/** procedural weathered rock: fbm + fracture lines, grey-neutral so vertex colour sets the hue */
function rockTexture() {
  if (rockCache) return rockCache;
  const S = 512, c = document.createElement("canvas"), h = document.createElement("canvas"); c.width = c.height = h.width = h.height = S;
  const cx = c.getContext("2d")!, hx = h.getContext("2d")!;
  const img = cx.createImageData(S, S), him = hx.createImageData(S, S);
  const hash = (x: number, y: number) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  const vn = (x: number, y: number, p: number) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), w = (a: number) => ((a % p) + p) % p;
    return (hash(w(ix), w(iy)) * (1 - ux) + hash(w(ix + 1), w(iy)) * ux) * (1 - uy) + (hash(w(ix), w(iy + 1)) * (1 - ux) + hash(w(ix + 1), w(iy + 1)) * ux) * uy; };
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, a = 1, f = 4, tot = 0; for (let o = 0; o < 6; o++) { v += vn(x / S * f, y / S * f, f) * a; tot += a; a *= 0.5; f *= 2; } v /= tot;
    const crack = Math.abs(vn(x / S * 8, y / S * 8, 8) - 0.5) < 0.025 ? 0.35 : 0;
    const hv = v - crack; hgt[y * S + x] = hv;
    const i = (y * S + x) * 4, g = 150 + (v - 0.5) * 170 - crack * 160; img.data[i] = g; img.data[i + 1] = g * 0.97; img.data[i + 2] = g * 0.93; img.data[i + 3] = 255;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const H = (xx: number, yy: number) => hgt[((yy + S) % S) * S + ((xx + S) % S)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * 6, dy = (H(x, y + 1) - H(x, y - 1)) * 6, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    him.data[i] = (-dx / l * 0.5 + 0.5) * 255; him.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; him.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; him.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0); hx.putImageData(him, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const normalMap = new THREE.CanvasTexture(h); normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  rockCache = { map, normalMap };
  return rockCache;
}
