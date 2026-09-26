// Realistic actors built from the downloaded assets:
//  - RigViewmodel: first-person arms rig (skinned, with idle / fire / reload clips) holding the AK-47 it ships
//    with, or the CC0 M4A1 / our own guns parented to its gun bone so they ride the same animations.
//  - EnemyActor: a Mixamo character with retargeted idle / walk / run, arms solved with two-bone IK onto
//    a rifle carried at low ready or shouldered.
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { retarget, type Assets, type CharacterId } from "./assets";
import { addRim, buildGun } from "./models";
import type { WeaponId } from "./types";

// ------------------------------------------------------------------------------------------ helpers
const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
function worldPos(o: THREE.Object3D) { return o.getWorldPosition(V()); }

/** rotate `bone` (in world space) so that direction `from` becomes `to` */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const d = Q().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  const w = bone.getWorldQuaternion(Q());
  const pw = bone.parent!.getWorldQuaternion(Q()).invert();
  bone.quaternion.copy(pw.multiply(d.multiply(w)));
  bone.updateMatrixWorld(true);
}
function elbowFor(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const d = t.clone().sub(a); const len = Math.min(d.length(), (l1 + l2) * 0.999); d.normalize();
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len), y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pn = pole.clone().sub(a); pn.sub(d.clone().multiplyScalar(pn.dot(d))).normalize();
  return a.clone().addScaledVector(d, x).addScaledVector(pn, y);
}
/** two-bone IK: upper -> lower -> end reaches `target`, elbow bends toward `pole` (world) */
export function ik2(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
  const a = worldPos(upper), b = worldPos(lower), c = worldPos(end);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const e = elbowFor(a, target, l1, l2, pole);
  aimBone(upper, b.clone().sub(a), e.clone().sub(a));
  const b2 = worldPos(lower), c2 = worldPos(end);
  aimBone(lower, c2.clone().sub(b2), target.clone().sub(b2));
}

// fine woven-fabric normal detail layered over a material's own shading (close-up sleeves and gloves)
let weave: THREE.Texture | null = null;
function detailNormal(m: THREE.MeshStandardMaterial, rep: number, strength: number) {
  if (!weave) {
    const S = 128, c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d")!; const img = x.createImageData(S, S);
    for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) { const u = Math.sin(xx / S * Math.PI * 32), v = Math.sin(yy / S * Math.PI * 32), over = ((Math.floor(xx / 4) + Math.floor(yy / 4)) % 2) ? 1 : -1;
      const nx = over > 0 ? Math.cos(xx / S * Math.PI * 32) * 0.4 : 0, ny = over < 0 ? Math.cos(yy / S * Math.PI * 32) * 0.4 : 0; void u; void v;
      const i = (yy * S + xx) * 4; img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = 230; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0); weave = new THREE.CanvasTexture(c); weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  }
  const w = weave;
  m.onBeforeCompile = sh => {
    sh.uniforms.uWeave = { value: w }; sh.uniforms.uWeaveRep = { value: rep }; sh.uniforms.uWeaveK = { value: strength };
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uWeave; uniform float uWeaveRep; uniform float uWeaveK;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n#ifdef USE_MAP\n{ vec3 d = texture2D(uWeave, vMapUv * uWeaveRep).xyz * 2.0 - 1.0; normal = normalize(normal + vec3(d.xy * uWeaveK, 0.0)); }\n#endif");
  };
  m.customProgramCacheKey = () => "weave" + rep;
  m.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------ first person
export interface RigVM {
  root: THREE.Group; kind: "rig";
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction; fire: THREE.AnimationAction; reload: THREE.AnimationAction;
  muzzle: THREE.Object3D;
  hip: THREE.Vector3; ads: THREE.Vector3; adsRot: THREE.Euler;
}
// basis that maps a gun authored with +z = back / +y = up (the CC0 M4) into the rig's gun bone
const M4_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
// our procedural guns point along +x with +z to the right
const PROC_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));

