// Procedural facility assembly from modular rooms on a macro grid.
// Layout (rooms, doors, props, lights) is seeded per facility so it is the same place every visit;
// the contract seed decides the objective and patrols; world memory adds its consequences on top.
import { FACILITIES, ROOM_NAMES } from "./catalog";
import { Rng } from "./rng";
import type {
  Camera, Contract, Door, Entrance, EntranceId, FacilityMemory, GuardSpec, Interactable, Level, Light, Room, RoomType, Vec,
} from "./types";
import { T } from "./types";

export const CELL_W = 12, CELL_H = 10, MARGIN = 5;

const UNIQUE: RoomType[] = ["lobby", "security", "executive", "vault", "armory", "holding", "dock", "maintenance"];

export interface GenOptions { contract: Contract; memory: FacilityMemory; stash: string[]; story: string[]; }

export function generateLevel(opts: GenOptions): Level {
  const { contract, memory } = opts;
  const fac = FACILITIES[contract.facility];
  const rng = new Rng(fac.seed);           // layout: stable per facility
  const crng = new Rng(contract.seed);     // contract-specific placement
  const cols = fac.cols, rows = fac.rows;
  const w = MARGIN * 2 + cols * CELL_W + 1, h = MARGIN * 2 + rows * CELL_H + 1;
  const tiles = new Uint8Array(w * h).fill(T.EXT);
  const roomAt = new Int16Array(w * h).fill(-1);
  const doorAt = new Int16Array(w * h).fill(-1);
  const idx = (x: number, y: number) => y * w + x;
  const bx0 = MARGIN, by0 = MARGIN, bx1 = MARGIN + cols * CELL_W, by1 = MARGIN + rows * CELL_H;

  // ---------------------------------------------------------------- cell types
  const cellType: (RoomType | null)[] = new Array(cols * rows).fill(null);
  const C = (i: number, j: number) => j * cols + i;
  const lobbyI = Math.floor(cols / 2);
  cellType[C(lobbyI, 0)] = "lobby";
  const dockLeft = rng.chance(0.5);
  const dockI = dockLeft ? 0 : cols - 2;
  cellType[C(dockI, rows - 1)] = "dock"; cellType[C(dockI + 1, rows - 1)] = "dock";
  const maintI = dockLeft ? cols - 1 : 0;
  cellType[C(maintI, 1)] = "maintenance";
  const secI = lobbyI + (rng.chance(0.5) ? -1 : 1);
  cellType[C(secI, 0)] = "security";
  const execI = secI < lobbyI ? cols - 1 : 0;
  cellType[C(execI, 0)] = cellType[C(execI, 0)] ?? "executive";
  // vault in the middle band, away from the entrances
  const midCells = [] as number[];
  for (let i = 1; i < cols - 1; i++) if (!cellType[C(i, 1)]) midCells.push(C(i, 1));
  cellType[rng.pick(midCells)] = "vault";
  const fill: RoomType[] = [];
  for (const [t, wgt] of Object.entries(fac.weights)) for (let k = 0; k < Math.round((wgt as number) * 2); k++) fill.push(t as RoomType);
  const needed: RoomType[] = ["server"];
  if (contract.facility === "halvorsen" || contract.facility === "blacksite" || contract.type === "rescue") needed.push("holding");
  if (contract.facility === "blacksite" || contract.facility === "kestrel") needed.push("armory");
  const free = cellType.map((t, i) => (t ? -1 : i)).filter(i => i >= 0);
  rng.shuffle(free);
  for (const c of free) {
    let t: RoomType = needed.length ? needed.shift()! : rng.pick(fill);
    if (UNIQUE.includes(t) && cellType.includes(t)) t = "office";
    cellType[c] = t;
  }

  // ---------------------------------------------------------------- rooms (merging)
  const cellRoom = new Array(cols * rows).fill(-1);
  const rooms: Room[] = [];
  const usedNames = new Set<string>();
  const nameFor = (t: RoomType) => {
    const opts = ROOM_NAMES[t];
    for (const n of opts) if (!usedNames.has(n)) { usedNames.add(n); return n; }
    const n = `${opts[0]} ${usedNames.size}`; usedNames.add(n); return n;
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const c = C(i, j);
    if (cellRoom[c] >= 0) continue;
    const t = cellType[c]!;
    const cells = [c];
    const right = i + 1 < cols ? C(i + 1, j) : -1;
    const mergeable = t === "dock" || ((t === "server" || t === "storage" || t === "lab" || t === "office") && rng.chance(0.45));
    if (right >= 0 && cellRoom[right] < 0 && cellType[right] === t && mergeable) cells.push(right);
    const id = rooms.length;
    cells.forEach(cc => (cellRoom[cc] = id));
    rooms.push({
      id, type: t, name: nameFor(t), cells,
      x: MARGIN + i * CELL_W + 1, y: MARGIN + j * CELL_H + 1,
      w: CELL_W * cells.length - 1, h: CELL_H - 1,
      lock: 0, dark: t === "storage" ? rng.chance(0.6) : t === "maintenance" || (t === "dock" && rng.chance(0.3)),
    });
  }

  // ---------------------------------------------------------------- base tiles
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) tiles[idx(x, y)] = T.FLOOR;
  for (let i = 0; i <= cols; i++) for (let y = by0; y <= by1; y++) tiles[idx(MARGIN + i * CELL_W, y)] = T.WALL;
  for (let j = 0; j <= rows; j++) for (let x = bx0; x <= bx1; x++) tiles[idx(x, MARGIN + j * CELL_H)] = T.WALL;
  for (const r of rooms) {
    if (r.cells.length > 1) { // knock out the wall between merged cells
      for (let k = 1; k < r.cells.length; k++) {
        const wx = r.x - 1 + k * CELL_W;
        for (let y = r.y; y < r.y + r.h; y++) tiles[idx(wx, y)] = T.FLOOR;
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomAt[idx(x, y)] = r.id;
  }
  // road and yard texture in the exterior are drawn by the renderer; exterior stays walkable

  // ---------------------------------------------------------------- connectivity
  type Edge = { a: number; b: number; x: number; y: number; vertical: boolean };
  const candidates: Edge[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = cellRoom[C(i, j)];
    if (i + 1 < cols) {
      const b = cellRoom[C(i + 1, j)];
      if (a !== b) candidates.push({ a, b, x: MARGIN + (i + 1) * CELL_W, y: MARGIN + j * CELL_H + rng.int(3, CELL_H - 3), vertical: true });
    }
    if (j + 1 < rows) {
      const b = cellRoom[C(i, j + 1)];
      if (a !== b) candidates.push({ a, b, x: MARGIN + i * CELL_W + rng.int(3, CELL_W - 3), y: MARGIN + (j + 1) * CELL_H, vertical: false });
    }
  }
  const leafy = (r: number) => rooms[r].type === "vault" || rooms[r].type === "holding" || rooms[r].type === "armory";
  const edges: Edge[] = [];
  const connected = new Set<number>([rooms.find(r => r.type === "lobby")!.id]);
  const pool = rng.shuffle(candidates.slice());
  // random spanning tree that never routes *through* vault/holding/armory
  let guard = 0;
  while (connected.size < rooms.length && guard++ < 500) {
    const e = pool.find(e => connected.has(e.a) !== connected.has(e.b) && !(leafy(e.a) && connected.has(e.a)) && !(leafy(e.b) && connected.has(e.b)));
    if (!e) break;
    edges.push(e);
    connected.add(e.a); connected.add(e.b);
  }
  // loops: alternative routes, but secure rooms keep a single door
  for (const e of pool) {
    if (edges.includes(e) || leafy(e.a) || leafy(e.b)) continue;
    if (edges.some(o => (o.a === e.a && o.b === e.b) || (o.a === e.b && o.b === e.a))) continue;
    if (rng.chance(0.42)) edges.push(e);
  }

  const doors: Door[] = [];
  const addDoor = (x: number, y: number, vertical: boolean, a: number, b: number, exterior?: EntranceId) => {
    const d: Door = { id: doors.length, x, y, open: false, lock: 0, hack: 0, rooms: [a, b], exterior, vertical };
    doors.push(d);
    tiles[idx(x, y)] = T.DOOR;
    doorAt[idx(x, y)] = d.id;
    return d;
  };
  for (const e of edges) addDoor(e.x, e.y, e.vertical, e.a, e.b);

  // ---------------------------------------------------------------- locks
  const lockOf: Partial<Record<RoomType, 0 | 1 | 2>> = { vault: 2, armory: 2, executive: 1, server: 1, security: 1, holding: 1 };
  for (const r of rooms) r.lock = lockOf[r.type] ?? 0;
  for (const d of doors) {
    const la = rooms[d.rooms[0]].lock, lb = rooms[d.rooms[1]].lock;
    d.lock = Math.max(la, lb) as 0 | 1 | 2;
  }
  // every ordinary room must be reachable without keys: add doors where locks cut it off
  const reach = () => {
    const seen = new Set<number>([rooms.find(r => r.type === "lobby")!.id]);
    const q = [...seen];
    while (q.length) {
      const r = q.shift()!;
      for (const d of doors) {
        if (d.lock) continue;
        const o = d.rooms[0] === r ? d.rooms[1] : d.rooms[1] === r ? d.rooms[0] : -1;
        if (o >= 0 && !seen.has(o)) { seen.add(o); q.push(o); }
      }
    }
    return seen;
  };
  for (let pass = 0; pass < 8; pass++) {
    const seen = reach();
    const missing = rooms.filter(r => !r.lock && !seen.has(r.id));
    if (!missing.length) break;
    for (const r of missing) {
      const e = candidates.find(e => ((e.a === r.id && seen.has(e.b)) || (e.b === r.id && seen.has(e.a))) && !rooms[e.a].lock && !rooms[e.b].lock
        && tiles[idx(e.x, e.y)] !== T.DOOR);
      if (e) addDoor(e.x, e.y, e.vertical, e.a, e.b);
    }
  }
  // most unlocked doors start open; locked doors are shut
  for (const d of doors) d.open = !d.lock && rng.chance(0.62);

  // ---------------------------------------------------------------- entrances + extraction
  const roomOf = (t: RoomType) => rooms.find(r => r.type === t)!;
  const lobby = roomOf("lobby"), dock = roomOf("dock"), maint = roomOf("maintenance");
  const entrances: Entrance[] = [];
  {
    const x = lobby.x + Math.floor(lobby.w / 2), y = by0;
    const d = addDoor(x, y, false, lobby.id, -1, "main"); d.open = false;
    entrances.push({ id: "main", name: "Main entrance", door: d.id, spawn: { x: x + 0.5 + (x > (bx0 + bx1) / 2 ? -7 : 7), y: y - 3.5 }, note: "Floodlit front doors into reception. Always watched." });
  }
  {
    const x = dock.x + Math.floor(dock.w / 2), y = by1;
    const d = addDoor(x, y, false, dock.id, -1, "dock"); d.open = true;
    entrances.push({ id: "dock", name: "Loading dock", door: d.id, spawn: { x: x + 0.5 + (x > (bx0 + bx1) / 2 ? -7 : 7), y: y + 3.5 }, note: "Roller door left up for night deliveries. Lots of cover, lots of lines of sight." });
  }
  {
    const left = maint.x === MARGIN + 1;
    const x = left ? bx0 : bx1, y = maint.y + Math.floor(maint.h / 2);
    const d = addDoor(x, y, true, maint.id, -1, "maint"); d.lock = 1; d.open = false;
    entrances.push({ id: "maint", name: "Maintenance hatch", door: d.id, spawn: { x: x + (left ? -3 : 3) + 0.5, y: y + 0.5 }, note: "Unlit service door on the side wall. Padlocked, so it needs a few seconds of work." });
  }
  const extraSide = new Rng(fac.seed + 7).chance(0.5);
  const extraction = { x: extraSide ? bx1 + 3 : bx0 - 3, y: extraSide ? by0 - 2.5 : by1 + 2.5, r: 1.7, name: "Service road van" };

  // ---------------------------------------------------------------- props
  const props: Level["props"] = [];
  const interactables: Interactable[] = [];
  const addI = (it: Omit<Interactable, "id" | "done" | "progress">) => {
    const full: Interactable = { ...it, id: interactables.length, done: false, progress: 0 };
    interactables.push(full); return full;
  };
  const isFree = (x: number, y: number) => tiles[idx(x, y)] === T.FLOOR && roomAt[idx(x, y)] >= 0;
  const doorAdj = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tiles[idx(x + dx, y + dy)] === T.DOOR) return true;
    for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0]]) if (tiles[idx(x + dx, y + dy)] === T.DOOR) return true;
    return false;
  };
  const roomConnected = (r: Room) => {
    // all free tiles of the room form one region (so every door and object stays reachable)
    const freeTiles: number[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (tiles[idx(x, y)] === T.FLOOR) freeTiles.push(idx(x, y));
    if (!freeTiles.length) return false;
    const seen = new Set([freeTiles[0]]); const q = [freeTiles[0]];
    while (q.length) {
      const p = q.pop()!; const px = p % w, py = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h) continue;
        const n = idx(nx, ny);
        if (!seen.has(n) && tiles[n] === T.FLOOR) { seen.add(n); q.push(n); }
      }
    }
    return seen.size === freeTiles.length;
  };
  const place = (r: Room, x: number, y: number, pw: number, ph: number, kind: string, tall: boolean): boolean => {
    for (let yy = y; yy < y + ph; yy++) for (let xx = x; xx < x + pw; xx++) {
      if (xx < r.x || yy < r.y || xx >= r.x + r.w || yy >= r.y + r.h) return false;
      if (!isFree(xx, yy) || doorAdj(xx, yy)) return false;
    }
    for (let yy = y; yy < y + ph; yy++) for (let xx = x; xx < x + pw; xx++) tiles[idx(xx, yy)] = tall ? T.PROP_TALL : T.PROP_LOW;
    if (!roomConnected(r)) {
      for (let yy = y; yy < y + ph; yy++) for (let xx = x; xx < x + pw; xx++) tiles[idx(xx, yy)] = T.FLOOR;
      return false;
    }
    props.push({ x, y, w: pw, h: ph, kind, tall });
    return true;
  };
  // wall-adjacent free floor tile for panels/lockers
  const wallSpots = (r: Room) => {
    const out: Vec[] = [];
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) { out.push({ x, y: r.y }); out.push({ x, y: r.y + r.h - 1 }); }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) { out.push({ x: r.x, y }); out.push({ x: r.x + r.w - 1, y }); }
    return out;
  };
  const lootTable: Record<string, string[]> = {
    office: ["cash", "docs", "docs", "laptop", "cash"], lab: ["sample", "docs", "laptop"], storage: ["cash", "laptop", "sample"],
    executive: ["watch", "docs", "laptop"], server: ["drive", "drive"], security: ["cash", "ammo"], armory: ["ammo", "ammo", "medkit"],
    maintenance: ["medkit", "cash"], dock: ["cash", "laptop"], lobby: ["cash"], holding: ["medkit"], vault: ["gold", "drive"],
  };
  const lootAt = (r: Room, x: number, y: number, chance: number) => {
    if (!crng.chance(chance)) return;
    const item = crng.pick(lootTable[r.type] ?? ["cash"]);
    addI({ kind: "loot", x, y, room: r.id, item, time: item === "gold" ? 1.6 : 0.8, label: "Take" });
  };

  for (const r of rooms) {
    const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2);
    switch (r.type) {
      case "office": {
        for (let yy = r.y + 2; yy < r.y + r.h - 2; yy += 3)
          for (let xx = r.x + 2; xx < r.x + r.w - 3; xx += 4)
            if (place(r, xx, yy, 2, 1, "desk", false)) lootAt(r, xx + rng.int(0, 1), yy, 0.35);
        for (let xx = r.x + 1; xx < r.x + r.w - 1; xx += 3) place(r, xx, r.y, 1, 1, "cabinet", true);
        break;
      }
      case "security": {
        if (place(r, cx - 1, r.y + 1, 3, 1, "console", false)) addI({ kind: "secTerminal", x: cx, y: r.y + 1, room: r.id, time: 5, label: "Loop camera feeds" });
        let lockers = 0;
        for (const s of wallSpots(r)) if (lockers < 2 && s.y === r.y + r.h - 1 && place(r, s.x, s.y, 1, 1, "locker", true)) { addI({ kind: "locker", x: s.x, y: s.y, room: r.id, time: 0.3, label: "Hide" }); lockers++; }
        for (let yy = r.y + 3; yy < r.y + r.h - 2; yy += 3) if (place(r, r.x + 2, yy, 2, 1, "desk", false)) lootAt(r, r.x + 2, yy, 0.5);
        break;
      }
      case "server": {
        for (let xx = r.x + 2; xx < r.x + r.w - 1; xx += 3) place(r, xx, r.y + 2, 1, r.h - 4, "rack", true);
        const tx = r.x + r.w - 2;
        if (place(r, tx, r.y, 1, 1, "terminal", false)) addI({ kind: "terminal", x: tx, y: r.y, room: r.id, time: 7, label: "Access terminal", hidden: true });
        for (let k = 0; k < 2; k++) lootAt(r, r.x + 2 + 3 * k, r.y + 2, 0.4);
        break;
      }
      case "lab": {
        for (let yy = r.y + 2; yy < r.y + r.h - 2; yy += 3) for (let xx = r.x + 2; xx < r.x + r.w - 4; xx += 5)
          if (place(r, xx, yy, 3, 1, "bench", false)) lootAt(r, xx + 1, yy, 0.35);
        place(r, r.x, r.y, 1, 1, "tank", true); place(r, r.x + r.w - 1, r.y, 1, 1, "tank", true);
        place(r, r.x + r.w - 1, r.y + r.h - 1, 1, 1, "fridge", true);
        break;
      }
      case "storage": {
        for (let yy = r.y + 2; yy < r.y + r.h - 1; yy += 3) {
          const gap = rng.int(r.x + 2, r.x + r.w - 4);
          place(r, r.x + 1, yy, gap - r.x - 1, 1, "shelf", true);
          place(r, gap + 2, yy, r.x + r.w - 1 - gap - 2, 1, "shelf", true);
        }
        for (let k = 0; k < 3; k++) { const x = rng.int(r.x + 1, r.x + r.w - 2), y = rng.int(r.y + 1, r.y + r.h - 2); if (place(r, x, y, 1, 1, "crate", false)) lootAt(r, x, y, 0.5); }
        break;
      }
      case "armory": {
        for (let xx = r.x + 1; xx < r.x + r.w - 1; xx += 2) place(r, xx, r.y, 1, 1, "gunrack", true);
        for (let k = 0; k < 3; k++) { const x = r.x + 2 + k * 3, y = r.y + r.h - 3; if (place(r, x, y, 2, 1, "crate", false)) lootAt(r, x, y, 0.8); }
        break;
      }
      case "executive": {
        if (place(r, cx - 1, cy - 1, 3, 1, "execdesk", false)) lootAt(r, cx, cy - 1, 0.7);
        for (let xx = r.x + 1; xx < r.x + r.w - 1; xx += 2) place(r, xx, r.y, 1, 1, "bookshelf", true);
        if (place(r, r.x + r.w - 1, r.y + r.h - 1, 1, 1, "safe", true))
          addI({ kind: "safe", x: r.x + r.w - 1, y: r.y + r.h - 1, room: r.id, item: crng.chance(0.5) ? "gold" : "watch", time: 6, label: "Crack safe" });
        break;
      }
      case "maintenance": {
        place(r, r.x + 1, r.y + 1, 2, 2, "boiler", true);
        for (let yy = r.y + 1; yy < r.y + r.h - 1; yy++) if (yy % 2) place(r, r.x + r.w - 1, yy, 1, 1, "pipes", true);
        const lx = r.x + 4, ly = r.y + r.h - 1;
        if (place(r, lx, ly, 1, 1, "locker", true)) addI({ kind: "locker", x: lx, y: ly, room: r.id, time: 0.3, label: "Hide" });
        lootAt(r, r.x + 1, r.y + 1, 0.4);
        break;
      }
      case "dock": {
        place(r, r.x + 2, r.y + 1, 6, 3, "trailer", true);
        for (let k = 0; k < 6; k++) {
          const x = rng.int(r.x + 2, r.x + r.w - 3), y = rng.int(r.y + 4, r.y + r.h - 3);
          if (place(r, x, y, rng.int(1, 2), 1, "crate", rng.chance(0.4))) lootAt(r, x, y, 0.25);
        }
        break;
      }
      case "lobby": {
        place(r, cx - 2, cy, 4, 1, "reception", false);
        place(r, r.x + 1, r.y + r.h - 2, 2, 1, "bench", false); place(r, r.x + r.w - 3, r.y + r.h - 2, 2, 1, "bench", false);
        place(r, r.x, r.y, 1, 1, "plant", true); place(r, r.x + r.w - 1, r.y, 1, 1, "plant", true);
        lootAt(r, cx - 1, cy, 0.4);
        break;
      }
      case "holding": {
        for (let xx = r.x + 1; xx < r.x + r.w - 1; xx++) if (xx !== r.x + 3 && xx !== r.x + r.w - 4) place(r, xx, r.y + 3, 1, 1, "bars", true);
        break;
      }
      case "vault": {
        for (let xx = r.x + 1; xx < r.x + r.w - 1; xx += 2) { place(r, xx, r.y, 1, 1, "deposit", true); place(r, xx, r.y + r.h - 1, 1, 1, "deposit", true); }
        place(r, cx, cy, 1, 1, "pedestal", false);
        lootAt(r, r.x + 2, r.y + 2, 0.8); lootAt(r, r.x + r.w - 3, r.y + r.h - 3, 0.6);
        break;
      }
    }
  }

  // alarm panels: security room and lobby (wall-mounted)
  const alarmPanels: number[] = [];
  for (const t of ["security", "lobby"] as RoomType[]) {
    const r = roomOf(t);
    const spots = wallSpots(r).filter(s => isFree(s.x, s.y) && !doorAdj(s.x, s.y) && s.x !== r.x && s.x !== r.x + r.w - 1);
    if (spots.length) { const s = spots[Math.floor(spots.length / 2)]; alarmPanels.push(addI({ kind: "alarmPanel", x: s.x, y: s.y, room: r.id, time: 3, label: "Cut alarm panel" }).id); }
  }
  // keycards: blue card in an ordinary room, red card carried by the chief
  {
    const opts = rooms.filter(r => (r.type === "office" || r.type === "lobby" || r.type === "dock" || r.type === "storage"));
    const r = crng.pick(opts);
    const p = freeTileIn(r, crng, isFree);
    if (p) addI({ kind: "keycard", x: p.x, y: p.y, room: r.id, item: "key1", time: 0.5, label: "Take blue keycard" });
  }

  // rare items that change the world once extracted
  const extracted = new Set(opts.stash);
  const rare = (item: string, t: RoomType, label: string, time: number) => {
    if (extracted.has(item)) return;
    const r = rooms.find(r => r.type === t); if (!r) return;
    const p = freeTileIn(r, new Rng(fac.seed + item.length), isFree); if (!p) return;
    addI({ kind: "loot", x: p.x, y: p.y, room: r.id, item, time, label });
  };
  if (contract.facility === "halvorsen") rare("rare_emp", "lab", "Pull capacitor core", 3);
  if (contract.facility === "kestrel") { rare("rare_manifest", "executive", "Take manifest", 1.5); rare("rare_keycopy", "security", "Clone master key", 5); }
  if (contract.facility === "meridian") rare("rare_radio", "security", "Take spare radio", 1.2);

  // ---------------------------------------------------------------- objective
  let objectiveRoom = -1;
  let hostage: Vec | undefined;
  const objRoomType: Record<string, RoomType[]> = {
    steal: memory.objectiveMoved ? ["executive", "armory", "vault"] : ["vault"], data: ["server"], sabotage: ["server", "lab"],
    rescue: ["holding", "storage"], investigate: ["office", "lab", "executive", "server"],
  };
  const pickRoom = (types: RoomType[]) => { for (const t of types) { const r = rooms.find(r => r.type === t); if (r) return r; } return rooms[0]; };
  if (contract.type === "steal") {
    const r = pickRoom(objRoomType.steal); objectiveRoom = r.id;
    const ped = props.find(p => p.kind === "pedestal" && roomAt[idx(p.x, p.y)] === r.id);
    const p = ped ? { x: ped.x, y: ped.y } : freeTileIn(r, crng, isFree)!;
    addI({ kind: "objective", x: p.x, y: p.y, room: r.id, item: contract.targetItem, time: 2, label: "Take " + "target" });
  } else if (contract.type === "data") {
    const r = pickRoom(objRoomType.data); objectiveRoom = r.id;
    const term = interactables.find(i => i.kind === "terminal" && i.room === r.id);
    if (term) { term.kind = "objective"; term.item = contract.targetItem; term.label = "Download files"; term.hidden = false; }
    else { const p = freeTileIn(r, crng, isFree)!; addI({ kind: "objective", x: p.x, y: p.y, room: r.id, item: contract.targetItem, time: 7, label: "Download files" }); }
  } else if (contract.type === "sabotage") {
    const r = pickRoom(crng.chance(0.5) ? ["server", "lab"] : ["lab", "server"]); objectiveRoom = r.id;
    const tall = props.filter(p => roomAt[idx(p.x, p.y)] === r.id && p.tall);
    const t = tall.length ? crng.pick(tall) : null;
    const p = t ? { x: t.x, y: t.y } : freeTileIn(r, crng, isFree)!;
    addI({ kind: "chargeSite", x: p.x, y: p.y, room: r.id, time: 4, label: "Plant charge" });
  } else if (contract.type === "rescue") {
    const r = pickRoom(objRoomType.rescue); objectiveRoom = r.id;
    const p = { x: r.x + 1, y: r.y + 1 };
    tiles[idx(p.x, p.y)] = T.FLOOR;
    hostage = { x: p.x + 0.5, y: p.y + 0.5 };
    addI({ kind: "hostage", x: p.x, y: p.y, room: r.id, time: 2, label: "Free detainee" });
  } else {
    const cands = rooms.filter(r => ["office", "lab", "executive", "server", "security", "storage"].includes(r.type));
    crng.shuffle(cands);
    objectiveRoom = cands[0].id;
    for (const r of cands.slice(0, 3)) {
      const p = freeTileIn(r, crng, isFree); if (!p) continue;
      addI({ kind: "evidence", x: p.x, y: p.y, room: r.id, time: 2.5, label: "Scan evidence" });
    }
  }

  // ---------------------------------------------------------------- lights
  const lights: Light[] = [];
  const addLight = (x: number, y: number, r: number, i: number, room: number, color = "#fff6e0", flicker = false) =>
    lights.push({ id: lights.length, x, y, r, i, on: true, offUntil: 0, flicker, color, room });
  for (const r of rooms) {
    if (r.dark && rng.chance(0.7)) { if (rng.chance(0.5)) addLight(r.x + r.w / 2, r.y + r.h / 2, 4, 0.55, r.id, "#ffd9a0", true); continue; }
    // pools of light with dark edges between them: shadows are the player's main resource
    const n = Math.max(1, Math.round((r.w * r.h) / 70));
    for (let k = 0; k < n; k++) {
      const lx = r.x + (r.w * (k + 0.5)) / n + (rng.next() - 0.5) * 2, ly = r.y + r.h / 2 + (rng.next() - 0.5) * 2;
      const color = r.type === "server" ? "#cfe6ff" : r.type === "lab" ? "#eef8ff" : r.type === "executive" ? "#ffe2b8" : "#f4f1e6";
      const bright = r.type === "lobby" || r.type === "security" || r.type === "lab";
      addLight(lx, ly, bright ? 5.6 : 4.6, r.type === "executive" ? 0.7 : bright ? 0.9 : 0.8, r.id, color, rng.chance(0.14));
    }
  }
  for (const e of entrances) {
    const d = doors[e.door];
    const out = e.id === "main" ? { x: d.x + 0.5, y: d.y - 1.5 } : e.id === "dock" ? { x: d.x + 0.5, y: d.y + 1.5 } : { x: d.x + (d.x === bx0 ? -1 : 2), y: d.y + 0.5 };
    if (e.id !== "maint") addLight(out.x, out.y, e.id === "main" ? 7 : 6, 0.95, -1, "#fff0cf");
  }
  addLight(extraction.x, extraction.y, 3.2, 0.45, -1, "#ffcf8a");
  for (let x = bx0 + 6; x < bx1; x += 14) addLight(x, by0 - 3.5, 4.5, 0.55, -1, "#ffe6b3", rng.chance(0.25));

  // ---------------------------------------------------------------- cameras
  const cameras: Camera[] = [];
  const hardenedSet = memory.hardenedCams.map(v => `${v.x},${v.y}`);
  const addCam = (x: number, y: number, towardX: number, towardY: number, room: number, sweep = 0.75) => {
    if (cameras.some(c => Math.abs(c.x - x) < 1 && Math.abs(c.y - y) < 1)) return;
    const base = Math.atan2(towardY - y, towardX - x);
    cameras.push({ id: cameras.length, x, y, base, sweep, period: 7 + rng.next() * 4, phase: rng.next() * 6.28, fov: 0.95, range: 7.5,
      angle: base, suspicion: 0, state: "active", empUntil: 0, hardened: hardenedSet.includes(`${Math.floor(x)},${Math.floor(y)}`), room, reported: -99 });
  };
  const cornerCam = (r: Room, which: number) => {
    const corners = [[r.x + 0.3, r.y + 0.3], [r.x + r.w - 0.3, r.y + 0.3], [r.x + 0.3, r.y + r.h - 0.3], [r.x + r.w - 0.3, r.y + r.h - 0.3]];
    const [x, y] = corners[which % 4];
    addCam(x, y, r.x + r.w / 2, r.y + r.h / 2, r.id);
  };
  for (const r of rooms) {
    if (r.type === "lobby") cornerCam(r, rng.int(0, 1));
    if (r.type === "server" || r.type === "vault" || r.type === "executive" || r.type === "armory") cornerCam(r, rng.int(0, 3));
  }
  // outside the main entrance and the dock
  const mainDoor = doors[entrances[0].door], dockDoor = doors[entrances[1].door], maintDoor = doors[entrances[2].door];
  addCam(mainDoor.x + 3.5, by0 - 0.3, mainDoor.x, by0 - 4, -1);
  addCam(dockDoor.x - 3.5, by1 + 0.7, dockDoor.x, by1 + 5, -1);
  // memory: cameras installed where the player keeps coming in, or where they destroyed one before
  for (const e of memory.extraCams) {
    if (e === "maint") addCam(maintDoor.x + (maintDoor.x === bx0 ? -0.3 : 1.3), maintDoor.y - 3, maintDoor.x + (maintDoor.x === bx0 ? -4 : 5), maintDoor.y, -1, 0.5);
    if (e === "main") { const r = lobby; addCam(r.x + r.w - 0.3, r.y + r.h - 0.3, r.x + r.w / 2, r.y, r.id); }
    if (e === "dock") { const r = dock; addCam(r.x + 0.3, r.y + r.h - 0.3, r.x + r.w, r.y, r.id); }
  }
  for (const v of memory.hardenedCams) {
    const r = roomAt[idx(Math.floor(v.x), Math.floor(v.y))];
    const room = r >= 0 ? rooms[r] : null;
    addCam(v.x, v.y, room ? room.x + room.w / 2 : v.x, room ? room.y + room.h / 2 : v.y + 3, r);
    const c = cameras[cameras.length - 1]; if (c) c.hardened = true;
  }
  for (let k = 0; k < Math.floor(memory.heat / 2); k++) {
    const r = rooms.filter(r => !r.dark && r.type !== "vault")[(k * 3 + 1) % rooms.length] ?? rooms[1];
    if (r) cornerCam(r, k + 2);
  }

  // ---------------------------------------------------------------- guards
  const guards: GuardSpec[] = [];
  const passableRooms = rooms.filter(r => r.type !== "vault" && r.type !== "holding");
  const neighbors = (rid: number) => doors.filter(d => d.rooms.includes(rid) && !d.exterior && d.lock < 2).map(d => (d.rooms[0] === rid ? d.rooms[1] : d.rooms[0]));
  const makeRoute = (start: Room, len: number): Vec[] => {
    const route: Vec[] = []; let cur = start.id; const visited = [cur];
    for (let k = 0; k < len; k++) {
      const r = rooms[cur];
      const p = freeTileIn(r, crng, isFree); if (p) route.push({ x: p.x + 0.5, y: p.y + 0.5 });
      const nb = neighbors(cur).filter(n => !visited.includes(n) && rooms[n].type !== "vault" && rooms[n].type !== "holding");
      if (!nb.length) break;
      cur = crng.pick(nb); visited.push(cur);
    }
    return route.length ? route : [{ x: start.x + start.w / 2, y: start.y + start.h / 2 }];
  };
  const baseCount = Math.round((cols * rows) / 2.6) + Math.floor(memory.heat * 0.8) + (contract.facility === "blacksite" ? 2 : 0);
  const heavy = memory.contractors || contract.facility === "blacksite";
  // posted guard in security control, watching the monitors
  const sec = roomOf("security");
  const sp = freeTileIn(sec, crng, isFree);
  if (sp) guards.push({ x: sp.x + 0.5, y: sp.y + 0.5, route: [{ x: sp.x + 0.5, y: sp.y + 0.5 }], post: true, kind: "guard", key: 1, facing: -Math.PI / 2 });
  for (let k = 0; k < baseCount; k++) {
    const start = passableRooms[crng.int(0, passableRooms.length - 1)];
    const route = makeRoute(start, crng.int(2, 4));
    guards.push({ x: route[0].x, y: route[0].y, route, kind: heavy && k % 2 === 0 ? "contractor" : "guard", key: crng.chance(0.3) ? 1 : 0, facing: crng.next() * 6.28 });
  }
  // head of security: patrols widely, or (if you spared them) watches the entrance you favour
  const chief = memory.chief;
  if (chief.status !== "leaked") {
    const fav = favouriteEntrance(memory);
    let route: Vec[];
    if (chief.status === "spared" && fav) {
      const e = entrances.find(e => e.id === fav)!;
      const d = doors[e.door]; const r = rooms[d.rooms[0]];
      const p = freeTileIn(r, crng, isFree) ?? { x: r.x + 1, y: r.y + 1 };
      route = [{ x: p.x + 0.5, y: p.y + 0.5 }, { x: r.x + r.w / 2, y: r.y + r.h / 2 }];
    } else route = makeRoute(passableRooms[crng.int(0, passableRooms.length - 1)], 5);
    guards.push({ x: route[0].x, y: route[0].y, route, kind: "chief", key: 2, name: chief.status === "killed" ? chief.replacement ?? chief.name : chief.name, facing: 0 });
  }
  // memory: a guard posted inside the entrance you keep using
  for (const e of memory.postedGuards) {
    const ent = entrances.find(x => x.id === e)!; const d = doors[ent.door];
    const want = e === "main" ? { x: d.x + 0.5, y: d.y + 2.5 } : e === "dock" ? { x: d.x + 0.5, y: d.y - 2.5 } : { x: d.x + (d.x === bx0 ? 2.5 : -1.5), y: d.y + 0.5 };
    const inside = nearestFree(want, isFree);
    guards.push({ x: inside.x, y: inside.y, route: [inside], post: true, kind: heavy ? "contractor" : "guard", key: 0,
      facing: Math.atan2(d.y + 0.5 - inside.y, d.x + 0.5 - inside.x) });
  }
  // exterior patrol once the facility is on edge
  if (memory.heat >= 2) {
    const loop = [{ x: bx0 - 2, y: by0 - 2 }, { x: bx1 + 2, y: by0 - 2 }, { x: bx1 + 2, y: by1 + 2 }, { x: bx0 - 2, y: by1 + 2 }];
    guards.push({ x: loop[0].x, y: loop[0].y, route: loop, kind: "guard", key: 0, facing: 0 });
  }

  // walls around secure rooms, the outer shell, and anything rebuilt after a breach are reinforced
  const reinforced = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (tiles[i] !== T.WALL) continue;
    if (x <= bx0 || x >= bx1 || y <= by0 || y >= by1) { reinforced.add(i); continue; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = roomAt[idx(x + dx, y + dy)];
      if (r >= 0 && rooms[r].lock === 2) reinforced.add(i);
    }
  }
  for (const v of memory.breachedWalls ?? []) reinforced.add(idx(Math.floor(v.x), Math.floor(v.y)));
  return { facility: contract.facility, seed: fac.seed, w, h, tiles, roomAt, rooms, doors, doorAt, lights, cameras, interactables, entrances,
    extraction, guards, props, objectiveRoom, alarmPanels, hostage, reinforced, wallHp: new Map(), version: 0 };
}

