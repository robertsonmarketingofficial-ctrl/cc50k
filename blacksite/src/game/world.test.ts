import { describe, expect, it } from "vitest";
import { generateLevel } from "./facility";
import type { Contract, MissionResult } from "./types";
import { applyResult, decodeExplored, encodeExplored, generateContracts, newSave } from "./world";

const contract = (over: Partial<Contract> = {}): Contract => ({ id: "c1", facility: "halvorsen", type: "steal", title: "Steal the prototype", client: "x", brief: "x",
  targetItem: "obj_prototype", payout: 1400, rep: 180, optionals: [{ id: "ghost", label: "Ghost", bonus: 500 }], seed: 42, ...over });
const result = (over: Partial<MissionResult> = {}): MissionResult => ({ outcome: "extracted", objectiveDone: true, optionalsDone: [], loot: ["obj_prototype"], entry: "dock",
  alarms: 0, lockdown: false, kills: 0, kos: 0, camerasDestroyed: [], camerasEmped: 0, breaches: [], headshots: 0, dronesLost: 0, loopedFeeds: false, panelsSabotaged: 0, chief: "untouched", explored: "",
  events: [{ time: 10, text: "Entry" }], duration: 300, zeroHourPassed: false, shotsFired: 0, hostageRescued: false, spotted: 0, ...over });

describe("world memory", () => {
  it("habitual entrances get a camera, then a posted guard, and the guard is reassigned when you stop", () => {
    const s = newSave();
    const r1 = applyResult(s, contract(), result());
    expect(s.facilities.halvorsen.extraCams).toEqual([]);
    const r2 = applyResult(s, contract(), result());
    expect(s.facilities.halvorsen.extraCams).toContain("dock");
    expect(r2.consequences.some(c => /camera installed/i.test(c.text))).toBe(true);
    applyResult(s, contract(), result());
    applyResult(s, contract(), result());
    expect(s.facilities.halvorsen.postedGuards).toContain("dock");
    // the generated facility actually contains the consequences
    const L = generateLevel({ contract: contract(), memory: s.facilities.halvorsen, stash: [], story: [] });
    const base = generateLevel({ contract: contract(), memory: newSave().facilities.halvorsen, stash: [], story: [] });
    expect(L.guards.filter(g => g.post).length).toBeGreaterThan(base.guards.filter(g => g.post).length);
    expect(L.cameras.length).toBeGreaterThan(base.cameras.length);
    // stop using it: the guard goes away
    for (let i = 0; i < 3; i++) applyResult(s, contract(), result({ entry: "main" }));
    expect(s.facilities.halvorsen.postedGuards).not.toContain("dock");
    expect(r1.number).toBeLessThan(r2.number);
  });

  it("destroyed cameras come back shielded; looped feeds harden the terminal", () => {
    const s = newSave();
    const r = applyResult(s, contract(), result({ camerasDestroyed: [{ x: 20.3, y: 10.3 }], loopedFeeds: true }));
    expect(s.facilities.halvorsen.hardenedCams.length).toBe(1);
    expect(s.facilities.halvorsen.terminalHardened).toBe(true);
    expect(r.consequences.map(c => c.cause).join(" ")).toMatch(/shot them/);
    const L = generateLevel({ contract: contract(), memory: s.facilities.halvorsen, stash: [], story: [] });
    expect(L.cameras.some(c => c.hardened)).toBe(true);
  });

  it("killing staff brings contractors; quiet nights send them home", () => {
    const s = newSave();
    applyResult(s, contract(), result({ kills: 2 }));
    expect(s.facilities.halvorsen.contractors).toBe(false);
    applyResult(s, contract(), result({ kills: 1 }));
    expect(s.facilities.halvorsen.contractors).toBe(true);
    s.facilities.halvorsen.heat = 0;
    applyResult(s, contract(), result({ kills: 0 }));
    expect(s.facilities.halvorsen.contractors).toBe(false);
  });

  it("sparing the head of security twice leaks the patrol rota; killing them brings a replacement", () => {
    const s = newSave();
    applyResult(s, contract(), result({ chief: "spared" }));
    expect(s.facilities.halvorsen.chief.status).toBe("spared");
    // spared chief watches your favourite entrance
    const L = generateLevel({ contract: contract(), memory: s.facilities.halvorsen, stash: [], story: [] });
    const chief = L.guards.find(g => g.kind === "chief")!;
    const dock = L.doors[L.entrances.find(e => e.id === "dock")!.door];
    expect(Math.hypot(chief.x - dock.x, chief.y - dock.y)).toBeLessThan(26);
    const r = applyResult(s, contract(), result({ chief: "spared" }));
    expect(s.facilities.halvorsen.chief.status).toBe("leaked");
    expect(s.facilities.halvorsen.rota).toBe(true);
    expect(r.unlocks.join()).toMatch(/Patrol routes/);
    const s2 = newSave();
    applyResult(s2, contract({ facility: "meridian" }), result({ chief: "killed" }));
    expect(s2.facilities.meridian.chief.status).toBe("killed");
    expect(s2.facilities.meridian.contractors).toBe(true);
  });

  it("dying loses carried loot and costs a fee, but never pushes credits below zero", () => {
    const s = newSave(); s.credits = 100;
    const r = applyResult(s, contract(), result({ outcome: "killed", objectiveDone: false, loot: ["gold", "obj_prototype"] }));
    expect(r.recovered).toEqual([]);
    expect(s.credits).toBe(0);
    expect(s.facilities.halvorsen.heat).toBeGreaterThan(0);
    expect(s.facilities.halvorsen.objectiveMoved).toBe(true);
    expect(s.contracts.length).toBeGreaterThan(0); // always something to do next
  });

  it("heat cools off at facilities you leave alone", () => {
    const s = newSave();
    applyResult(s, contract(), result({ lockdown: true, alarms: 2 }));
    const h = s.facilities.halvorsen.heat;
    expect(h).toBe(2);
    for (let i = 0; i < 4; i++) applyResult(s, contract({ facility: "meridian" }), result());
    expect(s.facilities.halvorsen.heat).toBeLessThan(h);
  });

  it("stolen items unlock the story chain and gear", () => {
    const s = newSave();
    applyResult(s, contract({ facility: "kestrel" }), result({ loot: ["obj_prototype", "rare_manifest", "rare_keycopy"] }));
    expect(s.story).toContain("manifest");
    expect(s.contracts.some(c => c.story === "castell")).toBe(true);
    applyResult(s, contract({ facility: "halvorsen" }), result({ loot: ["rare_emp"] }));
    expect(s.owned).toContain("emp");
    const castell = s.contracts.find(c => c.story === "castell") ?? generateContracts(s).find(c => c.story === "castell")!;
    applyResult(s, castell, result({ hostageRescued: true, objectiveDone: true, loot: [] }));
    expect(s.owned).toContain("thermal");
    expect(s.contracts.some(c => c.story === "file")).toBe(true);
    // rare items are gone from the facility once extracted
    const L = generateLevel({ contract: contract({ facility: "halvorsen" }), memory: s.facilities.halvorsen, stash: s.stash, story: s.story });
    expect(L.interactables.some(i => i.item === "rare_emp")).toBe(false);
  });

  it("explored map round-trips", () => {
    const bits = new Uint8Array(500); for (let i = 40; i < 300; i += 3) bits[i] = 1;
    expect(Array.from(decodeExplored(encodeExplored(bits), 500))).toEqual(Array.from(bits));
  });
});