export function buildRigVM(assets: Assets, id: WeaponId): RigVM {
  const scene = SkeletonUtils.clone(assets.arms.scene) as THREE.Group;
  const inner = new THREE.Group(); inner.add(scene);
  scene.scale.setScalar(0.05); scene.rotation.set(THREE.MathUtils.degToRad(5), THREE.MathUtils.degToRad(185), 0);
  const root = new THREE.Group(); root.add(inner);
  const gunBone = scene.getObjectByName("gun")!;
  let ak: THREE.Object3D | null = null;
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; if (/SMDImport/.test(m.name)) ak = m; }
    // skin tones read too pink under ACES: warm them slightly towards sun-tanned
    const mat = (m.material as THREE.MeshStandardMaterial | undefined);
    // tactical gloves over the bare hands, desert-toned sleeves
    if (m.isMesh && mat && /hand/i.test(mat.name)) { const c = mat.clone(); c.color.set(0x8a7c68); c.roughness = 0.78; c.metalness = 0; detailNormal(c, 18, 0.6); m.material = c; }
    else if (m.isMesh && mat && /arm/i.test(mat.name)) { const c = mat.clone(); c.color.set(0xd9c7a2); c.roughness = 0.92; detailNormal(c, 26, 0.8); m.material = c; }
  });
  if (id !== "ak12") {
    ak!.visible = false;
    const holder = new THREE.Group();
    if (id === "m4a1") {
      const g = assets.m4.scene.clone(true); holder.add(g);
      holder.quaternion.setFromRotationMatrix(M4_BASIS); holder.scale.setScalar(0.84); holder.position.set(0, -0.17, -0.065);
    } else {
      const g = buildGun(id); holder.add(g);
      holder.quaternion.setFromRotationMatrix(PROC_BASIS); holder.scale.setScalar(1.08);
      // put the pistol grip where the M4's grip sits in the firing hand
      const grip = g.userData.grip as THREE.Vector3;
      holder.position.set(0, -0.02, -0.05); g.position.set(-grip.x - 0.02, -grip.y - 0.1, 0);
    }
    holder.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; } });
    gunBone.add(holder);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, id === "ak12" ? -0.62 : id === "m4a1" ? -0.56 : -0.55, id === "ak12" ? 0.04 : 0.02); gunBone.add(muzzle);
  const mixer = new THREE.AnimationMixer(scene);
  const clip = (n: string) => assets.arms.animations.find(a => a.name === n)!;
  const idle = mixer.clipAction(clip("idle")); idle.play();
  const fire = mixer.clipAction(clip("fire")); fire.setLoop(THREE.LoopOnce, 1); fire.clampWhenFinished = false;
  const reload = mixer.clipAction(clip("reload_empty")); reload.setLoop(THREE.LoopOnce, 1);
  const hip = new THREE.Vector3(0.05, -0.035, -0.01);
  // calibrated so the iron sights (AK notch + post, M4 aperture + post) sit on the crosshair
  const ads = id === "ak12" ? new THREE.Vector3(-0.017, -0.011, 0.02) : new THREE.Vector3(-0.026, 0.006, 0.02);
  const adsRot = id === "ak12" ? new THREE.Euler(0, -0.08, 0) : new THREE.Euler(-0.1, -0.1, 0);
  return { root, kind: "rig", mixer, idle, fire, reload, muzzle, hip, ads, adsRot };
}

// ------------------------------------------------------------------------------------------ enemies
export type EnemyKind = "guard" | "contractor" | "chief";
const ROSTER: Record<EnemyKind, CharacterId[]> = { guard: ["militia", "balaclava", "thug"], contractor: ["tactical"], chief: ["gasmask"] };
const clipCache = new Map<CharacterId, THREE.AnimationClip[]>();
const heightCache = new Map<CharacterId, number>();
const ARM_BONES = /(Shoulder|Arm|ForeArm|Hand|Thumb|Index|Middle|Ring|Pinky|Spine|Neck|Head)/;

function clipsFor(assets: Assets, id: CharacterId): THREE.AnimationClip[] {
  let c = clipCache.get(id);
  if (!c) {
    const src = assets.locomotion; const rest = src.animations.find(a => a.name === "TPose") ?? null;
    const dst = SkeletonUtils.clone(assets.characters[id].scene);
    c = ["Idle", "Walk", "Run"].map(n => {
      const baked = retarget(dst, src.scene, src.animations.find(a => a.name === n)!, rest);
      baked.tracks = baked.tracks.filter(t => !ARM_BONES.test(t.name.split(".")[0])); // arms belong to the IK
      return baked;
    });
    clipCache.set(id, c);
  }
  return c;
}

