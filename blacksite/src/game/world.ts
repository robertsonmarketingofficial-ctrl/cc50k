// Persistent world state and the consequence engine: every change to the world has a cause the player can read.
import { FACILITIES, LOOT, MISSION_TEXT, repTier, UNLOCKS } from "./catalog";
import type {
  Contract, ContractOptional, EntranceId, FacilityId, FacilityMemory, IncidentReport, MissionResult, MissionType, SaveGame, Settings,
} from "./types";

export const SAVE_KEY = "blacksite.save.v2";
const ENTRANCE_NAMES: Record<EntranceId, string> = { main: "main entrance", dock: "loading dock", maint: "maintenance hatch" };

export function defaultMemory(f: FacilityId): FacilityMemory {
  return {
    visits: 0, entryUse: { main: 0, dock: 0, maint: 0 }, alarms: 0, lockdowns: 0, kills: 0, kos: 0,
    destroyedCams: [], breachedWalls: [], hardenedCams: [], extraCams: [], postedGuards: [], heat: f === "blacksite" ? 3 : 0, explored: "",
    chief: { name: FACILITIES[f].chief, status: "active", spared: 0, replacement: FACILITIES[f].replacement },
    contractors: false, terminalHardened: false, rota: false, blueprint: false, panelsReinforced: false, objectiveMoved: false,
    failures: 0, extractions: 0, lastRun: -1,
  };
}

export const DEFAULT_SETTINGS: Settings = { master: 0.8, sfx: 0.9, ambience: 0.7, shake: true, effects: true, hints: true };

export function newSave(): SaveGame {
  const s: SaveGame = {
    version: 2, createdAt: Date.now(), credits: 400, rep: 0, incident: 487, runs: 0,
    owned: ["p226", "mp5", "noisemaker", "breach"],
    loadout: { primary: "mp5", secondary: "p226", gadgets: ["breach", "noisemaker"], armor: false, pack: false },
    facilities: { halvorsen: defaultMemory("halvorsen"), meridian: defaultMemory("meridian"), kestrel: defaultMemory("kestrel"), blacksite: defaultMemory("blacksite") },
    story: [], contracts: [], reports: [], news: [], stash: [], inMission: null, settings: { ...DEFAULT_SETTINGS }, seenTutorial: false,
  };
  s.contracts = generateContracts(s);
  s.news.push({ run: 0, text: "A broker called OVERWATCH has offered you work. Three facilities, one rule: get out before zero hour." });
  return s;
}

export function loadSave(): { save: SaveGame | null; error?: string } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { save: null };
    const s = JSON.parse(raw) as SaveGame;
    if (!s || s.version !== 2 || !s.facilities || !Array.isArray(s.contracts)) throw new Error("bad save");
    // forward-fill any fields added since the save was written
    for (const f of Object.keys(FACILITIES) as FacilityId[]) s.facilities[f] = { ...defaultMemory(f), ...(s.facilities[f] ?? {}) };
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
    if (!s.owned.includes("breach")) s.owned.push("breach");
    // weapon line-up v3: map old guns onto real ones
    const remap: Record<string, string> = { pistol: "p226", smg: "mp5", shotgun: "m870" };
    s.owned = [...new Set(s.owned.map(o => remap[o] ?? o).concat(["p226", "mp5"]))];
    const lo = s.loadout as any;
    lo.primary = lo.primary ? remap[lo.primary] ?? lo.primary : "mp5";
    lo.secondary = lo.secondary ?? "p226";
    if (!s.contracts.length) s.contracts = generateContracts(s);
    return { save: s };
  } catch {
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) localStorage.setItem(SAVE_KEY + ".corrupt", raw); } catch { /* storage unavailable */ }
    return { save: null, error: "Your save file couldn't be read, so a new one was started. The old file was kept as a backup." };
  }
}

