// Shared game types. Units: 1 tile = 1 world unit; rendering scales tiles to pixels.

export type Vec = { x: number; y: number };

export enum T { VOID = 0, FLOOR = 1, WALL = 2, DOOR = 3, EXT = 4, PROP_LOW = 5, PROP_TALL = 6 }

export type RoomType =
  | "lobby" | "office" | "security" | "server" | "lab" | "storage" | "armory"
  | "executive" | "maintenance" | "dock" | "holding" | "vault";

export type EntranceId = "main" | "dock" | "maint";
export type WeaponId = "pistol" | "smg" | "shotgun";
export type GadgetId = "noisemaker" | "emp" | "thermal";
export type MissionType = "steal" | "data" | "sabotage" | "rescue" | "investigate";
export type AlertLevel = 0 | 1 | 2 | 3; // CALM, CAUTION, ALERT, LOCKDOWN
export type GuardState = "PATROL" | "SUSPICIOUS" | "INVESTIGATING" | "ALERT" | "SEARCHING" | "COMBAT" | "RETURNING" | "RAISING" | "DOWN";
export type FacilityId = "halvorsen" | "meridian" | "kestrel" | "blacksite";

export interface Room {
  id: number;
  type: RoomType;
  name: string;
  x: number; y: number; w: number; h: number; // interior floor rect (tiles)
  cells: number[];
  lock: 0 | 1 | 2;
  dark: boolean;
}

export interface Door {
  id: number;
  x: number; y: number;
  open: boolean;
  lock: 0 | 1 | 2;
  hack: number; // 0..1 progress
  rooms: [number, number]; // -1 = exterior
  exterior?: EntranceId;
  vertical: boolean; // door sits in a vertical wall (passage is horizontal)
}

export interface Light {
  id: number; x: number; y: number; r: number; i: number;
  on: boolean; offUntil: number; flicker: boolean; color: string; room: number;
}

export interface Camera {
  id: number; x: number; y: number;
  base: number; sweep: number; period: number; phase: number;
  fov: number; range: number;
  angle: number; suspicion: number;
  state: "active" | "emp" | "destroyed" | "looped";
  empUntil: number; hardened: boolean; room: number; reported: number;
}

export type InteractKind =
  | "loot" | "safe" | "terminal" | "secTerminal" | "alarmPanel" | "locker"
  | "objective" | "evidence" | "chargeSite" | "hostage" | "keycard";

export interface Interactable {
  id: number; kind: InteractKind; x: number; y: number; room: number;
  item?: string; // loot item id
  done: boolean;
  time: number; // seconds to complete (hold)
  progress: number;
  label: string;
  locked?: 0 | 1 | 2;
  hidden?: boolean;
}

export interface Entrance {
  id: EntranceId; name: string; door: number;
  spawn: Vec; // exterior spawn point
  note: string;
}

export interface GuardSpec {
  x: number; y: number; route: Vec[]; post?: boolean; kind: "guard" | "contractor" | "chief";
  key: 0 | 1 | 2; name?: string; facing: number;
}

export interface Level {
  facility: FacilityId;
  seed: number;
  w: number; h: number;
  tiles: Uint8Array;
  roomAt: Int16Array;
  rooms: Room[];
  doors: Door[];
  doorAt: Int16Array;
  lights: Light[];
  cameras: Camera[];
  interactables: Interactable[];
  entrances: Entrance[];
  extraction: Vec & { r: number; name: string };
  guards: GuardSpec[];
  props: { x: number; y: number; w: number; h: number; kind: string; tall: boolean }[];
  objectiveRoom: number;
  alarmPanels: number[]; // interactable ids
  hostage?: Vec;
}

export interface LootDef { id: string; name: string; value: number; size: number; rare?: boolean; desc: string }

export interface ContractOptional { id: string; label: string; bonus: number }

export interface Contract {
  id: string;
  facility: FacilityId;
  type: MissionType;
  title: string;
  client: string;
  brief: string;
  targetItem: string; // loot id delivered by objective
  payout: number;
  rep: number;
  optionals: ContractOptional[];
  story?: string; // story chain step id
  seed: number;
}

export interface HeadOfSecurity { name: string; status: "active" | "spared" | "leaked" | "killed"; spared: number; replacement?: string }

export interface FacilityMemory {
  visits: number;
  entryUse: Record<EntranceId, number>;
  lastEntry?: EntranceId;
  alarms: number;
  lockdowns: number;
  kills: number;
  kos: number;
  destroyedCams: Vec[];
  hardenedCams: Vec[];
  extraCams: EntranceId[];
  postedGuards: EntranceId[];
  heat: number; // 0..5
  explored: string; // run-length encoded explored tiles
  chief: HeadOfSecurity;
  contractors: boolean;
  terminalHardened: boolean;
  rota: boolean; // guard patrols known
  blueprint: boolean; // full map known
  panelsReinforced: boolean;
  objectiveMoved: boolean;
  failures: number;
  extractions: number;
  lastRun: number;
}

export interface IncidentLine { t: string; text: string; tone?: "red" | "amber" | "dim" }

export interface IncidentReport {
  number: number;
  facility: FacilityId;
  facilityName: string;
  contractTitle: string;
  outcome: "extracted" | "partial" | "killed" | "aborted" | "lost";
  lines: IncidentLine[];
  recovered: { name: string; value: number; rare?: boolean }[];
  response: string;
  casualties: { kills: number; kos: number };
  consequences: { text: string; cause: string }[];
  credits: number;
  breakdown: { label: string; amount: number }[];
  rep: number;
  unlocks: string[];
  duration: number;
  date: string;
}

export interface Settings {
  master: number; sfx: number; ambience: number;
  shake: boolean; effects: boolean; hints: boolean;
}

export interface Loadout {
  primary: WeaponId | null;
  gadgets: GadgetId[]; // max 2
  armor: boolean;
  pack: boolean;
}

export interface SaveGame {
  version: 2;
  createdAt: number;
  credits: number;
  rep: number;
  incident: number;
  runs: number;
  owned: string[]; // unlock ids
  loadout: Loadout;
  facilities: Record<FacilityId, FacilityMemory>;
  story: string[]; // story flags
  contracts: Contract[];
  reports: IncidentReport[];
  news: { run: number; text: string; facility?: FacilityId }[];
  stash: string[]; // rare items kept
  inMission: null | { contractId: string; started: number };
  settings: Settings;
  seenTutorial: boolean;
}

// What the game hands back to the meta layer when a mission ends.
export interface MissionResult {
  outcome: "extracted" | "killed" | "aborted";
  objectiveDone: boolean;
  optionalsDone: string[];
  loot: string[];
  entry: EntranceId;
  alarms: number;
  lockdown: boolean;
  kills: number;
  kos: number;
  camerasDestroyed: Vec[];
  camerasEmped: number;
  loopedFeeds: boolean;
  panelsSabotaged: number;
  chief: "untouched" | "spared" | "killed";
  explored: string;
  events: { time: number; text: string; tone?: "red" | "amber" | "dim" }[];
  duration: number;
  zeroHourPassed: boolean;
  shotsFired: number;
  hostageRescued: boolean;
  spotted: number;
}
