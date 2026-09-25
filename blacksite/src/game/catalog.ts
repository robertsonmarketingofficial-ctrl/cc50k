import type { FacilityId, GadgetId, LootDef, MissionType, RoomType, WeaponId } from "./types";

export interface WeaponDef {
  id: WeaponId; name: string; short: string;
  damage: number; pellets: number; spread: number; rate: number; // shots/sec
  mag: number; reserve: number; reload: number; range: number;
  noise: number; // radius in tiles that guards hear
  desc: string; tradeoff: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: "pistol", name: "Sable P9 (suppressed)", short: "P9-S",
    damage: 55, pellets: 1, spread: 0.025, rate: 2.6, mag: 10, reserve: 30, reload: 1.3, range: 14, noise: 4.5,
    desc: "Integral suppressor. Drops an unaware target in one shot, an alert one in two.",
    tradeoff: "Quiet, not silent: anyone within a few metres still hears it.",
  },
  smg: {
    id: "smg", name: "Vekta MP-9", short: "MP-9",
    damage: 24, pellets: 1, spread: 0.09, rate: 11, mag: 30, reserve: 60, reload: 1.9, range: 11, noise: 16,
    desc: "Fast, forgiving, loud. Wins fights you shouldn't have started.",
    tradeoff: "Every burst is heard across half the facility.",
  },
  shotgun: {
    id: "shotgun", name: "Halden 12 breacher", short: "H-12",
    damage: 19, pellets: 8, spread: 0.22, rate: 1.4, mag: 5, reserve: 15, reload: 2.6, range: 7, noise: 18,
    desc: "Ends any close fight in one trigger pull. Blows locks off doors instantly.",
    tradeoff: "Short range, slow reload, and the loudest thing in the building.",
  },
};

export interface GadgetDef { id: GadgetId; name: string; key: string; count: number; desc: string }
export const GADGETS: Record<GadgetId, GadgetDef> = {
  noisemaker: { id: "noisemaker", name: "Noisemaker", key: "G", count: 3, desc: "Thrown beacon that clatters and chirps. Pulls nearby guards to investigate." },
  emp: { id: "emp", name: "EMP charge", key: "3·4", count: 2, desc: "Knocks out cameras, lights and electronic locks in a radius for 12 seconds." },
  breach: { id: "breach", name: "Breach charge", key: "3·4", count: 3, desc: "Soft-breach explosive. Stick it on an interior wall and it blows a hole you can walk through. Very loud." },
  thermal: { id: "thermal", name: "Thermal optic", key: "T", count: 99, desc: "Pulse that shows everyone within 18m through walls for 3 seconds. 20s recharge." },
};

export const LOOT: Record<string, LootDef> = {
  cash: { id: "cash", name: "Petty cash", value: 120, size: 1, desc: "Loose bills from a desk drawer." },
  laptop: { id: "laptop", name: "Corporate laptop", value: 380, size: 2, desc: "Unencrypted, surprisingly." },
  docs: { id: "docs", name: "Internal memos", value: 220, size: 1, desc: "Someone will pay to read these." },
  sample: { id: "sample", name: "Sealed sample case", value: 650, size: 2, desc: "Cold to the touch. Labelled in a numbering scheme you don't recognise." },
  drive: { id: "drive", name: "Encrypted drive", value: 480, size: 1, desc: "Military-grade shell. Buyers exist." },
  watch: { id: "watch", name: "Executive watch", value: 540, size: 1, desc: "Left in a desk. Of course it was." },
  ammo: { id: "ammo", name: "Ammunition", value: 0, size: 0, desc: "Refills reserve ammunition." },
  medkit: { id: "medkit", name: "Trauma kit", value: 0, size: 0, desc: "Restores health." },
  gold: { id: "gold", name: "Bearer bonds", value: 1400, size: 2, desc: "Untraceable. Heavy responsibility." },
  // objective items
  obj_prototype: { id: "obj_prototype", name: "HALCYON prototype", value: 0, size: 2, desc: "The contract target." },
  obj_data: { id: "obj_data", name: "Classified data drive", value: 0, size: 1, desc: "The contract target." },
  obj_evidence: { id: "obj_evidence", name: "Evidence bundle", value: 0, size: 1, desc: "Scans of everything you found." },
  obj_ledger: { id: "obj_ledger", name: "Shipping ledger", value: 0, size: 1, desc: "The contract target." },
  obj_file: { id: "obj_file", name: "ZERO HOUR file", value: 0, size: 1, desc: "The contract target." },
  obj_core: { id: "obj_core", name: "Blacksite core", value: 0, size: 3, desc: "The contract target." },
  // rare items: extracting them changes the world
  rare_emp: { id: "rare_emp", name: "EMP capacitor core", value: 300, size: 2, rare: true, desc: "A prototype pulse core. A fabricator could build charges from this." },
  rare_manifest: { id: "rare_manifest", name: "Transfer manifest", value: 200, size: 1, rare: true, desc: "Lists a 'personnel transfer' to Halvorsen Site 4. The personnel is a person." },
  rare_keycopy: { id: "rare_keycopy", name: "Cloned master keycard", value: 250, size: 1, rare: true, desc: "Opens red-clearance doors at the facility it came from." },
  rare_radio: { id: "rare_radio", name: "Security radio", value: 150, size: 1, rare: true, desc: "Tuned to their channel. You'll hear what they hear." },
};