export class EnemyActor {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  bones: Record<string, THREE.Bone> = {};
  gun: THREE.Object3D;
  grip = new THREE.Object3D(); fore = new THREE.Object3D(); muzzle = new THREE.Object3D();
  silhouettes: THREE.SkinnedMesh[] = [];
  aimT = 0; walk = 0;
  constructor(assets: Assets, kind: EnemyKind, seed: number, silMat: THREE.Material) {
    const pool = ROSTER[kind]; const id = pool[seed % pool.length];
    this.model = SkeletonUtils.clone(assets.characters[id].scene);
    // normalise to a 1.8 m person facing +x (the sim's forward)
    let h = heightCache.get(id);
    if (!h) { const bb = new THREE.Box3().setFromObject(assets.characters[id].scene); h = bb.max.y - bb.min.y; heightCache.set(id, h); }
    const s = (1.76 + ((seed * 37) % 7) * 0.012) / h;
    const holder = new THREE.Group(); holder.add(this.model); holder.scale.setScalar(s); holder.rotation.y = Math.PI / 2;
    this.root.add(holder);
    this.model.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      if (m.isSkinnedMesh) {
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) { if (mt.isMeshStandardMaterial && !mt.userData.tuned) { mt.userData.tuned = true; mt.envMapIntensity = 2.0; if (mt.map) { mt.emissiveMap = mt.map; mt.emissive = new THREE.Color(0x3b3530); } addRim(mt); } }
        const sil = new THREE.SkinnedMesh(m.geometry, silMat); sil.bind(m.skeleton, m.bindMatrix); sil.renderOrder = 10; sil.frustumCulled = false; sil.visible = false;
        m.parent!.add(sil); this.silhouettes.push(sil);
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = clipsFor(assets, id).map(c => { const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); return a; });
    this.actions[0].setEffectiveWeight(1);
    this.mixer.setTime(seed * 0.37);
    // rifle: the CC0 M4 at real size, with anchors for both hands
    const g = assets.m4.scene.clone(true);
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; } });
    this.gun = new THREE.Group(); this.gun.add(g); g.scale.setScalar(0.84); g.rotation.y = -Math.PI / 2; // model -z (muzzle) -> +x
    this.grip.position.set(-0.08, -0.09, 0); this.fore.position.set(0.2, -0.02, 0); this.muzzle.position.set(0.44, 0.02, 0);
    this.gun.add(this.grip, this.fore, this.muzzle);
    this.root.add(this.gun);
  }
  bone(n: string) { return this.bones["mixamorig" + n] ?? this.bones["mixamorig:" + n]; }

  /** speed in m/s drives the locomotion blend; aim raises the rifle to the shoulder */
  update(dt: number, speed: number, aiming: boolean) {
    const w = [Math.max(0, 1 - speed / 1.2), Math.max(0, 1 - Math.abs(speed - 1.4) / 1.2), Math.max(0, (speed - 1.8) / 1.5)];
    const sum = w[0] + w[1] + w[2] || 1;
    this.actions.forEach((a, i) => a.setEffectiveWeight(w[i] / sum));
    this.actions[1].timeScale = Math.max(0.6, speed / 1.4); this.actions[2].timeScale = Math.max(0.7, speed / 3.5);
    this.mixer.update(dt);
    this.aimT += ((aiming ? 1 : 0) - this.aimT) * Math.min(1, dt * 6);
    this.root.updateMatrixWorld(true);
    const spine = this.bone("Spine2"), head = this.bone("Head");
    if (!spine) return;
    // gun placement in actor space (+x forward, +y up, +z right)
    const inv = this.root.matrixWorld.clone().invert();
    const sp = worldPos(spine).applyMatrix4(inv), hp = head ? worldPos(head).applyMatrix4(inv) : sp.clone().add(new THREE.Vector3(0, 0.35, 0));
    const a = this.aimT;
    const low = new THREE.Vector3(sp.x + 0.28, sp.y - 0.12, sp.z + 0.07), high = new THREE.Vector3(hp.x + 0.2, hp.y - 0.08, hp.z + 0.1);
    this.gun.position.lerpVectors(low, high, a);
    this.gun.rotation.set(0, 0.12 * (1 - a), -0.55 * (1 - a) - 0.02 * a);
    this.gun.updateMatrixWorld(true);
    const R = (n: string) => this.bone(n);
    const rA = R("RightArm"), rF = R("RightForeArm"), rH = R("RightHand"), lA = R("LeftArm"), lF = R("LeftForeArm"), lH = R("LeftHand");
    if (rA && rF && rH) ik2(rA, rF, rH, worldPos(this.grip), this.localToWorld(new THREE.Vector3(-0.4, 0.8, 0.6)));
    if (lA && lF && lH) ik2(lA, lF, lH, worldPos(this.fore), this.localToWorld(new THREE.Vector3(0.1, 0.5, -0.8)));
    // hands follow the rifle's orientation
    const gq = this.gun.getWorldQuaternion(Q());
    for (const [hand, roll] of [[rH, Math.PI / 2], [lH, -Math.PI / 2]] as [THREE.Bone | undefined, number][]) {
      if (!hand) continue;
      const want = gq.clone().multiply(Q().setFromEuler(new THREE.Euler(roll, 0, -Math.PI / 2)));
      hand.quaternion.copy(hand.parent!.getWorldQuaternion(Q()).invert().multiply(want));
    }
  }
  localToWorld(v: THREE.Vector3) { return v.applyMatrix4(this.root.matrixWorld); }
}
