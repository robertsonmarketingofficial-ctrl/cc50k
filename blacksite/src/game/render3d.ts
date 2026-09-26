// First-person renderer (three.js). The simulation stays on the tile grid; this draws it as a daylit,
// physically lit place: sky + sun with soft shadows, image-based light, ambient occlusion, PBR surfaces.
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { LOOT, WEAPONS } from "./catalog";
import type { Game, Guard } from "./engine";
import { EYE } from "./engine";
import { WIND, buildGun, buildHand, buildSoldier, gripHand, M, poseSoldier, supportHand, type GunModel, type Soldier } from "./models";
import { dist } from "./rng";
import { PX } from "./render";
import { cedar } from "./textures";
import { THEMES, type Theme } from "./theme";
import type { Settings, WeaponId } from "./types";
import { T } from "./types";
import { resample, WorldBuilder, type WorldBuild } from "./world3d";
import { getAssets } from "./assets";
import { buildRigVM, EnemyActor, type RigVM } from "./actors";

function silhouette(src: THREE.Object3D, color: number, opacity: number): THREE.Object3D {
  const s = src.clone(true);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
  s.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.material = m; mesh.renderOrder = 10; mesh.castShadow = false; } });
  s.visible = false;
  return s;
}

/** capsule limb between two points */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len), 6, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// ------------------------------------------------------------------------------------------------ viewmodels
export interface VM { root: THREE.Group; gun: GunModel | null; hip: THREE.Vector3; ads: THREE.Vector3; muzzle: THREE.Vector3; pump?: THREE.Object3D }

export function weaponVM(id: WeaponId): VM {
  const root = new THREE.Group();
  const holder = new THREE.Group(); holder.rotation.y = Math.PI / 2; root.add(holder); // gun +x -> camera -z
  const gun = buildGun(id); holder.add(gun);
  const u = gun.userData;
  const sleeve = M.sleeve();
  const { hand: rh, wrist: rw } = gripHand(gun); holder.add(rh);
  const rElbow = new THREE.Vector3(u.grip.x - 0.3, u.grip.y - 0.2, 0.17);
  holder.add(limb(rw, rElbow, 0.042, sleeve)); holder.add(new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), sleeve).translateX(rElbow.x).translateY(rElbow.y).translateZ(rElbow.z));
  holder.add(limb(rElbow, rElbow.clone().add(new THREE.Vector3(-0.28, -0.1, 0.1)), 0.054, sleeve));
  if (u.pistol) {
    // support hand cups the firing hand
    const lh = buildHand(-1, 1.6); lh.position.copy(u.grip).add(new THREE.Vector3(0.004, -0.025, -0.034)); lh.rotation.set(0.3, 0.2, u.gripTilt); holder.add(lh);
    const lw = u.grip.clone().add(new THREE.Vector3(-0.05, -0.07, -0.05)), le = new THREE.Vector3(u.grip.x - 0.27, u.grip.y - 0.22, -0.2);
    holder.add(limb(lw, le, 0.042, sleeve)); holder.add(limb(le, le.clone().add(new THREE.Vector3(-0.28, -0.1, -0.08)), 0.054, sleeve));
  } else {
    const { hand: lh, wrist: lw } = supportHand(gun); holder.add(lh);
    const le = new THREE.Vector3(u.fore.x - 0.3, u.fore.y - 0.25, -0.16);
    holder.add(limb(lw, le, 0.042, sleeve)); holder.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), sleeve).translateX(le.x).translateY(le.y).translateZ(le.z));
    holder.add(limb(le, le.clone().add(new THREE.Vector3(-0.28, -0.08, -0.08)), 0.054, sleeve));
  }
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  const pistol = u.pistol;
  // camera-space positions: at the hip the gun sits low right; aiming puts the sight line on the camera axis
  const hip = new THREE.Vector3(pistol ? 0.12 : 0.135, pistol ? -0.14 : -0.125 - u.sightY * 0.6, pistol ? -0.4 : -0.33);
  const ads = new THREE.Vector3(0, -u.sightY, pistol ? -0.3 : -0.16 + (u.stockX + 0.36) * 0.2);
  const muzzle = new THREE.Vector3(0, u.muzzle.y, -u.muzzle.x);
  return { root, gun, hip, ads, muzzle, pump: gun.getObjectByName("pump") ?? undefined };
}

function gadgetVM(kind: "gadget" | "drone"): VM {
  const root = new THREE.Group();
  const holder = new THREE.Group(); holder.rotation.y = Math.PI / 2; root.add(holder);
  if (kind === "drone") {
    // rugged tablet in both hands
    const tab = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.2, 0.02, 2, 0.008), M.polymer()); tab.rotation.set(0, Math.PI / 2, -0.9); tab.position.set(0.02, -0.02, 0); holder.add(tab);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.17), new THREE.MeshBasicMaterial({ color: 0x2a6048 })); scr.position.set(0.02 - 0.011 * Math.sin(0.9), -0.02 + 0.011 * Math.cos(0.9), 0); scr.rotation.set(0, Math.PI / 2, -0.9); scr.rotateY(-Math.PI); scr.rotateY(Math.PI); holder.add(scr);
    for (const s of [1, -1]) { const h = buildHand(s as 1 | -1, 0.6); h.position.set(0.0, -0.05, s * 0.1); h.rotation.set(s * 0.4, 0, 0.6); holder.add(h); holder.add(limb(new THREE.Vector3(-0.06, -0.08, s * 0.1), new THREE.Vector3(-0.32, -0.28, s * 0.22), 0.043, M.sleeve())); }
  } else {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.11, 16), new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.6 })); g.position.set(0.02, 0.03, 0); holder.add(g);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), M.steel()); cap.position.set(0.02, 0.1, 0); holder.add(cap);
    const h = buildHand(1, 1.15); h.position.set(-0.02, 0, 0.02); holder.add(h);
    holder.add(limb(new THREE.Vector3(-0.08, -0.02, 0.03), new THREE.Vector3(-0.34, -0.24, 0.2), 0.043, M.sleeve()));
  }
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = false; });
  return { root, gun: null, hip: new THREE.Vector3(0.14, -0.15, -0.32), ads: new THREE.Vector3(0.14, -0.15, -0.32), muzzle: new THREE.Vector3() };
}

function flashTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,250,220,1)"); g.addColorStop(0.25, "rgba(255,200,110,0.9)"); g.addColorStop(1, "rgba(255,120,30,0)");
  x.fillStyle = g; x.translate(64, 64);
  for (let k = 0; k < 6; k++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(-6, 0); x.lineTo(0, -62); x.lineTo(6, 0); x.fill(); }
  x.beginPath(); x.arc(0, 0, 28, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** high cirrus/cumulus layer: a big textured plane far overhead, fading to the horizon */
function cloudLayer(): THREE.Mesh {
  const S = 1024, c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d")!;
  const img = x.createImageData(S, S);
  const grid = (g: number) => { const a = new Float32Array((g + 1) * (g + 1)); for (let i = 0; i < a.length; i++) a[i] = Math.random(); for (let i = 0; i <= g; i++) { a[i * (g + 1) + g] = a[i * (g + 1)]; a[g * (g + 1) + i] = a[i]; } return a; };
  const octs = [4, 8, 16, 32, 64].map(g => ({ g, a: grid(g) }));
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    let v = 0, amp = 1, tot = 0;
    for (const { g, a } of octs) { const fx = (xx / S) * g, fy = (yy / S) * g, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const p0 = a[iy * (g + 1) + ix], p1 = a[iy * (g + 1) + ix + 1], p2 = a[(iy + 1) * (g + 1) + ix], p3 = a[(iy + 1) * (g + 1) + ix + 1];
      v += ((p0 + (p1 - p0) * sx) * (1 - sy) + (p2 + (p3 - p2) * sx) * sy) * amp; tot += amp; amp *= 0.55; }
    v /= tot; const d = Math.max(0, (v - 0.52) * 3.2);
    const rr = Math.hypot(xx / S - 0.5, yy / S - 0.5) * 2, fade = Math.max(0, 1 - rr) ** 1.6;
    const i = (yy * S + xx) * 4; img.data[i] = 255; img.data[i + 1] = 250 - d * 20; img.data[i + 2] = 240 - d * 30; img.data[i + 3] = Math.min(235, d * 255) * fade;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, color: 0xfff8ee }));
  m.rotation.x = Math.PI / 2; m.position.y = 650; m.renderOrder = -1; m.name = "clouds";
  m.onBeforeRender = (_r, _s, cam) => { m.position.x = cam.position.x; m.position.z = cam.position.z; t.offset.x = performance.now() / 1e6; };
  return m;
}

