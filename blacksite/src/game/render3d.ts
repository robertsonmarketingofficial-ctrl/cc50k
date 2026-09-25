// First-person renderer (three.js). The simulation stays on the tile grid; this draws it from eye level.
// Baked per-tile light is fed to walls/props through a vertex attribute and to floor/ceiling as a lightMap,
// so guard flashlights (real spotlights) and muzzle flashes still light the scene dynamically.
import * as THREE from "three";
import { LOOT } from "./catalog";
import type { Game, Guard } from "./engine";
import { EYE } from "./engine";
import { dist } from "./rng";
import { buildStatic, PX } from "./render";
import type { Settings, WeaponId } from "./types";
import { T } from "./types";

const WALL_H = 2.8;
const CEIL_H = 2.8;

// ------------------------------------------------------------------------------------------------ materials
function bakedMaterial(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBake = bake;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBake;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBake;");
  };
  return m;
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function grain(x: CanvasRenderingContext2D, w: number, h: number, a: number) {
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() - 0.5) * a; img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v; }
  x.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------------------------------------ guard model
function humanoid(kind: string): THREE.Group {
  const g = new THREE.Group();
  const cloth = kind === "contractor" ? 0x2e3326 : kind === "chief" ? 0x1e252e : kind === "hostage" ? 0xb9b2a2 : 0x3d4a58;
  const skin = 0x8a6a55, dark = 0x121417;
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c, emissive: 0x0b0d10 });
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, name?: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); if (name) m.name = name; g.add(m); return m;
  };
  const legL = new THREE.Group(); legL.position.set(0, 0.9, 0.11); legL.name = "legL"; g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0, 0.9, -0.11); legR.name = "legR"; g.add(legR);
  const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), mat(kind === "hostage" ? 0x4a4038 : 0x22262b)); l1.position.y = -0.45; legL.add(l1);
  const l2 = l1.clone(); legR.add(l2);
  box(0.3, 0.62, 0.46, cloth, 0, 1.22, 0, "torso");
  if (kind !== "hostage") box(0.32, 0.34, 0.48, kind === "contractor" ? 0x3b3f2e : 0x2a3038, 0.02, 1.3, 0); // vest
  const head = box(0.22, 0.24, 0.22, skin, 0, 1.68, 0, "head");
  if (kind === "contractor") box(0.26, 0.12, 0.26, 0x2b2e24, 0, 1.8, 0); // helmet
  else if (kind === "chief") box(0.25, 0.06, 0.25, 0xc9c3b0, 0, 1.8, 0); // cap
  else if (kind !== "hostage") box(0.24, 0.07, 0.24, 0x1a1e24, 0, 1.79, 0);
  void head;
  // arms holding a weapon forward (+x is forward)
  const arms = new THREE.Group(); arms.position.set(0.05, 1.38, 0); arms.name = "arms"; g.add(arms);
  if (kind === "hostage") {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.44), mat(cloth)); a.position.set(-0.12, -0.2, 0); arms.add(a);
  } else {
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), mat(cloth)); a1.position.set(0.18, -0.08, 0.16); a1.rotation.y = 0.35; arms.add(a1);
    const a2 = a1.clone(); a2.position.set(0.2, -0.08, -0.12); a2.rotation.y = -0.3; arms.add(a2);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.06), mat(dark)); gun.position.set(0.42, -0.06, 0.02); arms.add(gun);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff2cc })); light.position.set(0.68, -0.06, 0.02); light.name = "lamp"; arms.add(light);
  }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
  return g;
}

function silhouette(src: THREE.Group, color: number, opacity: number): THREE.Group {
  const s = src.clone(true);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
  s.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.material = m; mesh.renderOrder = 10; } });
  s.scale.setScalar(1.04);
  s.visible = false;
  return s;
}

// ------------------------------------------------------------------------------------------------ weapon viewmodels
function viewmodel(id: WeaponId | "gadget" | "drone"): THREE.Group {
  const g = new THREE.Group();
  const m = (c: number, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, parent: THREE.Object3D = g, e = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c, e)); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const glove = 0x4a4d52, sleeve = 0x5a6674, metal = 0x55595f, poly = 0x62666c, tan = 0x9a8464;
  if (id === "pistol") {
    box(0.05, 0.07, 0.24, metal, 0, 0, -0.1);           // slide
    box(0.045, 0.05, 0.2, poly, 0, -0.035, -0.08);     // frame
    box(0.04, 0.05, 0.14, 0x121314, 0, 0.0, -0.29);     // suppressor
    box(0.045, 0.12, 0.06, poly, 0, -0.1, 0.0);         // grip
  } else if (id === "smg") {
    box(0.06, 0.08, 0.42, metal, 0, 0, -0.15);
    box(0.045, 0.16, 0.05, poly, 0, -0.12, -0.12);      // mag
    box(0.05, 0.12, 0.06, poly, 0, -0.09, 0.03);
    box(0.04, 0.04, 0.2, poly, 0, 0.02, 0.14);           // stock
    box(0.03, 0.05, 0.06, 0x0f1011, 0, 0.07, -0.1);      // optic
    box(0.012, 0.012, 0.012, 0xff3b30, 0, 0.1, -0.1, g, 0xff2010);
  } else if (id === "shotgun") {
    box(0.07, 0.07, 0.62, metal, 0, 0.01, -0.22);
    box(0.06, 0.05, 0.42, tan, 0, -0.05, -0.2);          // pump
    box(0.05, 0.12, 0.07, tan, 0, -0.08, 0.1);
    box(0.05, 0.08, 0.22, tan, 0, -0.03, 0.22);
  } else if (id === "gadget") {
    box(0.12, 0.08, 0.12, 0x3b3f44, 0, 0, -0.08); box(0.03, 0.03, 0.03, 0xff3b30, 0, 0.05, -0.08, g, 0xff2010);
  } else {
    box(0.16, 0.1, 0.12, 0x2b2f33, 0, 0, -0.1); box(0.1, 0.02, 0.1, 0x40ff90, 0, 0.06, -0.08, g, 0x20a050);
  }
  // hands and sleeves
  box(0.07, 0.07, 0.1, glove, 0.0, -0.1, 0.02);
  box(0.08, 0.08, 0.3, sleeve, 0.02, -0.14, 0.2);
  if (id !== "pistol") { box(0.07, 0.07, 0.1, glove, -0.02, -0.06, -0.24); box(0.08, 0.08, 0.3, sleeve, -0.07, -0.12, -0.05); }
  else { box(0.07, 0.07, 0.1, glove, -0.04, -0.1, 0.03); box(0.08, 0.08, 0.3, sleeve, -0.1, -0.14, 0.2); }
  return g;
}