export function writeSave(s: SaveGame): boolean {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function hasSave(): boolean { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
export function wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// ------------------------------------------------------------------------------------ contracts
const TARGET: Record<MissionType, string> = { steal: "obj_prototype", data: "obj_data", sabotage: "obj_data", rescue: "obj_data", investigate: "obj_evidence" };
const CLIENTS = ["Anonymous broker", "A rival lab", "An insurance investigator", "A journalist's source", "A shareholder with questions", "Someone who pays in advance"];

function optionalPool(type: MissionType): ContractOptional[] {
  const out: ContractOptional[] = [
    { id: "ghost", label: "Ghost: never raise the alert above CAUTION", bonus: 500 },
    { id: "nonlethal", label: "Non-lethal: kill no one", bonus: 300 },
    { id: "safe", label: "Crack the executive safe and extract its contents", bonus: 350 },
    { id: "loop", label: "Loop the camera feeds from security control", bonus: 250 },
    { id: "haul", label: "Extract ₵1,200 or more in loot", bonus: 400 },
  ];
  if (type === "sabotage") out.push({ id: "beforezero", label: "Detonate before zero hour", bonus: 300 });
  return out;
}

export function generateContracts(s: SaveGame): Contract[] {
  const tier = repTier(s.rep);
  const types: MissionType[] = tier >= 2 ? ["steal", "data", "investigate", "sabotage", "rescue"] : tier >= 1 ? ["steal", "data", "investigate", "sabotage"] : ["steal", "data", "investigate"];
  const out: Contract[] = [];
  const rnd = () => Math.random();
  const seed = () => Math.floor(rnd() * 2 ** 31);
  const story = storyContract(s);
  if (story) out.push(story);
  const facs: FacilityId[] = ["halvorsen", "meridian", "kestrel"];
  const shuffled = facs.sort(() => rnd() - 0.5);
  for (const f of shuffled) {
    if (out.length >= 3) break;
    if (story && story.facility === f) continue;
    const type = types[Math.floor(rnd() * types.length)];
    out.push(makeContract(s, f, type, seed()));
  }
  return out;
}

function makeContract(s: SaveGame, f: FacilityId, type: MissionType, seedN: number): Contract {
  const m = s.facilities[f];
  const base: Record<MissionType, number> = { steal: 1400, data: 1200, investigate: 1100, sabotage: 1600, rescue: 1900 };
  const hazard = 1 + m.heat * 0.12;
  const pool = optionalPool(type).sort(() => Math.random() - 0.5).slice(0, 2);
  const fac = FACILITIES[f];
  const target: Record<MissionType, string> = {
    steal: `the HALCYON prototype from ${fac.short}'s secure store`, data: `a classified data set from ${fac.short}'s servers`,
    investigate: `evidence of what ${fac.short} is really doing at night`, sabotage: `${fac.short}'s research servers`, rescue: `a detainee held at ${fac.short}`,
  };
  const title = `${MISSION_TEXT[type].verb} ${type === "sabotage" ? "the core" : type === "rescue" ? "the detainee" : type === "investigate" ? "the night shift" : type === "data" ? "the archive" : "the prototype"}`;
  return {
    id: "c" + seedN.toString(36), facility: f, type, title, client: CLIENTS[seedN % CLIENTS.length],
    brief: `${MISSION_TEXT[type].desc} Target: ${target[type]}.${m.heat >= 2 ? " Hazard pay included: they're expecting trouble." : ""}`,
    targetItem: TARGET[type], payout: Math.round((base[type] * hazard) / 50) * 50, rep: 180 + (type === "rescue" || type === "sabotage" ? 60 : 0) + m.heat * 20,
    optionals: pool, seed: seedN,
  };
}

function storyContract(s: SaveGame): Contract | null {
  const has = (f: string) => s.story.includes(f);
  const seedN = Math.floor(Math.random() * 2 ** 31);
  if (has("manifest") && !has("castell_rescued")) {
    return { id: "story-castell", facility: "halvorsen", type: "rescue", title: "The personnel transfer", client: "OVERWATCH",
      brief: "The Kestrel manifest was right: Dr. Imre Castell, a pulse-weapons engineer, is being held at Halvorsen Site 4. Get her out. She can't run, so plan your route.",
      targetItem: "obj_data", payout: 2600, rep: 420, optionals: [{ id: "nonlethal", label: "Non-lethal: kill no one", bonus: 400 }, { id: "ghost", label: "Ghost: never raise the alert above CAUTION", bonus: 600 }], story: "castell", seed: seedN };
  }
  if (has("castell_rescued") && !has("file")) {
    return { id: "story-file", facility: "meridian", type: "data", title: "The ZERO HOUR file", client: "Dr. Imre Castell",
      brief: "Castell says Halvorsen, Kestrel and Meridian are fronts for one programme. Its coordinates are in a file on Meridian's servers called ZERO HOUR. Pull it.",
      targetItem: "obj_file", payout: 3000, rep: 500, optionals: [{ id: "ghost", label: "Ghost: never raise the alert above CAUTION", bonus: 700 }, { id: "loop", label: "Loop the camera feeds from security control", bonus: 300 }], story: "file", seed: seedN };
  }
  if (has("file") && !has("finale")) {
    return { id: "story-blacksite", facility: "blacksite", type: "steal", title: "Zero hour", client: "Nobody. This one's yours.",
      brief: "The coordinates lead to BLACKSITE ZERO. Whatever they've been building across three facilities is in its vault. Take it, and they have nothing left to protect.",
      targetItem: "obj_core", payout: 6000, rep: 900, optionals: [{ id: "nonlethal", label: "Non-lethal: kill no one", bonus: 800 }, { id: "haul", label: "Extract ₵1,200 or more in loot", bonus: 500 }], story: "finale", seed: seedN };
  }
  if (!has("manifest") && s.runs >= 2 && !s.stash.includes("rare_manifest")) {
    return { id: "story-kestrel", facility: "kestrel", type: "steal", title: "Something in the paperwork", client: "OVERWATCH",
      brief: "A buyer wants Kestrel's prototype shipment. Word is the executive safe also holds a transfer manifest people have died over. The safe is optional. The manifest isn't nothing.",
      targetItem: "obj_prototype", payout: 1700, rep: 260, optionals: [{ id: "safe", label: "Crack the executive safe and extract its contents", bonus: 600 }, { id: "ghost", label: "Ghost: never raise the alert above CAUTION", bonus: 500 }], seed: seedN };
  }
  return null;
}

// ------------------------------------------------------------------------------------ explored map RLE
export function encodeExplored(bits: Uint8Array): string {
  let out = ""; let cur = 0, run = 0;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i] ? 1 : 0;
    if (b === cur) run++; else { out += run.toString(36) + ","; cur = b; run = 1; }
  }
  return out + run.toString(36);
}
export function decodeExplored(s: string, n: number): Uint8Array {
  const bits = new Uint8Array(n); if (!s) return bits;
  let i = 0, cur = 0;
  for (const part of s.split(",")) { const run = parseInt(part, 36) || 0; if (cur) bits.fill(1, i, Math.min(n, i + run)); i += run; cur ^= 1; }
  return bits;
}