export const FACILITIES: Record<FacilityId, {
  id: FacilityId; name: string; short: string; place: string; cols: number; rows: number;
  weights: Partial<Record<RoomType, number>>; chief: string; replacement: string; seed: number; blurb: string;
}> = {
  halvorsen: { id: "halvorsen", name: "Halvorsen Biotech, Site 4", short: "HALVORSEN S4", place: "Tidewater industrial estate", cols: 4, rows: 3,
    weights: { lab: 4, office: 2, storage: 1, server: 1 }, chief: "Sgt. Ruth Adair", replacement: "Contractor lead Ivo Brandt", seed: 4471,
    blurb: "Pharmaceutical R&D. Quiet night shift, old cameras, too many locked labs." },
  meridian: { id: "meridian", name: "Meridian Data Vault", short: "MERIDIAN DV", place: "North ring road, under the overpass", cols: 4, rows: 3,
    weights: { server: 4, office: 2, storage: 1, lab: 0.5 }, chief: "Chief Tomas Rekker", replacement: "Contractor lead Nia Okafor", seed: 9127,
    blurb: "Colocation and cold storage for people who don't want to be found." },
  kestrel: { id: "kestrel", name: "Kestrel Logistics Depot", short: "KESTREL LD", place: "Container terminal, berth 11", cols: 5, rows: 3,
    weights: { storage: 4, office: 2, maintenance: 1, server: 0.5 }, chief: "Yard boss Lena Oyelaran", replacement: "Contractor lead Pavel Hask", seed: 2305,
    blurb: "Bonded warehouse. Half the manifests are real." },
  blacksite: { id: "blacksite", name: "BLACKSITE ZERO", short: "BLACKSITE 0", place: "Location withheld", cols: 5, rows: 3,
    weights: { lab: 3, holding: 1, server: 2, armory: 1, storage: 1 }, chief: "Director Anika Voss", replacement: "Director Anika Voss", seed: 6660,
    blurb: "It isn't on any map. Everything you've taken led here." },
};

export const ROOM_NAMES: Record<RoomType, string[]> = {
  lobby: ["Reception", "Main lobby", "Entrance hall"],
  office: ["Open office", "Records office", "Admin", "Accounts", "Planning office"],
  security: ["Security control", "Guard station"],
  server: ["Server hall", "Server room", "Network core"],
  lab: ["Lab A", "Lab B", "Clean room", "Cold lab", "Research bay"],
  storage: ["Storage", "Stockroom", "Bonded store", "Archive"],
  armory: ["Armory"],
  executive: ["Executive suite", "Director's office"],
  maintenance: ["Maintenance", "Plant room", "Boiler room"],
  dock: ["Loading dock", "Goods-in"],
  holding: ["Holding cells", "Isolation"],
  vault: ["Vault", "Secure store"],
};

export const MISSION_TEXT: Record<MissionType, { verb: string; label: string; desc: string }> = {
  steal: { verb: "Steal", label: "STEAL", desc: "Take the target from secure storage and get it out." },
  data: { verb: "Retrieve", label: "RETRIEVE DATA", desc: "Hack a terminal and pull the files onto a drive." },
  sabotage: { verb: "Sabotage", label: "SABOTAGE", desc: "Plant a charge on the target. It will trigger a lockdown. Then run." },
  rescue: { verb: "Rescue", label: "RESCUE", desc: "Free a detainee and walk them out. They can't run." },
  investigate: { verb: "Investigate", label: "INVESTIGATE", desc: "Find and scan three pieces of evidence before anyone notices." },
};

export interface UnlockDef { id: string; name: string; kind: "weapon" | "gadget" | "gear" | "intel"; cost: number; rep: number; desc: string; requires?: string; hint?: string }
export const UNLOCKS: UnlockDef[] = [
  { id: "smg", name: "Vekta MP-9", kind: "weapon", cost: 900, rep: 1, desc: WEAPONS.smg.desc + " " + WEAPONS.smg.tradeoff },
  { id: "bypass", name: "Bypass kit", kind: "gear", cost: 700, rep: 0, desc: "Hacks locks and terminals 2.5× faster. Changes which routes are realistic." },
  { id: "noisemaker", name: "Noisemaker", kind: "gadget", cost: 0, rep: 0, desc: GADGETS.noisemaker.desc },
  { id: "breach", name: "Breach charges", kind: "gadget", cost: 0, rep: 0, desc: GADGETS.breach.desc },
  { id: "armor", name: "Soft armour vest", kind: "gear", cost: 1100, rep: 2, desc: "Takes about two extra hits. The plates rattle: sprinting is louder while you wear it." },
  { id: "pack", name: "Field pack", kind: "gear", cost: 800, rep: 1, desc: "Carry 10 units instead of 6. Heavier loads slow you down a little more." },
  { id: "shotgun", name: "Halden 12 breacher", kind: "weapon", cost: 1500, rep: 2, desc: WEAPONS.shotgun.desc + " " + WEAPONS.shotgun.tradeoff },
  { id: "emp", name: "EMP charges", kind: "gadget", cost: 1800, rep: 3, desc: GADGETS.emp.desc, hint: "Or extract the EMP capacitor core from Halvorsen's labs and a fabricator will build them for you." },
  { id: "thermal", name: "Thermal optic", kind: "gadget", cost: 0, rep: 99, desc: GADGETS.thermal.desc, requires: "castell_rescued", hint: "Not for sale. Dr. Castell built it, and would give it to someone who got her out." },
];

export const REP_TIERS = [0, 300, 800, 1600, 2800, 4500];
export function repTier(rep: number): number { let t = 0; REP_TIERS.forEach((v, i) => { if (rep >= v) t = i; }); return t; }
export const TIER_NAMES = ["Unknown", "Contractor", "Specialist", "Ghost", "Legend", "Myth"];

export function packCapacity(pack: boolean) { return pack ? 10 : 6; }