export function favouriteEntrance(m: FacilityMemory): EntranceId | undefined {
  const e = (Object.entries(m.entryUse) as [EntranceId, number][]).sort((a, b) => b[1] - a[1])[0];
  return e && e[1] > 0 ? e[0] : undefined;
}

function nearestFree(v: Vec, isFree: (x: number, y: number) => boolean): Vec {
  const x0 = Math.floor(v.x), y0 = Math.floor(v.y);
  for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (isFree(x0 + dx, y0 + dy)) return { x: x0 + dx + 0.5, y: y0 + dy + 0.5 };
  return v;
}

function freeTileIn(r: Room, rng: Rng, isFree: (x: number, y: number) => boolean): Vec | null {
  for (let k = 0; k < 60; k++) {
    const x = rng.int(r.x + 1, r.x + r.w - 2), y = rng.int(r.y + 1, r.y + r.h - 2);
    if (isFree(x, y)) return { x, y };
  }
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isFree(x, y)) return { x, y };
  return null;
}

// --------------------------------------------------------------------------- tile queries
export function blocksMove(level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return true;
  const t = level.tiles[y * level.w + x];
  if (t === T.FLOOR || t === T.EXT) return false;
  if (t === T.DOOR) return !level.doors[level.doorAt[y * level.w + x]].open;
  return true;
}
export function blocksSight(level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return true;
  const t = level.tiles[y * level.w + x];
  if (t === T.FLOOR || t === T.EXT || t === T.PROP_LOW) return false;
  if (t === T.DOOR) return !level.doors[level.doorAt[y * level.w + x]].open;
  return true;
}
