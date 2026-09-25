import { describe, expect, it } from "vitest";
import { generateLevel } from "./facility";
import { findPath, walkable } from "./geom";
import { defaultMemory, newSave } from "./world";
import type { Contract, FacilityId, MissionType } from "./types";
import { T } from "./types";

const facs: FacilityId[] = ["halvorsen", "meridian", "kestrel", "blacksite"];
const types: MissionType[] = ["steal", "data", "sabotage", "rescue", "investigate"];
const contract = (f: FacilityId, type: MissionType, seed: number): Contract => ({
  id: "t", facility: f, type, title: "t", client: "t", brief: "t", targetItem: "obj_data", payout: 1, rep: 1, optionals: [], seed,
});

describe("facility generation", () => {
  for (const f of facs) for (const type of types) for (const seed of [1, 99, 12345]) {
    it(`${f} ${type} ${seed}: every room, objective and the extraction is reachable from every entrance`, () => {
      const mem = defaultMemory(f);
      mem.heat = seed % 4; mem.extraCams = ["maint"]; mem.postedGuards = ["dock"]; mem.chief.status = seed === 99 ? "spared" : "active";
      mem.entryUse.dock = 2;
      const L = generateLevel({ contract: contract(f, type, seed), memory: mem, stash: [], story: [] });
      expect(L.entrances.length).toBe(3);
      const objs = L.interactables.filter(i => ["objective", "chargeSite", "hostage", "evidence"].includes(i.kind));
      expect(objs.length).toBeGreaterThan(0);
      for (const e of L.entrances) {
        // with every lock bypassed (the player can always hack), everything must be reachable
        for (const r of L.rooms) {
          const p = findPath(L, e.spawn.x, e.spawn.y, r.x + r.w / 2, r.y + r.h / 2, 2, 20000);
          expect(p, `room ${r.name} from ${e.id}`).not.toBeNull();
        }
        for (const o of objs) {
          const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(L, o.x + dx, o.y + dy, 2) || (o.x + dx === Math.floor(e.spawn.x)));
          expect(adj, `objective ${o.kind} has a free neighbour`).toBe(true);
        }
        expect(findPath(L, e.spawn.x, e.spawn.y, L.extraction.x, L.extraction.y, 0, 20000), "extraction").not.toBeNull();
      }
      // guards start on walkable tiles
      for (const g of L.guards) expect(walkable(L, Math.floor(g.x), Math.floor(g.y), 2)).toBe(true);
      // layout is stable per facility
      const again = generateLevel({ contract: contract(f, type, seed + 1), memory: defaultMemory(f), stash: [], story: [] });
      expect(again.rooms.map(r => r.type).join()).toBe(L.rooms.map(r => r.type).join());
      expect(L.tiles.filter(t => t === T.DOOR).length).toBeGreaterThan(L.rooms.length - 1);
    });
  }
  it("new save has contracts", () => { expect(newSave().contracts.length).toBeGreaterThanOrEqual(2); });
});