// ------------------------------------------------------------------------------------ consequences
export function clock(t: number): string {
  // mission clock: 23:47:00 start, 2 facility-seconds per real second
  const total = 23 * 3600 + 47 * 60 + Math.floor(t * 2);
  const h = Math.floor(total / 3600) % 24, m = Math.floor((total % 3600) / 60), sec = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function applyResult(save: SaveGame, contract: Contract, r: MissionResult): IncidentReport {
  const f = contract.facility;
  const fac = FACILITIES[f];
  const m = save.facilities[f];
  const consequences: { text: string; cause: string }[] = [];
  const unlocks: string[] = [];
  const say = (text: string, cause: string) => consequences.push({ text, cause });
  const extracted = r.outcome === "extracted";
  const objective = extracted && r.objectiveDone;
  save.runs++;
  save.incident++;
  m.visits++;
  m.lastRun = save.runs;
  if (!save.seenTutorial) save.seenTutorial = true;

  // --- entry habits
  for (const e of Object.keys(m.entryUse) as EntranceId[]) m.entryUse[e] = +(m.entryUse[e] * 0.6 + (e === r.entry ? 1 : 0)).toFixed(2);
  const use = m.entryUse[r.entry];
  const uses = Math.round(use * 10) / 10;
  if (use >= 1.55 && !m.extraCams.includes(r.entry)) {
    m.extraCams.push(r.entry);
    say(`New camera installed covering the ${ENTRANCE_NAMES[r.entry]}.`, `You've come in that way on repeat visits (usage score ${uses}).`);
  } else if (use >= 2.1 && !m.postedGuards.includes(r.entry)) {
    m.postedGuards.push(r.entry);
    say(`A guard is now posted inside the ${ENTRANCE_NAMES[r.entry]}.`, "It's become your habit, and they've noticed the pattern.");
  }
  for (const e of [...m.postedGuards]) if (m.entryUse[e] < 0.7) {
    m.postedGuards = m.postedGuards.filter(x => x !== e);
    say(`The guard posted at the ${ENTRANCE_NAMES[e]} has been reassigned.`, "Nobody has come through there in a while.");
  }
  m.lastEntry = r.entry;

  // --- security equipment
  if (r.camerasDestroyed.length) {
    m.hardenedCams.push(...r.camerasDestroyed.map(v => ({ x: v.x, y: v.y })));
    m.hardenedCams = m.hardenedCams.slice(-6);
    say(`${r.camerasDestroyed.length} destroyed camera${r.camerasDestroyed.length > 1 ? "s" : ""} replaced with shielded units that EMP can't disable.`, "You shot them out.");
  }
  if (r.breaches?.length) {
    m.breachedWalls = [...(m.breachedWalls ?? []), ...r.breaches.map(v => ({ x: v.x, y: v.y }))].slice(-16);
    say(`${r.breaches.length} breached wall section${r.breaches.length > 1 ? "s" : ""} rebuilt with steel reinforcement. Charges won't go through them now.`, "You blew holes in their walls.");
  }
  if (r.loopedFeeds && !m.terminalHardened) {
    m.terminalHardened = true;
    say("Security control terminal re-secured. Looping the feeds will take twice as long.", "IT found the camera loop in the morning.");
  }
  if (r.panelsSabotaged > 0 && !m.panelsReinforced) {
    m.panelsReinforced = true;
    say("Alarm panels fitted with tamper seals. Cutting them now takes longer.", "Maintenance found cut wiring.");
  }

  // --- alarms and heat
  const oldHeat = m.heat;
  if (r.lockdown) { m.lockdowns++; m.alarms++; m.heat = Math.min(5, m.heat + 2); }
  else if (r.alarms > 0) { m.alarms++; m.heat = Math.min(5, m.heat + 1); }
  else if (extracted) m.heat = Math.max(0, m.heat - 1);
  if (r.outcome === "killed") m.heat = Math.min(5, m.heat + 1);
  // one bad night can't make a facility hopeless: at most +2 per incident
  m.heat = Math.min(m.heat, oldHeat + 2);
  if (m.heat > oldHeat) say(`Security posture at ${fac.short} raised to level ${m.heat}.`, r.lockdown ? "Full lockdown during the incident." : r.outcome === "killed" ? "They caught an intruder and want to know who sent them." : "Guards raised the alert.");
  if (m.heat < oldHeat) say(`${fac.short} has relaxed to security level ${m.heat}.`, "Nobody noticed you were there.");
  // other facilities cool off while you're elsewhere
  for (const other of Object.keys(save.facilities) as FacilityId[]) {
    if (other === f) continue;
    const om = save.facilities[other];
    if (om.heat > (other === "blacksite" ? 3 : 0) && save.runs - om.lastRun >= 2 && om.visits > 0) {
      om.heat--; save.news.push({ run: save.runs, facility: other, text: `${FACILITIES[other].short} has stood down to security level ${om.heat}. Nothing's happened there in a while.` });
    }
  }

  // --- people
  m.kills += r.kills; m.kos += r.kos;
  if (r.kills >= 1 && m.kills >= 3 && !m.contractors) {
    m.contractors = true;
    say(`${fac.short} has hired armed contractors. They're armoured and quicker to shoot.`, `${m.kills} security staff have died there.`);
  }
  if (m.contractors && r.kills === 0 && extracted && m.heat <= 1 && oldHeat <= 1) {
    m.contractors = false;
    say("The contractors' contract wasn't renewed.", "Quiet nights are cheaper than contractors.");
  }
  const chief = m.chief;
  if (r.chief === "spared" && chief.status === "active") {
    chief.spared++;
    if (chief.spared >= 2) {
      chief.status = "leaked"; m.rota = true;
      say(`${chief.name} resigned. An anonymous message arrived with the full ${fac.short} patrol rota.`, "You knocked them out twice and let them live. Twice.");
      unlocks.push(`Patrol routes at ${fac.short} are now shown on your map`);
    } else {
      chief.status = "spared";
      say(`${chief.name} survived and remembers you. They'll be watching the entrance you favour.`, "You knocked them out instead of killing them.");
    }
  } else if (r.chief === "spared" && chief.status === "spared") {
    chief.spared++; chief.status = "leaked"; m.rota = true;
    say(`${chief.name} resigned. An anonymous message arrived with the full ${fac.short} patrol rota.`, "You spared them a second time.");
    unlocks.push(`Patrol routes at ${fac.short} are now shown on your map`);
  } else if (r.chief === "killed" && chief.status !== "killed") {
    const was = chief.name;
    chief.status = "killed"; chief.name = chief.replacement ?? chief.name;
    if (!m.contractors) m.contractors = true;
    say(`${chief.name} has taken over security and brought contractors.`, `${was} was killed.`);
  }

  // --- objective and failure
  const target = LOOT[contract.targetItem]?.name ?? "the target";
  if (!objective) {
    m.failures++;
    if (contract.type === "steal" && !m.objectiveMoved) { m.objectiveMoved = true; say(`${target} moved out of the vault to a different room.`, "They know someone came for it."); }
  } else {
    m.extractions++;
    if (m.objectiveMoved) m.objectiveMoved = false;
  }

  // --- loot and rare items
  let lootValue = 0;
  const recovered: IncidentReport["recovered"] = [];
  const kept = extracted ? r.loot : [];
  for (const id of kept) {
    const d = LOOT[id]; if (!d || d.size === 0) continue;
    if (id.startsWith("obj_")) { recovered.push({ name: d.name.toUpperCase(), value: 0 }); continue; }
    lootValue += d.value;
    recovered.push({ name: d.name.toUpperCase(), value: d.value, rare: d.rare });
    if (d.rare && !save.stash.includes(id)) {
      save.stash.push(id);
      if (id === "rare_emp") { if (!save.owned.includes("emp")) save.owned.push("emp"); unlocks.push("Fabricator: EMP charges added to your loadout options"); say("Halvorsen's pulse research is set back by months.", "You took the capacitor core."); }
      if (id === "rare_manifest") { save.story.push("manifest"); unlocks.push("New contract: The personnel transfer (Halvorsen)"); say("Kestrel's legal team is shredding paperwork.", "The transfer manifest went missing."); }
      if (id === "rare_keycopy") { save.story.push("kestrel_key"); unlocks.push("Red-clearance doors at Kestrel now open for you"); say("Kestrel hasn't noticed their master key was cloned. Yet.", "You copied it."); }
      if (id === "rare_radio") { save.story.push("radio"); unlocks.push("You can now hear security radio traffic: callouts show where guards are"); say("Meridian re-issued radios, but kept the same channel.", "A radio went missing from security control."); }
    }
  }
  if (r.hostageRescued && contract.story === "castell") {
    if (!save.story.includes("castell_rescued")) save.story.push("castell_rescued");
    if (!save.owned.includes("thermal")) save.owned.push("thermal");
    unlocks.push("Dr. Castell built you a thermal optic"); unlocks.push("New contract: The ZERO HOUR file (Meridian)");
    say("Halvorsen reported Dr. Castell as 'resigned'.", "You walked her out.");
  }
  if (objective && contract.story === "file" && !save.story.includes("file")) { save.story.push("file"); unlocks.push("New location: BLACKSITE ZERO"); }
  if (objective && contract.story === "finale" && !save.story.includes("finale")) { save.story.push("finale"); unlocks.push("You finished the programme. The contracts keep coming."); }

  // --- money
  const breakdown: { label: string; amount: number }[] = [];
  if (objective) breakdown.push({ label: `Contract: ${contract.title}`, amount: contract.payout });
  if (lootValue) breakdown.push({ label: "Fenced loot", amount: lootValue });
  for (const o of contract.optionals) if (extracted && r.optionalsDone.includes(o.id)) breakdown.push({ label: `Bonus: ${o.label.split(":")[0]}`, amount: o.bonus });
  if (r.outcome === "killed") { const fee = Math.min(save.credits, 250); if (fee) breakdown.push({ label: "Body recovery and cleanup", amount: -fee }); say("Your gear was recovered by security and studied.", "You didn't make it out."); }
  const credits = breakdown.reduce((a, b) => a + b.amount, 0);
  save.credits = Math.max(0, save.credits + credits);
  const repGain = objective ? contract.rep : extracted ? Math.round(contract.rep * 0.25) : 0;
  const beforeTier = repTier(save.rep);
  save.rep += repGain;
  if (repTier(save.rep) > beforeTier) unlocks.push(`Reputation tier ${repTier(save.rep)}: new equipment and contract types at the supplier`);
  for (const u of UNLOCKS) if (u.rep === repTier(save.rep) && repTier(save.rep) > beforeTier && u.cost > 0) unlocks.push(`Supplier stock: ${u.name}`);

  // --- explored map
  m.explored = r.explored;

  // --- report
  const outcome: IncidentReport["outcome"] = r.outcome === "killed" ? "killed" : r.outcome === "aborted" ? "aborted" : objective ? "extracted" : "partial";
  const response = r.lockdown ? "FULL LOCKDOWN" : r.alarms > 0 ? "ELEVATED" : r.spotted > 0 ? "ROUTINE SEARCH" : "NONE. INTRUSION NOT DETECTED";
  const lines = r.events.map(e => ({ t: clock(e.time).slice(0, 5), text: e.text, tone: e.tone }));
  const report: IncidentReport = {
    number: save.incident, facility: f, facilityName: fac.name, contractTitle: contract.title, outcome, lines, recovered, response,
    casualties: { kills: r.kills, kos: r.kos }, consequences, credits, breakdown, rep: repGain, unlocks, duration: r.duration,
    date: nightLabel(save.runs),
  };
  save.reports.unshift(report);
  save.reports = save.reports.slice(0, 30);
  for (const c of consequences) save.news.push({ run: save.runs, facility: f, text: `${fac.short}: ${c.text}` });
  save.news = save.news.slice(-40);
  save.inMission = null;
  save.contracts = generateContracts(save);
  return report;
}

export function nightLabel(run: number): string {
  const d = new Date(Date.UTC(2031, 10, 3 + run));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** Intel shown in the briefing: what you know about this place and why. */
export function facilityIntel(save: SaveGame, f: FacilityId): { label: string; detail: string; tone?: "red" | "amber" }[] {
  const m = save.facilities[f];
  const out: { label: string; detail: string; tone?: "red" | "amber" }[] = [];
  if (!m.visits) out.push({ label: "First visit", detail: "No layout on file. You'll map it as you go." });
  else out.push({ label: `Visited ${m.visits}×`, detail: "Rooms you've seen before are on your map." });
  out.push({ label: `Security level ${m.heat}`, detail: m.heat >= 3 ? "They're expecting you. More guards, more cameras." : m.heat >= 1 ? "Some extra patrols since your last visit." : "Routine night shift.", tone: m.heat >= 3 ? "red" : m.heat >= 1 ? "amber" : undefined });
  if (m.contractors) out.push({ label: "Contractors on site", detail: "Armoured, quicker to shoot. Avoid fair fights.", tone: "red" });
  if (m.chief.status === "spared") out.push({ label: `${m.chief.name} is back`, detail: "They remember you and will watch your favourite entrance.", tone: "amber" });
  if (m.chief.status === "killed") out.push({ label: `${m.chief.name} in charge`, detail: "The replacement brought contractors.", tone: "red" });
  if (m.chief.status === "leaked") out.push({ label: "Patrol rota leaked", detail: "Guard routes are marked on your map." });
  for (const e of m.extraCams) out.push({ label: `Camera at ${ENTRANCE_NAMES[e]}`, detail: "Installed because you kept using it.", tone: "amber" });
  for (const e of m.postedGuards) out.push({ label: `Guard posted at ${ENTRANCE_NAMES[e]}`, detail: "Your habit has become their routine.", tone: "red" });
  if (m.hardenedCams.length) out.push({ label: `${m.hardenedCams.length} shielded camera${m.hardenedCams.length > 1 ? "s" : ""}`, detail: "Replacements for the ones you shot. EMP won't touch them.", tone: "amber" });
  if (m.breachedWalls?.length) out.push({ label: `${m.breachedWalls.length} wall section${m.breachedWalls.length > 1 ? "s" : ""} reinforced`, detail: "Steel plating where you breached last time. Find another way through.", tone: "amber" });
  if (m.terminalHardened) out.push({ label: "Camera loop patched", detail: "Security control takes twice as long to breach." });
  if (m.objectiveMoved) out.push({ label: "Target relocated", detail: "After the last failed attempt it isn't in the vault any more.", tone: "amber" });
  if (f === "kestrel" && save.story.includes("kestrel_key")) out.push({ label: "Cloned master key", detail: "Red-clearance doors open for you here." });
  return out;
}