// ------------------------------------------------------------------------------------------------ renderer
export class FPRenderer {
  canvas: HTMLCanvasElement; game: Game; settings: Settings;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.04, 80);
  vmScene = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 5);
  private lightTex!: THREE.DataTexture;
  private lightVersion = -1;
  private levelVersion = -1;
  private walls: THREE.Mesh | null = null;
  private wallMatSoft = bakedMaterial(0xffffff);
  private wallMatHard = bakedMaterial(0xffffff);
  private propMesh: THREE.Mesh | null = null;
  private glowMesh: THREE.Mesh | null = null;
  private doorMeshes: THREE.Group[] = [];
  private guardModels = new Map<number, { g: THREE.Group; sil: THREE.Group; walk: number; lx: number; ly: number }>();
  private hostageModel: THREE.Group | null = null;
  private camMeshes: THREE.Group[] = [];
  private fixtureMeshes: { mesh: THREE.Mesh; id: number }[] = [];
  private itemMeshes = new Map<number, THREE.Object3D>();
  private droneMeshes: THREE.Group[] = [];
  private chargeMeshes: THREE.Mesh[] = [];
  private spots: THREE.SpotLight[] = [];
  private beams: THREE.Mesh[] = [];
  private muzzleLight = new THREE.PointLight(0xffd9a0, 0, 7, 1.6);
  private enemyFlash = new THREE.PointLight(0xffb070, 0, 8, 1.6);
  private ambient = new THREE.AmbientLight(0x8090a8, 0.07);
  private rain!: THREE.LineSegments;
  private sparks!: THREE.Points;
  private holes!: THREE.InstancedMesh;
  private holeCount = 0; private lastImpact = 0;
  private vm: Record<string, THREE.Group> = {};
  private vmAmbient = new THREE.AmbientLight(0xffffff, 0.4);
  private vmKey = new THREE.DirectionalLight(0xfff0dd, 0.6);
  private vmMuzzle = new THREE.PointLight(0xffc880, 0, 1.2);
  private bob = 0; private sway = { x: 0, y: 0 }; private adsT = 0;
  lookDelta = { x: 0, y: 0 };
  extraction!: THREE.Group;

  constructor(canvas: HTMLCanvasElement, game: Game, settings: Settings) {
    this.canvas = canvas; this.game = game; this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.autoClear = false;
    this.scene.background = new THREE.Color(0x06080b);
    this.scene.fog = new THREE.FogExp2(0x07090d, 0.055);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.ambient, this.muzzleLight, this.enemyFlash);
    const moon = new THREE.DirectionalLight(0x6c7f9a, 0.12); moon.position.set(-20, 30, -10); this.scene.add(moon);
    this.build();
    this.vmScene.add(this.vmAmbient, this.vmKey, this.vmMuzzle);
    this.vmKey.position.set(0.5, 1, 0.8);
    for (const k of ["pistol", "smg", "shotgun", "gadget", "drone"] as const) { this.vm[k] = viewmodel(k); this.vm[k].visible = false; this.vm[k].scale.setScalar(0.72); this.vmScene.add(this.vm[k]); }
  }

  dispose() {
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach(x => x.dispose()); } });
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------------------------------------- build
  private build() {
    const L = this.game.level;
    // light texture shared by floor and ceiling
    this.lightTex = new THREE.DataTexture(new Uint8Array(L.w * L.h * 4), L.w, L.h, THREE.RGBAFormat);
    this.lightTex.magFilter = THREE.LinearFilter; this.lightTex.minFilter = THREE.LinearFilter;
    this.lightTex.flipY = false;
    this.updateLight();

    // floor: the detailed top-down art from the tactical renderer
    const floorCanvas = buildStatic(L);
    const floorTex = new THREE.CanvasTexture(floorCanvas); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 8;
    const floorGeo = new THREE.PlaneGeometry(L.w, L.h); floorGeo.rotateX(-Math.PI / 2); floorGeo.translate(L.w / 2, 0, L.h / 2);
    // PlaneGeometry uv v runs bottom-up; flip so texture row 0 is z=0
    const uv = floorGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ map: floorTex, lightMap: this.lightTex, lightMapIntensity: 3.2 }));
    this.scene.add(floor);

    // ceiling over the building
    let minX = L.w, minY = L.h, maxX = 0, maxY = 0;
    for (const r of L.rooms) { minX = Math.min(minX, r.x - 1); minY = Math.min(minY, r.y - 1); maxX = Math.max(maxX, r.x + r.w + 1); maxY = Math.max(maxY, r.y + r.h + 1); }
    const ceilTex = canvasTex(128, 128, x => {
      x.fillStyle = "#3a3d40"; x.fillRect(0, 0, 128, 128); x.strokeStyle = "#26282b"; x.lineWidth = 3; x.strokeRect(0, 0, 128, 128); grain(x, 128, 128, 18);
    });
    ceilTex.repeat.set(1, 1);
    const ceilGeo = new THREE.PlaneGeometry(L.w, L.h); ceilGeo.rotateX(Math.PI / 2); ceilGeo.translate(L.w / 2, CEIL_H, L.h / 2);
    const cuv = ceilGeo.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < cuv.count; i++) cuv.setY(i, 1 - cuv.getY(i));
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0x55585c, lightMap: this.lightTex, lightMapIntensity: 1.6 });
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    // clip the ceiling to the building footprint with a second geometry
    const cg = new THREE.PlaneGeometry(maxX - minX, maxY - minY); cg.rotateX(Math.PI / 2); cg.translate((minX + maxX) / 2, CEIL_H, (minY + maxY) / 2);
    const cguv = cg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < cguv.count; i++) { const px = cg.attributes.position.getX(i), pz = cg.attributes.position.getZ(i); cguv.setXY(i, px / L.w, pz / L.h); }
    ceiling.geometry.dispose(); ceiling.geometry = cg;
    this.scene.add(ceiling);
    void ceilTex;

    // light fixtures (emissive panels)
    for (const l of L.lights) {
      if (l.room < 0) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.2), new THREE.MeshBasicMaterial({ color: l.color }));
        pole.position.set(l.x, 3.4, l.y); this.scene.add(pole); this.fixtureMeshes.push({ mesh: pole, id: l.id }); continue;
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: l.color }));
      m.position.set(l.x, CEIL_H - 0.03, l.y); this.scene.add(m); this.fixtureMeshes.push({ mesh: m, id: l.id });
    }

    this.buildWalls();
    this.buildProps();

    // doors
    for (const d of L.doors) {
      const pivot = new THREE.Group();
      const lockCol = d.lock === 2 ? 0xc9372c : d.lock === 1 ? 0x3f7dd6 : 0x000000;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.96, 2.25, 0.07), new THREE.MeshLambertMaterial({ color: d.exterior === "dock" ? 0x4a4f55 : 0x565c62 }));
      slab.position.set(0.48, 1.125, 0); pivot.add(slab);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.1), new THREE.MeshLambertMaterial({ color: 0x9aa0a6 })); handle.position.set(0.82, 1.05, 0); pivot.add(handle);
      if (lockCol) { const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.12), new THREE.MeshBasicMaterial({ color: lockCol })); pad.position.set(0.86, 1.3, 0); pad.name = "pad"; pivot.add(pad); }
      // hinge at one end of the opening
      if (d.vertical) { pivot.position.set(d.x + 0.5, 0, d.y); pivot.rotation.y = -Math.PI / 2; }
      else { pivot.position.set(d.x, 0, d.y + 0.5); }
      pivot.userData = { base: pivot.rotation.y, t: d.open ? 1 : 0 };
      this.scene.add(pivot); this.doorMeshes.push(pivot);
    }

    // cameras
    for (const c of L.cameras) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.16), new THREE.MeshLambertMaterial({ color: c.hardened ? 0x55655f : 0xd6d6d0 })); body.position.x = 0.1; g.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), new THREE.MeshLambertMaterial({ color: 0x0b0c0e })); lens.rotation.z = Math.PI / 2; lens.position.x = 0.26; g.add(lens);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2a20 })); led.position.set(0.2, 0.08, 0); led.name = "led"; g.add(led);
      g.position.set(c.x, 2.5, c.y); this.scene.add(g); this.camMeshes.push(g);
    }

    // extraction van
    const van = new THREE.Group();
    const vb = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.9, 1.8), new THREE.MeshLambertMaterial({ color: 0x23272b })); vb.position.y = 1.15; van.add(vb);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 1.78), new THREE.MeshLambertMaterial({ color: 0x2c3136 })); cab.position.set(-2.4, 0.85, 0); van.add(cab);
    for (const z of [-0.6, 0.6]) { const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.18), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); tl.position.set(2.12, 0.9, z); van.add(tl); }
    for (const [x, z] of [[-1.6, 0.92], [1.3, 0.92], [-1.6, -0.92], [1.3, -0.92]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 14), new THREE.MeshLambertMaterial({ color: 0x0c0d0e })); w.rotation.x = Math.PI / 2; w.position.set(x, 0.36, z); van.add(w); }
    van.position.set(L.extraction.x, 0, L.extraction.y); this.scene.add(van); this.extraction = van;
    const exLight = new THREE.PointLight(0xffc070, 0.8, 6, 1.5); exLight.position.set(L.extraction.x, 1.6, L.extraction.y); this.scene.add(exLight);

    // guard flashlights: a small pool of real spotlights, assigned to the nearest guards each frame
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(0xfff1d6, 0, 13, 0.36, 0.45, 1.3);
      this.scene.add(s, s.target); this.spots.push(s);
      const beamGeo = new THREE.ConeGeometry(1.6, 6, 20, 1, true); beamGeo.translate(0, -3, 0); beamGeo.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      this.scene.add(beam); this.beams.push(beam);
    }

    // rain
    // rain: thin streaks (two vertices per drop)
    const N = 1400, pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = Math.random() * 30 - 15, y = Math.random() * 8, z = Math.random() * 30 - 15; pos.set([x, y, z, x + 0.03, y + 0.45, z + 0.01], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x8fa3ba, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.rain);
    // sparks/dust
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffc880, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.sparks);
    // bullet holes
    this.holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 6), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), 160);
    this.holes.count = 0; this.scene.add(this.holes);
  }

  private bakeAt(x: number, y: number): [number, number, number] {
    const g = this.game, L = g.level;
    const tx = Math.max(0, Math.min(L.w - 1, Math.floor(x))), ty = Math.max(0, Math.min(L.h - 1, Math.floor(y)));
    const l = g.lightmap[ty * L.w + tx] ?? 0;
    const red = g.alert === 3;
    const v = 0.03 + l * 1.25;
    return red ? [v * 1.15 + 0.02, v * 0.45, v * 0.4] : [v * 1.0, v * 0.97, v * 0.9];
  }

  private buildWalls() {
    const L = this.game.level;
    if (this.walls) { this.scene.remove(this.walls); this.walls.geometry.dispose(); }
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], bake: number[] = [], groups: { soft: number[]; hard: number[] } = { soft: [], hard: [] };
    const idx: number[] = []; let vi = 0;
    const faces: [number, number, number, number, number][] = []; // dx, dy face direction
    void faces;
    const addQuad = (p: number[][], n: number[], light: [number, number, number], u0: number, u1: number, hard: boolean) => {
      for (const q of p) { pos.push(...q); nor.push(...n); bake.push(...light); }
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      const list = hard ? groups.hard : groups.soft;
      list.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
    };
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.tiles[i] !== T.WALL) continue;
      const hard = L.reinforced.has(i);
      const dmg = 1 - Math.max(0, (L.wallHp.get(i) ?? 220)) / 220;
      const tint = (c: [number, number, number]): [number, number, number] => [c[0] * (1 - dmg * 0.5), c[1] * (1 - dmg * 0.5), c[2] * (1 - dmg * 0.5)];
      const open = (xx: number, yy: number) => { const t = L.tiles[yy * L.w + xx]; return t !== T.WALL && t !== undefined; };
      if (open(x + 1, y)) addQuad([[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, WALL_H, y], [x + 1, WALL_H, y + 1]], [1, 0, 0], tint(this.bakeAt(x + 1.5, y + 0.5)), y, y + 1, hard);
      if (open(x - 1, y)) addQuad([[x, 0, y], [x, 0, y + 1], [x, WALL_H, y + 1], [x, WALL_H, y]], [-1, 0, 0], tint(this.bakeAt(x - 0.5, y + 0.5)), y, y + 1, hard);
      if (open(x, y + 1)) addQuad([[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, WALL_H, y + 1], [x, WALL_H, y + 1]], [0, 0, 1], tint(this.bakeAt(x + 0.5, y + 1.5)), x, x + 1, hard);
      if (open(x, y - 1)) addQuad([[x + 1, 0, y], [x, 0, y], [x, WALL_H, y], [x + 1, WALL_H, y]], [0, 0, -1], tint(this.bakeAt(x + 0.5, y - 0.5)), x, x + 1, hard);
      // top cap (visible from outside over the roofline)
      addQuad([[x, WALL_H, y], [x, WALL_H, y + 1], [x + 1, WALL_H, y + 1], [x + 1, WALL_H, y]], [0, 1, 0], [0.02, 0.02, 0.02], x, x + 1, hard);
    }
    idx.push(...groups.soft); const softCount = groups.soft.length; idx.push(...groups.hard);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("bake", new THREE.Float32BufferAttribute(bake, 3));
    geo.setIndex(idx);
    geo.addGroup(0, softCount, 0); geo.addGroup(softCount, groups.hard.length, 1);
    if (!this.wallMatSoft.map) {
      this.wallMatSoft.map = canvasTex(256, 256, x => {
        // painted blockwork: pale upper wall, dark dado band, skirting
        x.fillStyle = "#8d9192"; x.fillRect(0, 0, 256, 256);
        x.fillStyle = "#5d6264"; x.fillRect(0, 150, 256, 106);
        x.fillStyle = "#2e3133"; x.fillRect(0, 236, 256, 20);
        x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = 1;
        for (let r = 0; r < 256; r += 32) { x.beginPath(); x.moveTo(0, r); x.lineTo(256, r); x.stroke(); for (let c = (r / 32) % 2 ? 0 : 64; c < 256; c += 128) { x.beginPath(); x.moveTo(c, r); x.lineTo(c, r + 32); x.stroke(); } }
        grain(x, 256, 256, 22);
      });
      this.wallMatHard.map = canvasTex(256, 256, x => {
        // steel reinforcement plates with rivets
        x.fillStyle = "#4b5358"; x.fillRect(0, 0, 256, 256);
        x.strokeStyle = "#2b3034"; x.lineWidth = 4; x.strokeRect(2, 2, 252, 124); x.strokeRect(2, 130, 252, 124);
        x.fillStyle = "#6a7378"; for (const [a, b] of [[14, 14], [242, 14], [14, 114], [242, 114], [14, 142], [242, 142], [14, 242], [242, 242]]) { x.beginPath(); x.arc(a, b, 4, 0, 7); x.fill(); }
        x.fillStyle = "rgba(200,160,40,0.35)"; for (let k = 0; k < 256; k += 32) x.fillRect(k, 232, 16, 12);
        grain(x, 256, 256, 18);
      });
    }
    this.walls = new THREE.Mesh(geo, [this.wallMatSoft, this.wallMatHard]);
    this.scene.add(this.walls);
    this.levelVersion = L.version;
  }

  private buildProps() {
    const L = this.game.level;
    if (this.propMesh) { this.scene.remove(this.propMesh); this.propMesh.geometry.dispose(); }
    if (this.glowMesh) { this.scene.remove(this.glowMesh); this.glowMesh.geometry.dispose(); }
    const geos: THREE.BufferGeometry[] = [];
    const glows: THREE.BufferGeometry[] = [];
    const glowBox = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
      const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); b.deleteAttribute("uv");
      const c = new THREE.Color(color), n = b.attributes.position.count, cols = new Float32Array(n * 3), zero = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) cols.set([c.r, c.g, c.b], k * 3);
      b.setAttribute("color", new THREE.BufferAttribute(cols, 3)); b.setAttribute("bake", new THREE.BufferAttribute(zero, 3));
      glows.push(b);
    };
    const colors: Record<string, [number, number]> = {
      desk: [0x3a3c40, 0.78], execdesk: [0x4a3528, 0.8], reception: [0x3d3f43, 1.05], console: [0x2c3036, 0.85], bench: [0x606b70, 0.9],
      cabinet: [0x4a4e53, 1.6], bookshelf: [0x4a3a2c, 2.0], rack: [0x15181c, 2.1], shelf: [0x5b534a, 2.0], crate: [0x5d4e39, 0.9], tank: [0x2f4b4e, 1.7],
      fridge: [0xc9ccd0, 1.9], gunrack: [0x2c3034, 1.9], safe: [0x33373b, 1.1], boiler: [0x4a3c2c, 2.2], pipes: [0x40464c, 2.6], locker: [0x3c4550, 1.95],
      trailer: [0x2e3339, 2.6], plant: [0x2e4a33, 1.3], bars: [0x5a6168, 2.6], deposit: [0x3b3f44, 2.3], pedestal: [0x44484d, 1.0], terminal: [0x22272d, 1.2],
    };
    for (const p of L.props) {
      const [col, hgt] = colors[p.kind] ?? [0x3e4145, p.tall ? 1.9 : 0.8];
      const inset = p.kind === "pipes" || p.kind === "bars" ? 0.3 : 0.06;
      const g = new THREE.BoxGeometry(p.w - inset * 2, hgt, p.h - inset * 2);
      g.translate(p.x + p.w / 2, hgt / 2, p.y + p.h / 2);
      const c = new THREE.Color(col);
      const n = g.attributes.position.count;
      const bake = new Float32Array(n * 3), cols = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const px = g.attributes.position.getX(k), pz = g.attributes.position.getZ(k), py = g.attributes.position.getY(k);
        const nx = g.attributes.normal.getX(k), nz = g.attributes.normal.getZ(k);
        const b = this.bakeAt(px + nx * 0.6, pz + nz * 0.6);
        const shade = 0.6 + 0.4 * (py / hgt);
        bake.set([b[0] * shade, b[1] * shade, b[2] * shade], k * 3); cols.set([c.r, c.g, c.b], k * 3);
      }
      g.setAttribute("bake", new THREE.BufferAttribute(bake, 3));
      g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute("uv");
      geos.push(g);
      // monitors glow on desks and consoles
      if (p.kind === "desk" || p.kind === "console" || p.kind === "reception" || p.kind === "execdesk") {
        for (let k = 0; k < p.w; k++) glowBox(0.42, 0.28, 0.03, p.x + k + 0.5, hgt + 0.2, p.y + 0.35, p.kind === "console" ? 0x5ab0e0 : 0x24384a);
      }
      if (p.kind === "rack") {
        for (let k = 0; k < p.h * 4; k++) glowBox(0.03, 0.02, 0.03, p.x + 0.5 + (k % 2 ? 0.46 : -0.46), 0.4 + (k % 7) * 0.22, p.y + 0.3 + (k / 4) * 1.0, k % 5 ? 0x40d090 : 0xff5030);
      }
    }
    if (glows.length) { this.glowMesh = new THREE.Mesh(mergeGeos(glows), new THREE.MeshBasicMaterial({ vertexColors: true })); this.scene.add(this.glowMesh); }
    if (!geos.length) return;
    const merged = mergeGeos(geos);
    const mat = bakedMaterial(0xffffff, { vertexColors: true });
    this.propMesh = new THREE.Mesh(merged, mat);
    this.scene.add(this.propMesh);
  }

  private updateLight() {
    const g = this.game, L = g.level, d = this.lightTex.image.data as Uint8Array;
    const red = g.alert === 3;
    for (let i = 0; i < L.w * L.h; i++) {
      const l = Math.min(1, g.lightmap[i]);
      const v = Math.round(255 * Math.min(1, 0.02 + l * 0.9));
      d[i * 4] = red ? Math.min(255, v * 1.2) : v; d[i * 4 + 1] = red ? v * 0.45 : v * 0.97; d[i * 4 + 2] = red ? v * 0.4 : v * 0.9; d[i * 4 + 3] = 255;
    }
    this.lightTex.needsUpdate = true;
    this.lightVersion = g.lightVersion;
  }

  // ---------------------------------------------------------------------------------------------- per frame
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.vmCamera.aspect = w / h;
      this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    }
  }

  draw(dt: number) {
    const g = this.game, L = g.level, p = g.player;
    this.resize();
    if (!this.canvas.clientWidth) return;
    if (g.lightVersion !== this.lightVersion) { this.updateLight(); this.buildWalls(); this.buildProps(); }
    else if (L.version !== this.levelVersion) this.buildWalls();

    // ---- camera
    const vp = g.viewpoint();
    const ads = g.input.ads && vp.kind === "operator" && p.reloadT <= 0;
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    const moving = vp.kind === "operator" && p.moving;
    this.bob += dt * (moving ? (p.sprint && !p.crouch ? 13 : p.crouch ? 6 : 9) : 0);
    const bobY = moving ? Math.sin(this.bob) * (p.sprint ? 0.045 : 0.025) * (1 - this.adsT * 0.8) : 0;
    const shake = this.settings.shake ? g.shake * 0.08 : 0;
    const pitch = g.input.pitch + g.recoil * 0.035 + (Math.random() - 0.5) * shake;
    this.camera.position.set(vp.x, vp.h + bobY, vp.y);
    const yaw = vp.angle + (Math.random() - 0.5) * shake;
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
    if (vp.kind === "operator") this.camera.rotateZ(-g.lean * 0.14);
    const baseFov = vp.kind === "drone" ? 92 : vp.kind === "camera" ? 72 : 78;
    const fov = baseFov - this.adsT * (p.weapon === "pistol" ? 16 : 24);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    (this.scene.fog as THREE.FogExp2).density = vp.kind === "camera" ? 0.03 : 0.055;

    // ---- ambient mood
    const lockPulse = g.alert === 3 ? 0.5 + 0.5 * Math.sin(g.t * 5.5) : 0;
    this.ambient.color.setRGB(0.5 + lockPulse * 0.6, 0.56 - lockPulse * 0.3, 0.66 - lockPulse * 0.35);
    this.ambient.intensity = 0.06 + lockPulse * 0.08;

    // ---- fixtures
    for (const f of this.fixtureMeshes) {
      const l = L.lights[f.id];
      const off = !l.on || l.offUntil > g.t;
      const flick = l.flicker && Math.sin(g.t * 13 + l.id * 7) > 0.93;
      (f.mesh.material as THREE.MeshBasicMaterial).color.set(off || flick ? 0x16181b : g.alert === 3 ? 0xff4a3a : l.color);
    }

    // ---- doors
    L.doors.forEach((d, i) => {
      const m = this.doorMeshes[i]; const ud = m.userData as { base: number; t: number };
      ud.t += ((d.open ? 1 : 0) - ud.t) * Math.min(1, dt * 9);
      m.rotation.y = ud.base + ud.t * (Math.PI / 2) * 0.95;
      const pad = m.getObjectByName("pad") as THREE.Mesh | undefined;
      if (pad) (pad.material as THREE.MeshBasicMaterial).color.set(d.lock === 2 ? 0xc9372c : d.lock === 1 ? 0x3f7dd6 : 0x3fae5a);
    });

    // ---- cameras
    L.cameras.forEach((c, i) => {
      const m = this.camMeshes[i];
      m.visible = c.state !== "destroyed" && !(vp.kind === "camera" && g.camView === i);
      m.rotation.y = -c.angle; m.rotation.z = -0.35;
      const led = m.getObjectByName("led") as THREE.Mesh;
      (led.material as THREE.MeshBasicMaterial).color.set(c.state === "active" ? (Math.sin(g.t * 4 + c.id) > 0 ? 0xff2a20 : 0x3a0806) : c.state === "emp" ? 0x5d8fd0 : c.state === "looped" ? 0x2f7a4a : 0x111111);
    });

    // ---- guards
    const marked = (gd: Guard) => gd.markedUntil > g.t || g.thermalUntil > g.t && dist(gd.x, gd.y, p.x, p.y) < 18;
    for (const gd of g.guards) {
      let e = this.guardModels.get(gd.id);
      if (!e) {
        const model = humanoid(gd.kind); const sil = silhouette(model, 0xff4655, 0.5);
        this.scene.add(model, sil);
        e = { g: model, sil, walk: 0, lx: gd.x, ly: gd.y }; this.guardModels.set(gd.id, e);
      }
      const moved = dist(e.lx, e.ly, gd.x, gd.y); e.lx = gd.x; e.ly = gd.y;
      e.walk += moved * 6;
      for (const m of [e.g, e.sil]) {
        m.position.set(gd.x, 0, gd.y);
        if (gd.down) { m.rotation.set(0, -gd.angle, Math.PI / 2); m.position.y = 0.18; }
        else {
          m.rotation.set(0, -gd.angle, 0);
          (m.getObjectByName("legL") as THREE.Object3D).rotation.z = Math.sin(e.walk) * 0.45 * Math.min(1, moved * 30);
          (m.getObjectByName("legR") as THREE.Object3D).rotation.z = -Math.sin(e.walk) * 0.45 * Math.min(1, moved * 30);
          (m.getObjectByName("arms") as THREE.Object3D).rotation.z = gd.state === "COMBAT" ? 0 : -0.35;
        }
      }
      e.sil.visible = !gd.down && marked(gd);
      const sm = (e.sil.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined);
      if (sm) (sm.material as THREE.MeshBasicMaterial).color.set(g.thermalUntil > g.t && !(gd.markedUntil > g.t) ? 0xff8a3a : 0xff4655);
    }

    // ---- flashlights (nearest guards with their torch on)
    const lit = g.guards.filter(gd => g.flashlightOn(gd)).sort((a, b) => dist(a.x, a.y, vp.x, vp.y) - dist(b.x, b.y, vp.x, vp.y)).slice(0, this.spots.length);
    this.spots.forEach((s, i) => {
      const gd = lit[i]; const beam = this.beams[i];
      if (!gd) { s.intensity = 0; beam.visible = false; return; }
      const hx = gd.x + Math.cos(gd.angle) * 0.6, hy = gd.y + Math.sin(gd.angle) * 0.6;
      s.position.set(hx, 1.35, hy);
      s.target.position.set(gd.x + Math.cos(gd.angle) * 6, 0.3, gd.y + Math.sin(gd.angle) * 6);
      s.intensity = gd.state === "COMBAT" ? 26 : 18;
      beam.visible = true;
      beam.position.set(hx, 1.35, hy);
      beam.lookAt(gd.x + Math.cos(gd.angle) * 6, 0.35, gd.y + Math.sin(gd.angle) * 6);
      (beam.material as THREE.MeshBasicMaterial).opacity = gd.state === "COMBAT" ? 0.07 : 0.045;
    });

    // ---- hostage
    if (g.hostage) {
      if (!this.hostageModel) { this.hostageModel = humanoid("hostage"); this.scene.add(this.hostageModel); }
      const h = g.hostage;
      this.hostageModel.visible = h.state !== "out";
      this.hostageModel.position.set(h.x, h.state === "held" ? -0.35 : 0, h.y);
      this.hostageModel.rotation.y = -Math.atan2(p.y - h.y, p.x - h.x);
    }

    // ---- interactables
    const t = g.t;
    for (const it of L.interactables) {
      const gone = it.done && !["locker", "alarmPanel", "secTerminal", "chargeSite"].includes(it.kind);
      let m = this.itemMeshes.get(it.id);
      if (!m && !gone) {
        m = this.itemMesh(it.kind, it.item) ?? undefined; if (!m) continue;
        const onProp = L.tiles[it.y * L.w + it.x] === T.PROP_LOW || L.tiles[it.y * L.w + it.x] === T.PROP_TALL;
        const wallMounted = it.kind === "alarmPanel";
        m.position.set(it.x + 0.5, wallMounted ? 1.45 : onProp ? (it.kind === "safe" || it.kind === "locker" ? 0.01 : 0.84) : 0.05, it.y + 0.5);
        if (wallMounted) { // push against the nearest wall
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (L.tiles[(it.y + dy) * L.w + it.x + dx] === T.WALL) { m.position.x += dx * 0.44; m.position.z += dy * 0.44; m.rotation.y = dx ? Math.PI / 2 : 0; break; }
        }
        this.scene.add(m); this.itemMeshes.set(it.id, m);
      }
      if (!m) continue;
      m.visible = !gone;
      if (it.kind === "objective" || it.kind === "evidence" || it.kind === "chargeSite") {
        const glow = m.getObjectByName("glow") as THREE.Mesh | undefined;
        if (glow) { glow.visible = !it.done; glow.rotation.y = t; (glow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(t * 3); }
        const blink = m.getObjectByName("blink") as THREE.Mesh | undefined;
        if (blink) { blink.visible = it.kind === "chargeSite" && it.done; (blink.material as THREE.MeshBasicMaterial).color.set(Math.sin(t * (g.charge && g.charge.t < 10 ? 20 : 8)) > 0 ? 0xff2a1a : 0x330505); }
      }
      if (it.kind === "loot" || it.kind === "keycard") {
        const near = dist(p.x, p.y, it.x + 0.5, it.y + 0.5) < 2.2;
        const glow = m.getObjectByName("glow") as THREE.Mesh | undefined;
        if (glow) glow.visible = near || !!(it.item && LOOT[it.item]?.rare);
      }
    }

    // ---- drones and breach charges
    g.drones.forEach((d, i) => {
      let m = this.droneMeshes[i];
      if (!m) {
        m = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.22), new THREE.MeshLambertMaterial({ color: 0x2b2f33 })); b.position.y = 0.1; m.add(b);
        for (const z of [-0.14, 0.14]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), new THREE.MeshLambertMaterial({ color: 0x111111 })); w.rotation.x = Math.PI / 2; w.position.set(0, 0.09, z); m.add(w); }
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), new THREE.MeshBasicMaterial({ color: 0x40ff90 })); eye.position.set(0.16, 0.12, 0); m.add(eye);
        this.scene.add(m); this.droneMeshes[i] = m;
      }
      m.visible = d.alive && g.droneIdx !== i;
      m.position.set(d.x, 0, d.y); m.rotation.y = -d.angle;
    });
    while (this.chargeMeshes.length < g.breachCharges.length) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.08), new THREE.MeshLambertMaterial({ color: 0x4a4a3a, emissive: 0x220000 }));
      this.scene.add(c); this.chargeMeshes.push(c);
    }
    this.chargeMeshes.forEach((c, i) => {
      const b = g.breachCharges[i]; c.visible = !!b; if (!b) return;
      c.position.set(b.x, 1.1, b.y); c.lookAt(p.x, 1.1, p.y);
      (c.material as THREE.MeshLambertMaterial).emissive.setHex(Math.sin(g.t * 18) > 0 ? 0xff2010 : 0x220000);
    });

    // ---- muzzle flashes
    const mz = g.muzzle && g.t - g.muzzle.t < 0.06;
    this.muzzleLight.intensity = mz ? (p.weapon === "pistol" ? 2 : 6) : 0;
    if (mz) this.muzzleLight.position.set(vp.x + Math.cos(vp.angle) * 0.6, vp.h - 0.1, vp.y + Math.sin(vp.angle) * 0.6);
    const ez = g.muzzleEnemy && g.t - g.muzzleEnemy.t < 0.06;
    this.enemyFlash.intensity = ez ? 7 : 0;
    if (ez && g.muzzleEnemy) this.enemyFlash.position.set(g.muzzleEnemy.x, 1.4, g.muzzleEnemy.y);

    // ---- bullet holes
    const fresh = g.impacts.filter(im => im.t > this.lastImpact);
    for (const im of fresh) {
      const k = this.holeCount % 160; this.holeCount++;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(im.nx, 0, im.ny).normalize());
      m4.compose(new THREE.Vector3(im.x + im.nx * 0.01, Math.max(0.1, Math.min(2.7, im.h)), im.y + im.ny * 0.01), q, new THREE.Vector3(1, 1, 1));
      this.holes.setMatrixAt(k, m4);
      this.lastImpact = Math.max(this.lastImpact, im.t);
    }
    if (fresh.length) { this.holes.count = Math.min(160, this.holeCount); this.holes.instanceMatrix.needsUpdate = true; }
    if (g.impacts.length > 40) g.impacts.splice(0, g.impacts.length - 40);

    // ---- sparks and dust
    const sp = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    let n = 0;
    for (const pt of g.particles) {
      if (n >= 600 || pt.kind === "blood") continue;
      sp.setXYZ(n++, pt.x, pt.kind === "dust" || pt.kind === "smoke" ? 0.3 + (1 - pt.life / pt.max) * 1.2 : 1.1 - (1 - pt.life / pt.max) * 0.9, pt.y);
    }
    for (let k = n; k < 600; k++) sp.setXYZ(k, 0, -50, 0);
    sp.needsUpdate = true;

    // ---- rain (only outdoors)
    const rp = this.rain.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i += 2) {
      let y = rp.getY(i) - dt * 11;
      let x = rp.getX(i), z = rp.getZ(i);
      if (y < 0 || Math.abs(x - vp.x) > 15 || Math.abs(z - vp.y) > 15) {
        y = 4 + Math.random() * 5; x = vp.x + Math.random() * 30 - 15; z = vp.y + Math.random() * 30 - 15;
        const tile = L.tiles[Math.floor(z) * L.w + Math.floor(x)];
        if (tile !== T.EXT) y = -60;
      }
      rp.setXYZ(i, x, y, z); rp.setXYZ(i + 1, x + 0.03, y + 0.45, z + 0.01);
    }
    rp.needsUpdate = true;

    // ---- render world
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // ---- viewmodel
    if (vp.kind === "operator" && p.hidden < 0 && g.status === "playing") {
      const key = g.equipped === "weapon" ? p.weapon : "gadget";
      for (const k in this.vm) this.vm[k].visible = k === key;
      const vm = this.vm[key];
      this.sway.x += (this.lookDelta.x * 0.0009 - this.sway.x) * Math.min(1, dt * 10);
      this.sway.y += (this.lookDelta.y * 0.0009 - this.sway.y) * Math.min(1, dt * 10);
      this.lookDelta.x = 0; this.lookDelta.y = 0;
      const reloadDip = p.reloadT > 0 ? Math.sin(Math.min(1, p.reloadT / 1.2) * Math.PI) * 0.18 : 0;
      const hip = new THREE.Vector3(0.17, -0.16, -0.4), aim = new THREE.Vector3(0, p.weapon === "pistol" ? -0.072 : -0.082, -0.3);
      const pos = hip.lerp(aim, this.adsT);
      const bx = moving ? Math.cos(this.bob * 0.5) * 0.012 : 0, by = moving ? Math.abs(Math.sin(this.bob * 0.5)) * 0.012 : 0;
      vm.position.set(pos.x + bx - this.sway.x, pos.y - by - reloadDip + this.sway.y - (p.sprint && p.moving && !p.crouch ? 0.06 : 0), pos.z + g.recoil * 0.05);
      vm.rotation.set(g.recoil * 0.12 + reloadDip * 1.2, -this.sway.x * 2, -g.lean * 0.1);
      this.vmAmbient.intensity = 0.9 + p.light * 0.8;
      this.vmKey.intensity = 1.1 + p.light * 0.6;
      this.vmMuzzle.intensity = mz ? 3 : 0; this.vmMuzzle.position.set(pos.x, pos.y + 0.05, pos.z - 0.45);
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  private itemMesh(kind: string, item?: string): THREE.Object3D | null {
    const grp = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: number, basic = false, y = 0, name?: string) => {
      const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }) : new THREE.MeshLambertMaterial({ color }));
      m.position.y = y; if (name) m.name = name; grp.add(m); return m;
    };
    const glowRing = (r: number, color = 0xffd98a) => { const ring = add(new THREE.TorusGeometry(r, 0.012, 6, 28), color, true, 0.08, "glow"); ring.rotation.x = Math.PI / 2; return ring; };
    switch (kind) {
      case "loot": {
        const d = item ? LOOT[item] : undefined;
        const c = d?.rare ? 0xd8b35a : item === "ammo" ? 0x6b6f4a : item === "medkit" ? 0xb8423a : item === "cash" || item === "gold" ? 0x6f8a5a : item === "docs" ? 0xd9d6cc : 0x8a939c;
        add(new THREE.BoxGeometry(0.26, item === "gold" ? 0.16 : 0.08, 0.2), c, false, 0.05);
        glowRing(0.24); return grp;
      }
      case "keycard": add(new THREE.BoxGeometry(0.1, 0.01, 0.07), 0x3f7dd6, false, 0.01); glowRing(0.15, 0x6fa0ff); return grp;
      case "objective": add(new THREE.BoxGeometry(0.34, 0.22, 0.26), 0xe8e0cc, false, 0.11); glowRing(0.36, 0xfff0d0); return grp;
      case "evidence": add(new THREE.BoxGeometry(0.3, 0.02, 0.22), 0xe8e0cc, false, 0.01); glowRing(0.3, 0xfff0d0); return grp;
      case "chargeSite": glowRing(0.45, 0xfff0d0); { const b = add(new THREE.SphereGeometry(0.06, 8, 8), 0x330505, false, 1.2, "blink"); b.material = new THREE.MeshBasicMaterial({ color: 0x330505 }); } return grp;
      case "alarmPanel": add(new THREE.BoxGeometry(0.4, 0.5, 0.1), 0x8e231c, false, 0); { const b = add(new THREE.BoxGeometry(0.12, 0.12, 0.12), 0xff4535, false, 0.05); b.material = new THREE.MeshBasicMaterial({ color: 0xff4535 }); } return grp;
      case "secTerminal": { const s = add(new THREE.BoxGeometry(0.6, 0.36, 0.04), 0x5ab0e0, false, 0.4); s.material = new THREE.MeshBasicMaterial({ color: 0x5ab0e0 }); } return grp;
      default: return null;
    }
  }
}

// merge BufferGeometries with identical attribute sets (position, normal, bake, color)
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "bake", "color"];
  const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  const arrays = names.map(() => new Float32Array(total * 3));
  const index: number[] = [];
  let off = 0;
  for (const g of geos) {
    names.forEach((n, k) => arrays[k].set((g.attributes[n] as THREE.BufferAttribute).array as Float32Array, off * 3));
    const idx = g.index!.array; for (let i = 0; i < idx.length; i++) index.push(idx[i] + off);
    off += g.attributes.position.count;
    g.dispose();
  }
  names.forEach((n, k) => out.setAttribute(n, new THREE.BufferAttribute(arrays[k], 3)));
  out.setIndex(index);
  return out;
}

export { EYE, PX };