/** display-space grade: gentle S-curve, saturation, warm highlights / cool shadows, vignette */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uWarm: { value: 1.0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uWarm; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.14);                                   // saturation
      c = c + (c - 0.5) * 0.16 * (1.0 - abs(c - 0.5) * 2.0);        // S-curve contrast
      c += vec3(0.035, 0.018, 0.0) * (1.0 - smoothstep(0.0, 0.45, l)); // warm lifted shadows
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.07, 1.0, 0.9), smoothstep(0.15, 0.85, l) * uWarm); // split tone: cool shade, amber light
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.55;             // vignette
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// ------------------------------------------------------------------------------------------------ renderer
export class FPRenderer {
  canvas: HTMLCanvasElement; game: Game; settings: Settings; theme: Theme;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 2500);
  vmScene = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(66, 16 / 9, 0.01, 5);
  composer: EffectComposer | null = null;
  gtao: GTAOPass | null = null;
  private vmPass: RenderPass | null = null;
  private world!: WorldBuild;
  private builder!: WorldBuilder;
  private lightVersion = -1;
  private levelVersion = -1;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private doorMeshes: THREE.Group[] = [];
  private guardModels = new Map<number, { g: Soldier; sil: THREE.Object3D; walk: number; lx: number; ly: number }>();
  private hostageModel: Soldier | null = null;
  private camMeshes: THREE.Group[] = [];
  private fixtureMeshes: { mesh: THREE.Mesh; id: number; light?: THREE.PointLight }[] = [];
  private itemMeshes = new Map<number, THREE.Object3D>();
  private droneMeshes: THREE.Group[] = [];
  private chargeMeshes: THREE.Mesh[] = [];
  private spots: THREE.SpotLight[] = [];
  private muzzleLight = new THREE.PointLight(0xffd9a0, 0, 7, 1.6);
  private enemyFlash = new THREE.PointLight(0xffb070, 0, 8, 1.6);
  private sparks!: THREE.Points;
  private motes!: THREE.Points; private moteVel!: Float32Array;
  private holes!: THREE.InstancedMesh;
  private holeCount = 0; private lastImpact = 0;
  private vm: Record<string, VM> = {};
  private rigs: Record<string, RigVM> = {};
  private actors = new Map<number, { a: EnemyActor; lx: number; ly: number; spd: number }>();
  private silMat = new THREE.MeshBasicMaterial({ color: 0xff4655, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
  private lastReload = 0;
  private vmHemi = new THREE.HemisphereLight(0xdfe8f5, 0x8a6a4a, 1.0);
  private vmSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  private vmMuzzle = new THREE.PointLight(0xffc880, 0, 1.5);
  private vmRim = new THREE.DirectionalLight(0xfff4e6, 0.9);
  private pools: THREE.PointLight[] = [];
  private flash!: THREE.Sprite;
  private bob = 0; private sway = { x: 0, y: 0 }; private adsT = 0; private pumpT = 0; private lastShot = 0; private lastRigShot = 0; private sprintT = 0;
  private sunDir = new THREE.Vector3();
  private exposure = 1;
  lookDelta = { x: 0, y: 0 };
  exposureSnap = false;
  extraction!: THREE.Group;

  constructor(canvas: HTMLCanvasElement, game: Game, settings: Settings) {
    this.canvas = canvas; this.game = game; this.settings = settings;
    this.theme = THEMES[game.level.facility];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.theme.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.camera.rotation.order = "YXZ";
    this.buildSky();
    this.scene.add(this.muzzleLight, this.enemyFlash);
    this.build();
    // viewmodels share the world's sun direction and environment so metal and cloth match the scene
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmMuzzle, this.vmRim); this.vmRim.position.set(-0.6, 0.9, -1.2);
    const assets = getAssets();
    for (const k of Object.keys(WEAPONS) as WeaponId[]) {
      if (assets && !WEAPONS[k].slot.includes("secondary") && k !== "p226" && k !== "g17") { const r = buildRigVM(assets, k); r.root.visible = false; this.rigs[k] = r; this.vmScene.add(r.root); continue; }
      this.vm[k] = weaponVM(k); this.vm[k].root.visible = false; this.vmScene.add(this.vm[k].root);
    }
    for (const k of ["gadget", "drone"] as const) { this.vm[k] = gadgetVM(k); this.vm[k].root.visible = false; this.vmScene.add(this.vm[k].root); }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.12); this.flash.visible = false; this.vmScene.add(this.flash);
    this.setupComposer();
  }

  private buildSky() {
    const th = this.theme;
    const sky = new Sky(); sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = th.sky.turbidity; u.rayleigh.value = th.sky.rayleigh; u.mieCoefficient.value = th.sky.mie; u.mieDirectionalG.value = th.sky.mieG;
    const phi = THREE.MathUtils.degToRad(90 - th.sun.elevation), theta = THREE.MathUtils.degToRad(th.sun.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
    this.scene.add(cloudLayer());
    // image-based light from the same sky
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); for (const k of Object.keys(u)) (sky2.material.uniforms[k].value as unknown) = u[k].value; envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(th.exterior.ground).multiplyScalar(0.55) })); ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
    const hdr = getAssets()?.hdr;
    const env = hdr ? pm.fromEquirectangular(hdr).texture : pm.fromScene(envScene, 0.02).texture;
    this.scene.environment = env; this.scene.environmentIntensity = hdr ? 0.9 : 0.55;
    this.vmScene.environment = env; this.vmScene.environmentIntensity = 0.6;
    pm.dispose();
    this.scene.fog = new THREE.Fog(new THREE.Color(th.fog.color).lerp(new THREE.Color(0xe4e0d6), 0.55), th.fog.near, th.fog.far);
    this.hemi = new THREE.HemisphereLight(th.hemi.sky, th.hemi.ground, th.hemi.intensity);
    this.scene.add(this.hemi);
    const L = this.game.level;
    this.sun = new THREE.DirectionalLight(th.sun.color, th.sun.intensity);
    const c = new THREE.Vector3(L.w / 2, 0, L.h / 2 - 4);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 120); this.sun.target.position.copy(c);
    this.sun.castShadow = true;
    const S = this.sun.shadow; S.mapSize.set(4096, 4096);
    const half = Math.max(L.w, L.h + 20) / 2 + 12;
    const cam = S.camera as THREE.OrthographicCamera; cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 10; cam.far = 300;
    S.bias = -0.0003; S.normalBias = 0.035; S.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);
  }

  private setupComposer() {
    if (!this.settings.effects) { this.composer = null; return; }
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const comp = new EffectComposer(this.renderer, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new GTAOPass(this.scene, this.camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.6;
    gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.0, thickness: 5.0, scale: 3.4, samples: 16, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    comp.addPass(gtao); this.gtao = gtao;
    const vmPass = new RenderPass(this.vmScene, this.vmCamera); vmPass.clear = false; vmPass.clearDepth = true; this.vmPass = vmPass;
    comp.addPass(vmPass);
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.35, 3.0));
    comp.addPass(new OutputPass());
    comp.addPass(new ShaderPass(GradeShader));
    this.composer = comp;
  }

  dispose() {
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach(x => x.dispose()); } });
    this.composer?.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------------------------------------- build
  private lightBase = (i: number) => (this.game.level.tiles[i] === T.EXT ? this.game.lightBaseExt : this.game.lightBaseInt);

  private build() {
    const L = this.game.level;
    this.builder = new WorldBuilder(L, this.theme, this.game.lightmap, this.lightBase);
    this.world = this.builder.build();
    this.scene.add(this.world.root);
    this.lightVersion = this.game.lightVersion; this.levelVersion = L.version;

    // lanterns for every light in the simulation (they go dark when shot or cut)
    const IH = this.theme.interiorH;
    const lanternFrame = M.brass();
    for (const l of L.lights) {
      const glow = new THREE.MeshStandardMaterial({ color: 0xffe6c0, emissive: new THREE.Color(l.color), emissiveIntensity: 1.6, roughness: 0.4 });
      const g = new THREE.Group();
      if (l.room < 0) {
        // cast-iron street lantern
        const iron = new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.5, metalness: 0.6 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.6, 12), iron); base.position.y = 0.3; g.add(base);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 3.3, 12), iron); post.position.y = 2.2; g.add(post);
        for (const y of [0.62, 3.2]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 16), iron); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); }
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.42, 6), glow); lamp.position.y = 4.05; g.add(lamp);
        const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 0.44, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f2a24, metalness: 0.6, roughness: 0.5, wireframe: true })); cage.position.y = 4.05; g.add(cage);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.26, 6), iron); cap.position.y = 4.39; g.add(cap);
        const fin = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), iron); fin.position.y = 4.55; g.add(fin);
        g.traverse(o => { o.castShadow = true; });
        g.position.set(l.x, 0, l.y); this.scene.add(g); this.fixtureMeshes.push({ mesh: lamp, id: l.id });
        continue;
      }
      // Moroccan brass lantern on a chain: amber glass panes in a solid frame, pierced cap
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), lanternFrame); chain.position.y = IH - 0.25; g.add(chain);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.34, 8), glow); body.position.y = IH - 0.7; g.add(body);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; const bar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.36, 0.018), lanternFrame); bar.position.set(Math.cos(a) * 0.14, IH - 0.7, Math.sin(a) * 0.14); bar.rotation.set(Math.sin(a) * 0.11, 0, -Math.cos(a) * 0.11); g.add(bar); }
      for (const [y, r] of [[IH - 0.52, 0.16], [IH - 0.88, 0.12]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 16), lanternFrame); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring); }
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.18, 0.2, 8), lanternFrame); top.position.y = IH - 0.43; g.add(top);
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.12, 8), lanternFrame); bottom.rotation.x = Math.PI; bottom.position.y = IH - 0.93; g.add(bottom);
      g.position.set(l.x, 0, l.y); this.scene.add(g);
      this.fixtureMeshes.push({ mesh: body, id: l.id });
    }

    // doors: studded cedar
    const doorMat = new THREE.MeshStandardMaterial({ map: cedar().map, normalMap: cedar().normalMap, roughness: 0.6 });
    for (const d of L.doors) {
      const pivot = new THREE.Group();
      const slab = new THREE.Mesh(new RoundedBoxGeometry(0.96, 2.18, 0.07, 2, 0.01), doorMat); slab.position.set(0.48, 1.09, 0); slab.castShadow = true; slab.receiveShadow = true; pivot.add(slab);
      for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), M.brass()); h.position.set(0.82, 1.05, s * 0.045); pivot.add(h); }
      if (d.lock) { const pad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: d.lock === 2 ? 0xc9372c : 0x3f7dd6, emissiveIntensity: 0.9 })); pad.position.set(0.86, 1.3, 0); pad.name = "pad"; pivot.add(pad); }
      if (d.vertical) { pivot.position.set(d.x + 0.5, 0, d.y); pivot.rotation.y = -Math.PI / 2; }
      else { pivot.position.set(d.x, 0, d.y + 0.5); }
      pivot.userData = { base: pivot.rotation.y, t: d.open ? 1 : 0 };
      this.scene.add(pivot); this.doorMeshes.push(pivot);
    }

    // CCTV cameras: white housing, sunshield, wall bracket
    for (const c of L.cameras) {
      const g = new THREE.Group();
      const housing = new THREE.MeshStandardMaterial({ color: c.hardened ? 0x6a766f : 0xe8e8e2, roughness: 0.4 });
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.12, 0.13, 2, 0.03), housing); body.position.x = 0.12; body.castShadow = true; g.add(body);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.17), housing); shield.position.set(0.14, 0.075, 0); g.add(shield);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), M.lens()); lens.rotation.y = Math.PI / 2; lens.position.x = 0.291; g.add(lens);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), housing); arm.position.set(-0.06, 0.05, 0); arm.rotation.z = 1.1; g.add(arm);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a20 })); led.position.set(0.26, 0.04, 0.05); led.name = "led"; g.add(led);
      g.position.set(c.x, 2.85, c.y); this.scene.add(g); this.camMeshes.push(g);
    }

    // extraction vehicle: dusty white pickup
    const van = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.35, metalness: 0.4 });
    const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; van.add(m); return m; };
    add(new THREE.Mesh(new RoundedBoxGeometry(5.2, 0.8, 1.9, 3, 0.12), paint), 0, 0.85, 0);
    add(new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.85, 1.8, 3, 0.18), paint), -0.6, 1.62, 0);
    add(new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.62, 1.82, 2, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a232b, roughness: 0.05, metalness: 0.8 })), -0.6, 1.66, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.7), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 })), 1.35, 1.2, 0).scale.set(1, 0.3, 1);
    for (const [x, z] of [[-1.65, 0.86], [1.6, 0.86], [-1.65, -0.86], [1.6, -0.86]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 })); w.rotation.x = Math.PI / 2; add(w, x, 0.42, z);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 16), M.alu()); hub.rotation.x = Math.PI / 2; add(hub, x, 0.42, z);
    }
    for (const z of [-0.7, 0.7]) { add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0x440000 })), 2.6, 1.0, z); add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.34), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x777766 })), -2.6, 1.0, z); }
    van.position.set(L.extraction.x, 0, L.extraction.y); van.rotation.y = Math.PI / 2; this.scene.add(van); this.extraction = van;

    // sun shafts: dusty light volumes through doorways that face the sun
    {
      const Ld = this.sunDir.clone().negate().normalize(); // direction light travels
      const mat = new THREE.ShaderMaterial({
        uniforms: { uCol: { value: new THREE.Color(0xffd9a8) } },
        vertexShader: "attribute float a; varying float vA; varying vec3 vW; void main(){ vA = a; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }",
        fragmentShader: "uniform vec3 uCol; varying float vA; varying vec3 vW; void main(){ float n = 0.75 + 0.25 * sin(vW.x * 7.0 + vW.z * 5.0) * sin(vW.y * 9.0); gl_FragColor = vec4(uCol * vA * 0.16 * n, 1.0); }",
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const tile = (x: number, y: number) => (x < 0 || y < 0 || x >= L.w || y >= L.h ? T.EXT : L.tiles[y * L.w + x]);
      for (const d of L.doors) {
        if (!d.rooms.includes(-1)) continue;
        const [nx, nz] = d.vertical ? (tile(d.x - 1, d.y) === T.EXT ? [-1, 0] : [1, 0]) : (tile(d.x, d.y - 1) === T.EXT ? [0, -1] : [0, 1]);
        if (-(Ld.x * nx + Ld.z * nz) < 0.15) continue; // light must travel inward
        const H = 2.15, inner = 0.5; // start at the inner face of the doorway
        const cx = d.x + 0.5 - nx * inner, cz = d.y + 0.5 - nz * inner;
        const tx = nz !== 0 ? 1 : 0, tz = nx !== 0 ? 1 : 0; // along the opening
        const BL = new THREE.Vector3(cx - tx * 0.48, 0.02, cz - tz * 0.48), BR = new THREE.Vector3(cx + tx * 0.48, 0.02, cz + tz * 0.48);
        const TL = BL.clone().setY(H), TR = BR.clone().setY(H);
        const k = H / -Ld.y, PTL = TL.clone().addScaledVector(Ld, k), PTR = TR.clone().addScaledVector(Ld, k);
        const pts = [BL, TL, PTL, BR, TR, PTR, TL, TR, PTR, TL, PTR, PTL];
        const al = [0.9, 1, 0.15, 0.9, 1, 0.15, 1, 1, 0.15, 1, 0.15, 0.15];
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap(p => p.toArray()), 3)); geo.setAttribute("a", new THREE.Float32BufferAttribute(al, 1));
        const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5; this.scene.add(m);
      }
    }
    // light pools under the nearest lanterns (the baked light map carries the rest)
    for (let i = 0; i < 4; i++) { const pl = new THREE.PointLight(new THREE.Color(this.theme.lampColor), 0, 7, 2); this.scene.add(pl); this.pools.push(pl); }
    // guard flashlights (only in dark rooms or when searching)
    for (let i = 0; i < 3; i++) { const s = new THREE.SpotLight(0xfff1d6, 0, 14, 0.36, 0.5, 1.3); this.scene.add(s, s.target); this.spots.push(s); }

    // floating dust motes: soft sprites drifting in the air around the camera, catching the light
    {
      const N = 700, pos = new Float32Array(N * 3), size = new Float32Array(N); this.moteVel = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 14, Math.random() * 3.4, (Math.random() - 0.5) * 14], i * 3); size[i] = 0.5 + Math.random(); this.moteVel.set([(Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.06], i * 3); }
      const mg = new THREE.BufferGeometry(); mg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); mg.setAttribute("size", new THREE.BufferAttribute(size, 1));
      const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d")!; const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,244,225,1)"); gr.addColorStop(0.4, "rgba(255,236,205,0.45)"); gr.addColorStop(1, "rgba(255,230,200,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const mm = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, uBright: { value: 1 }, uScale: { value: 300 } },
        vertexShader: "attribute float size; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; gl_PointSize = size * uScale * 0.012 / max(0.2, d); vA = smoothstep(0.25, 1.2, d) * (1.0 - smoothstep(4.0, 7.0, d)); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "uniform sampler2D map; uniform float uBright; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(t.rgb * uBright, t.a * vA * 0.55); }",
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.motes = new THREE.Points(mg, mm); this.motes.frustumCulled = false; this.scene.add(this.motes);
    }
    // dust, sparks
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffc880, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false; this.scene.add(this.sparks);
    this.holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.03, 8), new THREE.MeshStandardMaterial({ color: 0x1a140e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }), 160);
    this.holes.count = 0; this.scene.add(this.holes);
  }

  private relight() {
    for (const m of this.world.meshes) resample(m, this.builder.sampler);
    this.lightVersion = this.game.lightVersion;
  }
  private rebuildWalls() {
    this.world.root.remove(this.world.walls);
    this.world.walls.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.world.meshes = this.world.meshes.filter(m => !this.world.walls.children.includes(m));
    this.world.walls = this.builder.buildWalls();
    this.world.root.add(this.world.walls);
    this.world.walls.children.forEach(c => this.world.meshes.push(c as THREE.Mesh));
    this.levelVersion = this.game.level.version;
  }

  // ---------------------------------------------------------------------------------------------- per frame
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.vmCamera.aspect = w / h;
      this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
      this.composer?.setSize(w, h);
    }
  }

  draw(dt: number) {
    const g = this.game, L = g.level, p = g.player;
    this.resize();
    if (!this.canvas.clientWidth) return;
    if (L.version !== this.levelVersion) this.rebuildWalls();
    if (g.lightVersion !== this.lightVersion) this.relight();

    // ---- camera
    const vp = g.viewpoint();
    const ads = g.input.ads && vp.kind === "operator" && p.reloadT <= 0 && g.equipped === "weapon";
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    const moving = vp.kind === "operator" && p.moving;
    this.bob += dt * (moving ? (p.sprint && !p.crouch ? 13 : p.crouch ? 6 : 9) : 0);
    const bobY = moving ? Math.sin(this.bob) * (p.sprint ? 0.04 : 0.02) * (1 - this.adsT * 0.8) : 0;
    const shake = this.settings.shake ? g.shake * 0.08 : 0;
    const pitch = g.input.pitch + g.recoil * 0.035 + (Math.random() - 0.5) * shake;
    this.camera.position.set(vp.x, vp.h + bobY, vp.y);
    const yaw = vp.angle + (Math.random() - 0.5) * shake;
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
    if (vp.kind === "operator") this.camera.rotateZ(-g.lean * 0.14);
    const wdef = WEAPONS[p.weapon as WeaponId];
    const baseFov = (vp.kind === "drone" ? 92 : vp.kind === "camera" ? 72 : 78) + (vp.kind === "operator" ? this.sprintT * 7 : 0);
    const fov = baseFov - (wdef?.ads ?? 16) * this.adsT; // catalog ads = degrees of zoom
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // exposure adapts between the sunlit yard and interiors
    const ti = Math.floor(vp.y) * L.w + Math.floor(vp.x);
    const inside = L.tiles[ti] !== T.EXT;
    const targetExp = this.theme.exposure * (inside ? 1.6 : 1) * (vp.kind === "camera" ? 1.1 : 1);
    this.exposure += (targetExp - this.exposure) * Math.min(1, dt * 1.6);
    if (this.exposureSnap) this.exposure = targetExp; // dev captures run at a few fps; skip the adaptation
    this.renderer.toneMappingExposure = this.exposure;

    // lockdown: red strobe on lanterns
    const lock = g.alert === 3;

    // ---- fixtures
    for (const f of this.fixtureMeshes) {
      const l = L.lights[f.id];
      const off = !l.on || l.offUntil > g.t;
      const flick = l.flicker && Math.sin(g.t * 13 + l.id * 7) > 0.93;
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = off || flick ? 0.02 : lock ? 1.2 + Math.sin(g.t * 6) : l.room < 0 ? 0.35 : 1.6;
      mat.emissive.set(lock ? 0xff3322 : l.color);
    }

    // ---- lantern pools: the four nearest working interior lights
    const near = L.lights.filter(l => l.room >= 0 && l.on && l.offUntil <= g.t).map(l => ({ l, d: dist(l.x, l.y, vp.x, vp.y) })).filter(o => o.d < 16).sort((a, b) => a.d - b.d).slice(0, this.pools.length);
    this.pools.forEach((pl, i) => { const o = near[i]; if (!o) { pl.intensity = 0; return; } pl.position.set(o.l.x, this.theme.interiorH - 0.85, o.l.y); pl.intensity = (lock ? 5 : 11) * o.l.i; pl.color.set(lock ? 0xff3322 : o.l.color); });

    // ---- doors
    L.doors.forEach((d, i) => {
      const m = this.doorMeshes[i]; const ud = m.userData as { base: number; t: number };
      ud.t += ((d.open ? 1 : 0) - ud.t) * Math.min(1, dt * 9);
      m.rotation.y = ud.base + ud.t * (Math.PI / 2) * 0.95;
      const pad = m.getObjectByName("pad") as THREE.Mesh | undefined;
      if (pad) (pad.material as THREE.MeshStandardMaterial).emissive.set(d.lock === 2 ? 0xc9372c : d.lock === 1 ? 0x3f7dd6 : 0x3fae5a);
    });

    // ---- cameras
    L.cameras.forEach((c, i) => {
      const m = this.camMeshes[i];
      m.visible = c.state !== "destroyed" && !(vp.kind === "camera" && g.camView === i);
      m.rotation.y = -c.angle; m.rotation.z = -0.3;
      const led = m.getObjectByName("led") as THREE.Mesh;
      (led.material as THREE.MeshBasicMaterial).color.set(c.state === "active" ? (Math.sin(g.t * 4 + c.id) > 0 ? 0xff2a20 : 0x3a0806) : c.state === "emp" ? 0x5d8fd0 : c.state === "looped" ? 0x2f7a4a : 0x111111);
    });

    // ---- guards
    const marked = (gd: Guard) => gd.markedUntil > g.t || (g.thermalUntil > g.t && dist(gd.x, gd.y, p.x, p.y) < 18);
    const assets = getAssets();
    for (const gd of g.guards) {
      const tint = g.thermalUntil > g.t && !(gd.markedUntil > g.t) ? 0xff8a3a : 0xff4655;
      if (assets) {
        let e = this.actors.get(gd.id);
        if (!e) {
          const kind = gd.kind === "contractor" ? "contractor" : gd.kind === "chief" ? "chief" : "guard";
          const a = new EnemyActor(assets, kind, gd.id, this.silMat); this.scene.add(a.root);
          e = { a, lx: gd.x, ly: gd.y, spd: 0 }; this.actors.set(gd.id, e);
        }
        const moved = dist(e.lx, e.ly, gd.x, gd.y); e.lx = gd.x; e.ly = gd.y;
        e.spd += (Math.min(5, moved / Math.max(dt, 1e-3)) - e.spd) * Math.min(1, dt * 8);
        const r = e.a.root; r.position.set(gd.x, 0, gd.y);
        if (gd.down) { r.rotation.set(0, -gd.angle, Math.PI / 2); r.position.y = 0.25; }
        else { r.rotation.set(0, -gd.angle, 0); e.a.update(dt, e.spd, gd.state === "COMBAT" || gd.state === "SEARCHING" || gd.state === "ALERT"); }
        const show = !gd.down && marked(gd);
        for (const sm of e.a.silhouettes) sm.visible = show;
        this.silMat.color.set(tint);
        continue;
      }
      let e = this.guardModels.get(gd.id);
      if (!e) {
        const kind = gd.kind === "contractor" ? "contractor" : gd.kind === "chief" ? "chief" : "guard";
        const model = buildSoldier(kind); const sil = silhouette(model, 0xff4655, 0.5);
        this.scene.add(model, sil);
        e = { g: model, sil, walk: 0, lx: gd.x, ly: gd.y }; this.guardModels.set(gd.id, e);
      }
      const moved = dist(e.lx, e.ly, gd.x, gd.y); e.lx = gd.x; e.ly = gd.y;
      e.walk += moved * 4.2;
      const amt = Math.min(1, moved / Math.max(dt, 1e-3) / 1.4);
      for (const m of [e.g, e.sil]) {
        m.position.set(gd.x, 0, gd.y);
        if (gd.down) { m.rotation.set(0, -gd.angle, Math.PI / 2); m.position.y = 0.2; }
        else m.rotation.set(0, -gd.angle, 0);
      }
      if (!gd.down) poseSoldier(e.g, e.walk, amt, gd.state === "COMBAT" || gd.state === "SEARCHING" || gd.state === "ALERT", dt);
      e.sil.visible = !gd.down && marked(gd);
      e.sil.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) (mm.material as THREE.MeshBasicMaterial).color.set(tint); });
    }

    // ---- flashlights
    const lit = g.guards.filter(gd => g.flashlightOn(gd) && L.tiles[Math.floor(gd.y) * L.w + Math.floor(gd.x)] !== T.EXT).sort((a, b) => dist(a.x, a.y, vp.x, vp.y) - dist(b.x, b.y, vp.x, vp.y)).slice(0, this.spots.length);
    this.spots.forEach((s, i) => {
      const gd = lit[i];
      if (!gd) { s.intensity = 0; return; }
      const hx = gd.x + Math.cos(gd.angle) * 0.6, hy = gd.y + Math.sin(gd.angle) * 0.6;
      s.position.set(hx, 1.35, hy);
      s.target.position.set(gd.x + Math.cos(gd.angle) * 6, 0.3, gd.y + Math.sin(gd.angle) * 6);
      s.intensity = gd.state === "COMBAT" ? 22 : 14;
    });

    // ---- hostage
    if (g.hostage) {
      if (!this.hostageModel) { this.hostageModel = buildSoldier("hostage"); this.scene.add(this.hostageModel); }
      const h = g.hostage;
      this.hostageModel.visible = h.state !== "out";
      this.hostageModel.position.set(h.x, h.state === "held" ? -0.4 : 0, h.y);
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
        m.position.set(it.x + 0.5, wallMounted ? 1.45 : onProp ? (it.kind === "safe" || it.kind === "locker" ? 0.01 : 0.79) : 0.02, it.y + 0.5);
        if (wallMounted) {
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (L.tiles[(it.y + dy) * L.w + it.x + dx] === T.WALL) { m.position.x += dx * 0.44; m.position.z += dy * 0.44; m.rotation.y = dx ? Math.PI / 2 : 0; break; }
        }
        this.scene.add(m); this.itemMeshes.set(it.id, m);
      }
      if (!m) continue;
      m.visible = !gone;
      if (it.kind === "objective" || it.kind === "evidence" || it.kind === "chargeSite") {
        const glow = m.getObjectByName("glow") as THREE.Mesh | undefined;
        if (glow) { glow.visible = !it.done; glow.rotation.z = t; (glow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(t * 3); }
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
        const b = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.08, 0.2, 2, 0.02), M.polymer()); b.position.y = 0.1; m.add(b);
        for (const z of [-0.14, 0.14]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 16), M.rubber()); w.rotation.x = Math.PI / 2; w.position.set(0, 0.085, z); m.add(w); }
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), M.lens()); eye.position.set(0.15, 0.12, 0); m.add(eye);
        m.traverse(o => { o.castShadow = true; });
        this.scene.add(m); this.droneMeshes[i] = m;
      }
      m.visible = d.alive && g.droneIdx !== i;
      m.position.set(d.x, 0, d.y); m.rotation.y = -d.angle;
    });
    while (this.chargeMeshes.length < g.breachCharges.length) {
      const c = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.5, 0.08, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x5a5a48, emissive: 0x220000, roughness: 0.8 }));
      this.scene.add(c); this.chargeMeshes.push(c);
    }
    this.chargeMeshes.forEach((c, i) => {
      const b = g.breachCharges[i]; c.visible = !!b; if (!b) return;
      c.position.set(b.x, 1.1, b.y); c.lookAt(p.x, 1.1, p.y);
      (c.material as THREE.MeshStandardMaterial).emissive.setHex(Math.sin(g.t * 18) > 0 ? 0xff2010 : 0x220000);
    });

    // ---- muzzle flashes
    const mz = !!g.muzzle && g.t - g.muzzle.t < 0.05;
    const quiet = !!wdef?.suppressed;
    this.muzzleLight.intensity = mz ? (quiet ? 1 : 6) : 0;
    if (mz) this.muzzleLight.position.set(vp.x + Math.cos(vp.angle) * 0.7, vp.h - 0.1, vp.y + Math.sin(vp.angle) * 0.7);
    const ez = !!g.muzzleEnemy && g.t - g.muzzleEnemy.t < 0.06;
    this.enemyFlash.intensity = ez ? 7 : 0;
    if (ez && g.muzzleEnemy) this.enemyFlash.position.set(g.muzzleEnemy.x, 1.4, g.muzzleEnemy.y);
    if (g.muzzle && g.muzzle.t !== this.lastShot) { this.lastShot = g.muzzle.t; if (p.weapon === "m870") this.pumpT = 0.55; }

    // ---- bullet holes
    const fresh = g.impacts.filter(im => im.t > this.lastImpact);
    for (const im of fresh) {
      const k = this.holeCount % 160; this.holeCount++;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(im.nx, 0, im.ny).normalize());
      m4.compose(new THREE.Vector3(im.x + im.nx * 0.01, Math.max(0.1, Math.min(this.theme.interiorH - 0.1, im.h)), im.y + im.ny * 0.01), q, new THREE.Vector3(1, 1, 1));
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

    // ---- viewmodel state (rendered inside the composer so it shares the grade)
    const showVm = vp.kind === "operator" && p.hidden < 0 && g.status === "playing";
    for (const k in this.vm) this.vm[k].root.visible = false;
    for (const k in this.rigs) this.rigs[k].root.visible = false;
    this.flash.visible = false;
    const rig = showVm && g.equipped === "weapon" ? this.rigs[p.weapon] : undefined;
    if (rig) this.driveRig(rig, dt, moving, inside, !!mz, quiet);
    if (showVm && !rig) {
      const key = g.equipped === "weapon" ? p.weapon : "gadget";
      const vm = this.vm[key];
      if (vm) {
        vm.root.visible = true;
        this.sway.x += (this.lookDelta.x * 0.0008 - this.sway.x) * Math.min(1, dt * 10);
        this.sway.y += (this.lookDelta.y * 0.0008 - this.sway.y) * Math.min(1, dt * 10);
        this.lookDelta.x = 0; this.lookDelta.y = 0;
        const reloadDip = p.reloadT > 0 ? Math.sin(Math.min(1, p.reloadT / 1.2) * Math.PI) : 0;
        const pos = vm.hip.clone().lerp(vm.ads, this.adsT);
        const k = 1 - this.adsT * 0.85;
        const breathe = Math.sin(g.t * 1.7) * 0.0025 * k;
        const bx = moving ? Math.cos(this.bob * 0.5) * 0.01 * k : 0, by = moving ? Math.abs(Math.sin(this.bob * 0.5)) * 0.01 * k : 0;
        const sprint = p.sprint && p.moving && !p.crouch ? 1 : 0;
        vm.root.position.set(pos.x + bx - this.sway.x * k, pos.y - by + breathe - reloadDip * 0.08 + this.sway.y * k - sprint * 0.04, pos.z + g.recoil * 0.045);
        vm.root.rotation.set(g.recoil * 0.1 + reloadDip * 0.5 - sprint * 0.35 + 0.02 * k, -this.sway.x * 2 * k + sprint * 0.6 + 0.1 * (1 - this.adsT), -g.lean * 0.1 - reloadDip * 0.6 + 0.08 * (1 - this.adsT));
        if (vm.pump) { this.pumpT = Math.max(0, this.pumpT - dt); vm.pump.position.x = -Math.sin(Math.min(1, (0.55 - this.pumpT) / 0.4) * Math.PI) * 0.08 * (this.pumpT > 0 ? 1 : 0); }
        // light the arms like the world around them
        const camQ = this.camera.quaternion.clone().invert();
        this.vmSun.position.copy(this.sunDir).applyQuaternion(camQ).multiplyScalar(5);
        this.vmSun.intensity = inside ? 0.15 : 3.0;
        this.vmHemi.intensity = inside ? 0.6 : 0.95;
        this.vmRim.intensity = inside ? 0.4 : 1.0;
        this.vmScene.environmentIntensity = inside ? 0.45 : 0.9;
        this.vmMuzzle.intensity = mz ? (quiet ? 0.8 : 4) : 0;
        this.flash.visible = mz && !quiet;
        if (vm.gun) {
          const mzl = vm.muzzle.clone().applyEuler(vm.root.rotation).add(vm.root.position);
          this.vmMuzzle.position.copy(mzl); this.flash.position.copy(mzl).add(new THREE.Vector3(0, 0, -0.03));
          this.flash.material.rotation = Math.random() * 6.28; this.flash.scale.setScalar(0.08 + Math.random() * 0.06);
        }
      }
    }

    WIND.value = g.t;
    // ---- dust motes drift and wrap around the viewer; brighter in sunlight and lamp pools
    {
      const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute, v = this.moteVel, t = g.t;
      for (let i = 0; i < mp.count; i++) {
        let x = mp.getX(i) + (v[i * 3] + Math.sin(t * 0.3 + i) * 0.02) * dt, y = mp.getY(i) + (v[i * 3 + 1] + Math.cos(t * 0.23 + i * 1.7) * 0.012) * dt, z = mp.getZ(i) + (v[i * 3 + 2] + Math.cos(t * 0.27 + i) * 0.02) * dt;
        if (x - vp.x > 7) x -= 14; else if (vp.x - x > 7) x += 14;
        if (z - vp.y > 7) z -= 14; else if (vp.y - z > 7) z += 14;
        if (y < 0.05) y = 3.3; else if (y > 3.4) y = 0.1;
        mp.setXYZ(i, x, y, z);
      }
      mp.needsUpdate = true;
      const mat = this.motes.material as THREE.ShaderMaterial;
      mat.uniforms.uBright.value = inside ? 0.55 + p.light * 0.8 : 0.9;
      mat.uniforms.uScale.value = this.renderer.getSize(new THREE.Vector2()).y;
    }

    // ---- render
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    if (this.composer) { this.vmPass!.enabled = showVm; this.composer.render(dt); }
    else {
      this.renderer.render(this.scene, this.camera);
      if (showVm) { this.renderer.clearDepth(); this.renderer.render(this.vmScene, this.vmCamera); }
    }
  }

  /** realistic arms rig: sway, bob, ADS, sprint pose, recoil and the rig's own fire / reload clips */
  private driveRig(r: RigVM, dt: number, moving: boolean, inside: boolean, mz: boolean, quiet: boolean) {
    const g = this.game, p = g.player;
    r.root.visible = true;
    this.sway.x += (this.lookDelta.x * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (this.lookDelta.y * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    this.lookDelta.x = 0; this.lookDelta.y = 0;
    const k = 1 - this.adsT * 0.9;
    const sprint = g.sprinting ? 1 : 0;
    this.sprintT += (sprint - this.sprintT) * Math.min(1, dt * 8);
    const st = this.sprintT;
    const bx = moving ? Math.cos(this.bob * 0.5) * (0.006 + st * 0.012) * k : 0, by = moving ? Math.abs(Math.sin(this.bob * 0.5)) * (0.006 + st * 0.01) * k : 0;
    const breathe = Math.sin(g.t * 1.6) * 0.0015 * k;
    const pos = r.hip.clone().lerp(r.ads, this.adsT);
    r.root.position.set(pos.x + bx - this.sway.x * k + st * 0.02, pos.y - by + breathe + this.sway.y * k - st * 0.035, pos.z + g.recoil * 0.03);
    r.root.rotation.set(r.adsRot.x * this.adsT + g.recoil * 0.06 - st * 0.25, r.adsRot.y * this.adsT - this.sway.x * 1.5 * k + st * 0.9, -g.lean * 0.1 + st * 0.35);
    // clips: fire on each shot, reload when a reload starts
    if (g.muzzle && g.muzzle.t !== this.lastRigShot) { this.lastRigShot = g.muzzle.t; r.fire.reset().setEffectiveWeight(1).play(); }
    if (p.reloadT > 0 && this.lastReload <= 0) { const d = r.reload.getClip().duration; r.reload.reset(); r.reload.timeScale = d / Math.max(0.5, WEAPONS[p.weapon as WeaponId].reload); r.reload.play(); }
    this.lastReload = p.reloadT;
    if (p.reloadT <= 0 && r.reload.isRunning()) r.reload.stop();
    r.mixer.update(dt);
    const camQ = this.camera.quaternion.clone().invert();
    this.vmSun.position.copy(this.sunDir).applyQuaternion(camQ).multiplyScalar(5);
    this.vmSun.intensity = inside ? 0.15 : 2.6;
    this.vmHemi.intensity = inside ? 0.55 : 0.85;
    this.vmRim.intensity = inside ? 0.3 : 0.7;
    this.vmScene.environmentIntensity = inside ? 0.45 : 0.9;
    this.vmMuzzle.intensity = mz ? (quiet ? 0.8 : 4) : 0;
    this.flash.visible = mz && !quiet;
    if (mz) {
      this.vmScene.updateMatrixWorld(true);
      const mzl = r.muzzle.getWorldPosition(new THREE.Vector3());
      this.vmMuzzle.position.copy(mzl); this.flash.position.copy(mzl);
      this.flash.material.rotation = Math.random() * 6.28; this.flash.scale.setScalar(0.07 + Math.random() * 0.05);
    }
  }

  private itemMesh(kind: string, item?: string): THREE.Object3D | null {
    const grp = new THREE.Group();
    const std = (c: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...extra });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0, name?: string) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; if (name) m.name = name; grp.add(m); return m; };
    const glowRing = (r: number, color = 0xffd98a) => { const ring = add(new THREE.RingGeometry(r * 0.92, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }), 0.02, "glow"); ring.rotation.x = -Math.PI / 2; ring.castShadow = false; return ring; };
    const rb = (w: number, h: number, d: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.2);
    switch (kind) {
      case "loot": {
        const d = item ? LOOT[item] : undefined;
        if (item === "gold") { for (let k = 0; k < 3; k++) { const b = add(rb(0.18, 0.05, 0.08), std(0xd4a843, { metalness: 1, roughness: 0.25 }), 0.025 + (k === 2 ? 0.05 : 0)); b.position.x = k === 2 ? 0 : (k - 0.5) * 0.09; } }
        else if (item === "cash") { for (let k = 0; k < 4; k++) { const b = add(rb(0.16, 0.03, 0.07), std(0x6f8a5a, { roughness: 0.9 }), 0.015 + k * 0.03); b.rotation.y = k * 0.2; } }
        else if (item === "docs") { add(new THREE.BoxGeometry(0.22, 0.03, 0.3), std(0xe8e2d0, { roughness: 1 }), 0.015); add(new THREE.BoxGeometry(0.23, 0.005, 0.31), std(0xc0392b), 0.033); }
        else if (item === "medkit") { add(rb(0.26, 0.12, 0.18), std(0xe8e8e8), 0.06); add(new THREE.BoxGeometry(0.06, 0.005, 0.16), std(0xc0392b), 0.122); add(new THREE.BoxGeometry(0.18, 0.005, 0.05), std(0xc0392b), 0.122); }
        else if (item === "ammo") { add(rb(0.28, 0.14, 0.12), std(0x4f5a3a), 0.07); }
        else add(rb(0.24, 0.1, 0.18), std(d?.rare ? 0x303338 : 0x8a939c, { metalness: 0.5, roughness: 0.4 }), 0.05);
        glowRing(0.24); return grp;
      }
      case "keycard": add(new THREE.BoxGeometry(0.086, 0.004, 0.054), std(0x3f7dd6, { roughness: 0.3 }), 0.004); glowRing(0.15, 0x6fa0ff); return grp;
      case "objective": add(rb(0.44, 0.3, 0.32), std(0x2d3238, { metalness: 0.6, roughness: 0.4 }), 0.15); add(new THREE.BoxGeometry(0.3, 0.02, 0.05), std(0xd4a843, { metalness: 1 }), 0.31); glowRing(0.4, 0xfff0d0); return grp;
      case "evidence": add(new THREE.BoxGeometry(0.21, 0.02, 0.3), std(0xe8e0cc, { roughness: 1 }), 0.01); glowRing(0.3, 0xfff0d0); return grp;
      case "chargeSite": glowRing(0.45, 0xfff0d0); { const b = add(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0x330505 }), 1.2, "blink"); b.castShadow = false; } return grp;
      case "alarmPanel": add(rb(0.34, 0.44, 0.08), std(0xb02a20), 0); add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xff4535, emissive: 0xff2010, emissiveIntensity: 0.8 }), 0.05).rotation.x = Math.PI / 2; return grp;
      case "secTerminal": add(new THREE.BoxGeometry(0.56, 0.34, 0.03), new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: 0x4a90c0, emissiveIntensity: 0.9 }), 0.45); add(new THREE.BoxGeometry(0.6, 0.38, 0.05), std(0x222428), 0.45).position.z = 0.03; return grp;
      default: return null;
    }
  }
}

export { EYE, PX };
