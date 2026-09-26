// Real-world assets fetched from open-licence GitHub sources (see ASSET-CREDITS.md):
// rigged first-person arms + AK-47, a CC0 M4A1 and EOTech, Mixamo characters with retargeted
// locomotion clips, CC0 ambientCG surface scans and a CC0 Poly Haven HDRI.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const assetBase = () => ((globalThis as { __ASSET_BASE?: string }).__ASSET_BASE ?? (import.meta.env?.BASE_URL ?? "./") + "assets/");

export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }
export interface Assets {
  arms: GLTF;             // FPS arms + AK-47 rig with idle / fire / reload_empty
  m4: GLTF;               // CC0 M4A1
  eotech: GLTF;           // EOTech EXPS3 (+ G33 magnifier we strip)
  locomotion: GLTF;       // Mixamo Idle / Walk / Run / TPose source clips
  characters: Record<CharacterId, GLTF>;
  tex: Record<TexId, PBRSet>;
  hdr: THREE.DataTexture | null;
}
export type CharacterId = "tactical" | "militia" | "swat" | "gasmask" | "balaclava" | "thug";
export type TexId = "plaster" | "brick" | "paving" | "concrete" | "asphalt" | "metal";
const CHAR_FILES: Record<CharacterId, string> = { tactical: "chr_tactical", militia: "chr_militia", swat: "chr_swat_blue", gasmask: "chr_swat_gasmask", balaclava: "chr_terrorista", thug: "chr_thug" };

let cache: Promise<Assets> | null = null;
let loaded: Assets | null = null;
export function getAssets(): Assets | null { return loaded; }

export function loadAssets(onProgress?: (f: number) => void): Promise<Assets> {
  if (cache) return cache;
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  const tl = new THREE.TextureLoader();
  let done = 0; const total = 5 + 6 + 6 * 3 + 1;
  const tick = <T>(p: Promise<T>) => p.then(v => { done++; onProgress?.(done / total); return v; });
  // packed builds (single-file artifact) ship binaries as base64 in assets/models.js
  let packed = (globalThis as { __PACKED?: Record<string, string> }).__PACKED;
  const blobUrl = (key: string) => { const b64 = packed![key]; const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8])); };
  const src = (file: string) => (packed && packed[file] ? blobUrl(file) : assetBase() + file);
  const glb = (f: string) => tick(gl.loadAsync(src(f + ".glb")));
  const tex = (f: string, srgb: boolean) => tick(tl.loadAsync(assetBase() + "tex/" + f + ".jpg").then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }));
  const set = async (id: TexId): Promise<PBRSet> => ({ map: await tex(id + "_color", true), normalMap: await tex(id + "_normal", false), roughnessMap: await tex(id + "_rough", false) });
  cache = (async () => {
    // packed builds publish models as one JSON file (static hosts may refuse .glb, and CSP blocks extra scripts)
    if (!packed) packed = await fetch(assetBase() + "models.json").then(r => (r.ok ? r.json() : undefined)).catch(() => undefined);
    const [arms, m4, locomotion] = await Promise.all([glb("ak47"), glb("m4a1"), glb("locomotion")]); const eotech = m4;
    const chars = await Promise.all((Object.keys(CHAR_FILES) as CharacterId[]).map(async k => [k, await glb(CHAR_FILES[k])] as const));
    const texIds: TexId[] = ["plaster", "brick", "paving", "concrete", "asphalt", "metal"];
    const sets = await Promise.all(texIds.map(async k => [k, await set(k)] as const));
    const hdr = await tick(new RGBELoader().loadAsync(src("sky.hdr")).catch(() => null));
    if (hdr) hdr.mapping = THREE.EquirectangularReflectionMapping;
    loaded = { arms, m4, eotech, locomotion, characters: Object.fromEntries(chars) as Record<CharacterId, GLTF>, tex: Object.fromEntries(sets) as Record<TexId, PBRSet>, hdr };
    return loaded;
  })();
  return cache;
}

// ------------------------------------------------------------------------------------------ retargeting
function firstSkinned(o: THREE.Object3D): THREE.SkinnedMesh | null { let s: THREE.SkinnedMesh | null = null; o.traverse(c => { if (!s && (c as THREE.SkinnedMesh).isSkinnedMesh) s = c as THREE.SkinnedMesh; }); return s; }
const clean = (n: string) => n.replace(/[:\s]/g, "");

/**
 * Bake `clip` (authored on `srcRoot`) onto `dstRoot` by world-space rotation deltas from each rig's rest pose.
 * Source rest = its `restClip` at t=0 (a T-pose); target rest = its bind pose. Only rotations are transferred.
 */
export function retarget(dstRoot: THREE.Object3D, srcRoot: THREE.Object3D, clip: THREE.AnimationClip, restClip: THREE.AnimationClip | null, fps = 24): THREE.AnimationClip {
  const src = firstSkinned(srcRoot)!, dst = firstSkinned(dstRoot)!;
  const srcBones = new Map(src.skeleton.bones.map(b => [clean(b.name), b]));
  const dstBones = dst.skeleton.bones.filter(b => srcBones.has(clean(b.name)));
  const mixer = new THREE.AnimationMixer(srcRoot);
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  // rest poses: the node transforms as loaded (skeleton.pose() would ignore the armature's own transform)
  const restLocal = new Map(dst.skeleton.bones.map(b => [b, b.quaternion.clone()]));
  const reset = () => { for (const [b, q] of restLocal) b.quaternion.copy(q); };
  reset(); dstRoot.updateMatrixWorld(true);
  const dstRest = new Map(dstBones.map(b => [b.name, worldQ(b)]));
  if (restClip) { const a = mixer.clipAction(restClip); a.play(); mixer.setTime(0); }
  srcRoot.updateMatrixWorld(true);
  const srcRest = new Map(dstBones.map(b => [b.name, worldQ(srcBones.get(clean(b.name))!)]));
  mixer.stopAllAction();
  const act = mixer.clipAction(clip); act.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const values = new Map(dstBones.map(b => [b.name, new Float32Array(frames * 4)]));
  const tmp = new THREE.Quaternion(), pw = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps); times[f] = t;
    mixer.setTime(t); srcRoot.updateMatrixWorld(true);
    // walk the target hierarchy parent-first so parent world rotations are already final
    reset(); dstRoot.updateMatrixWorld(true);
    for (const b of dstBones) {
      const sb = srcBones.get(clean(b.name))!;
      const delta = worldQ(sb).multiply(srcRest.get(b.name)!.clone().invert());
      const want = delta.multiply(dstRest.get(b.name)!);
      b.parent!.getWorldQuaternion(pw);
      tmp.copy(pw).invert().multiply(want);
      b.quaternion.copy(tmp); b.updateMatrixWorld(true);
      tmp.toArray(values.get(b.name)!, f * 4);
    }
  }
  mixer.stopAllAction(); reset();
  const tracks = dstBones.map(b => new THREE.QuaternionKeyframeTrack(b.name + ".quaternion", times, values.get(b.name)!));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
