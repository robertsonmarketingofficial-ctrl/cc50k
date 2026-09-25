// Headless playthroughs: a bot drives the real engine through each mission type, plus the Siege-style systems.
import { describe, expect, it } from "vitest";
import { Game, type Sfx } from "./engine";
import { findPath } from "./geom";
import type { Contract, FacilityId, MissionResult, MissionType } from "./types";
import { T } from "./types";
import { newSave } from "./world";

const silent: Sfx = { play() {}, state() {} };
const contract = (facility: FacilityId, type: MissionType, seed = 77): Contract => ({ id: "t" + seed, facility, type, title: "QA", client: "", brief: "",
  targetItem: type === "investigate" ? "obj_evidence" : type === "steal" ? "obj_prototype" : "obj_data", payout: 1000, rep: 100, optionals: [], seed });

function play(g: Game, god: boolean, maxT = 600): MissionResult | null {
  let result: MissionResult | null = null;
  g.onEnd = r => { result = r; };
  (globalThis as any).setTimeout = (fn: () => void) => fn();
  const L = g.level, p = g.player, inp = g.input;
  let path: { x: number; y: number }[] = [], repath = 0, last = { x: p.x, y: p.y }, stuck = 0;
  g.startAction();
  for (let step = 0; step < maxT * 20 && g.status === "playing"; step++) {
    if (god) { p.maxHp = 1e6; p.hp = 1e6; }
    const objs = L.interactables.filter(i => ["objective", "chargeSite", "hostage", "evidence"].includes(i.kind) && !i.done);
    const need = !(g.objectiveDone || (g.hostage && g.hostage.state === "following"));
    const tgt = need && objs.length ? objs.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] : null;
    const tx = tgt ? tgt.x + 0.5 : L.extraction.x, ty = tgt ? tgt.y + 0.5 : L.extraction.y;
    inp.up = inp.down = inp.left = inp.right = false; inp.interact = false;
    if (tgt && Math.hypot(tx - p.x, ty - p.y) < 1.35) { inp.mouseX = tx; inp.mouseY = ty; if (!inp.interact) inp.interactPressed = true; inp.interact = true; }
    else if (g.prompt?.hold && /Bypass/.test(g.prompt.text)) inp.interact = true;
    else {
      if (!path.length || repath-- <= 0) { path = findPath(L, p.x, p.y, tx, ty, 2, 30000) ?? []; repath = 20; }
      while (path[0] && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 0.25) path.shift();
      const n = path[0];
      if (n) { const dx = n.x - p.x, dy = n.y - p.y; inp.right = dx > 0.12; inp.left = dx < -0.12; inp.down = dy > 0.12; inp.up = dy < -0.12; inp.mouseX = p.x + dx * 3; inp.mouseY = p.y + dy * 3; }
      if (Math.hypot(last.x - p.x, last.y - p.y) < 0.01) { if (++stuck > 10) { inp.interactPressed = true; inp.interact = true; path = []; stuck = 0; } } else stuck = 0;
      last = { x: p.x, y: p.y };
    }
    g.update(0.05);
  }
  return result;
}

describe("headless playthroughs", () => {
  const cases: [MissionType, FacilityId][] = [["steal", "kestrel"], ["data", "meridian"], ["sabotage", "halvorsen"], ["rescue", "halvorsen"], ["investigate", "kestrel"]];
  for (const [type, fac] of cases) it(`${type} at ${fac}: objective and extraction`, () => {
    const g = new Game(contract(fac, type), newSave(), "dock", silent);
    const r = play(g, true);
    expect(r, "mission ended").not.toBeNull();
    expect(r!.outcome).toBe("extracted");
    expect(r!.objectiveDone).toBe(true);
  });

  it("prep phase: drone first, operator frozen, then action", () => {
    const g = new Game(contract("halvorsen", "steal"), newSave(), "dock", silent);
    expect(g.inPrep()).toBe(true);
    expect(g.viewpoint().kind).toBe("drone");
    const start = { x: g.player.x, y: g.player.y };
    g.input.right = true;
    for (let i = 0; i < 40; i++) g.update(0.05);
    expect(g.player.x).toBe(start.x);           // operator waits outside
    expect(g.drones[0].x).not.toBe(start.x);    // the drone drove
    g.startAction();
    expect(g.viewpoint().kind).toBe("operator");
    expect(g.clock()).toBe("23:47:00");
  });

  it("drone marks a guard it's looking at", () => {
    const g = new Game(contract("meridian", "data"), newSave(), "main", silent);
    const d = g.drones[0]; const guard = g.guards.find(x => !x.post)!;
    d.x = guard.x - 3; d.y = guard.y; // put the drone in the same room, looking at the guard
    g.input.mouseX = guard.x; g.input.mouseY = guard.y; g.input.firePressed = true;
    g.update(0.05);
    expect(guard.markedUntil).toBeGreaterThan(g.t);
  });

  it("breach charge blows a walkable hole in an interior wall, not in reinforced ones", () => {
    const g = new Game(contract("halvorsen", "steal"), newSave(), "dock", silent);
    g.startAction();
    const L = g.level;
    // find an interior soft wall with floor on both sides
    let spot = -1;
    for (let i = 0; i < L.tiles.length && spot < 0; i++) {
      if (L.tiles[i] !== T.WALL || L.reinforced.has(i)) continue;
      if (L.tiles[i - 1] === T.FLOOR && L.tiles[i + 1] === T.FLOOR && L.roomAt[i - 1] >= 0 && L.roomAt[i + 1] >= 0) spot = i;
    }
    expect(spot).toBeGreaterThan(0);
    const x = spot % L.w, y = Math.floor(spot / L.w);
    g.player.x = x - 0.6; g.player.y = y + 0.5; g.player.angle = 0; g.input.mouseX = x + 3; g.input.mouseY = y + 0.5;
    const before = g.player.gadgets.breach!;
    g.placeBreach();
    expect(g.player.gadgets.breach).toBe(before - 1);
    g.player.x = x - 3; // step back
    for (let i = 0; i < 60; i++) g.update(0.05);
    expect(L.tiles[spot]).toBe(T.FLOOR);
    expect(g.breaches.length).toBeGreaterThan(0);
    expect(g.alert).toBeGreaterThanOrEqual(2); // everyone heard it
    // outer walls are reinforced
    const outer = L.entrances[0]; const od = L.doors[outer.door];
    expect(L.reinforced.has(od.y * L.w + od.x + 2)).toBe(true);
  });

  it("headshots are one-tap; aiming low hits the body", () => {
    const g = new Game(contract("kestrel", "steal"), newSave(), "dock", silent);
    g.startAction();
    const guard = g.guards.find(x => x.kind === "guard" && !x.post)!;
    // stand next to the guard with clear line of sight
    g.player.x = guard.x - 1.2; g.player.y = guard.y; g.input.mouseX = guard.x; g.input.mouseY = guard.y;
    guard.state = "COMBAT"; guard.seesPlayer = true; // aware: no sneak-attack bonus
    g.input.pitch = -0.6; // aim low: body
    (g as any).hitscan(g.player.x, g.player.y, 0, 10, 55, true, "pistol");
    expect(guard.down).toBeNull();
    g.input.pitch = 0; // eye level: head
    (g as any).hitscan(g.player.x, g.player.y, 0, 10, 55, true, "pistol");
    expect(guard.down).toBe("dead");
    expect(g.headshots).toBe(1);
  });
});
