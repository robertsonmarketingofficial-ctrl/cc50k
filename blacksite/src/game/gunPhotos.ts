// Studio "photos" of each weapon for the loadout screen, rendered once off-screen and cached as data URLs.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getAssets } from "./assets";
import { buildGun } from "./models";
import type { WeaponId } from "./types";

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

function subject(id: WeaponId): THREE.Object3D {
  const A = getAssets();
  if (A && id === "m4a1") return A.m4.scene.clone(true);
  if (A && id === "ak12") {
    // the AK ships inside the arms rig: pose it, hide the arms
    const s = SkeletonUtils.clone(A.arms.scene);
    const mx = new THREE.AnimationMixer(s); mx.clipAction(A.arms.animations.find(a => a.name === "idle")!).play(); mx.update(0.01);
    s.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.visible = /SMDImport/.test(m.name); } });
    return s;
  }
  return buildGun(id);
}

/** returns a cached data URL, or renders one (null if WebGL is unavailable) */
export function gunPhoto(id: WeaponId, real = !!getAssets()): string | null {
  const key = id + (real ? ":real" : "");
  const hit = cache.get(key); if (hit) return hit;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(480, 200, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.7;
    }
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 0.8));
    const key1 = new THREE.DirectionalLight(0xfff2e0, 2.4); key1.position.set(1, 2, 3); scene.add(key1);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 1.4); rim.position.set(-2, 1, -3); scene.add(rim);
    const obj = subject(id); scene.add(obj); scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    // look along the thinnest horizontal axis so we see the gun's side profile
    const side = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const len = Math.max(size.x, size.z);
    const cam = new THREE.OrthographicCamera(-len * 0.56, len * 0.56, len * 0.56 * 200 / 480, -len * 0.56 * 200 / 480, 0.001, 1000);
    cam.position.copy(c).addScaledVector(side, len * 3); cam.up.set(0, 1, 0); cam.lookAt(c);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL("image/png");
    cache.set(key, url);
    scene.environment?.dispose();
    return url;
  } catch { return null; }
}
