# BLACKSITE: ZERO HOUR

A top-down tactical stealth extraction game for the browser. Get in, take what you came for, and get out
before midnight. Every facility remembers how you did it.

## Run it

```
npm install
npm run dev          # http://127.0.0.1:5173
npm test             # generator and world-memory tests
npm run build        # production build in dist/
npm run build:single # one self-contained HTML file in dist-single/
```

Keyboard and mouse. Progress saves in the browser (localStorage).

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim |
| Click | Shoot (hold for the SMG) |
| Shift | Sprint (loud) |
| C / Ctrl | Crouch (silent, harder to see) |
| E | Interact, take down a guard from behind, hold to hack locks, safes and terminals |
| R | Reload |
| 1 / 2, wheel | Switch weapon |
| Q / right-click | Throw noisemaker |
| G | Throw EMP (once unlocked) |
| T | Thermal pulse (once unlocked) |
| Tab | Pack: loot, capacity, bonus objectives, drop items |
| M | Live tactical map |
| Esc | Pause |

## How it plays

- **Stealth runs on light and sound.** Each tile has a light level that respects walls. Guards see you
  faster in light, when you move, and when you're standing. Their flashlights show where they're looking,
  and standing in a flashlight beam lights you up. Footsteps, doors, gunshots and tools make noise with a
  radius. Walls muffle it.
- **Guards work from evidence, not omniscience.** They go PATROL → SUSPICIOUS → INVESTIGATING → SEARCHING →
  RETURNING, or into COMBAT when they're sure. They radio each other (you overhear nearby traffic), find
  bodies, check lockers while searching, and one of them will run for an alarm panel. Cut the panel first
  and the lockdown never comes.
- **The facility escalates** from CALM to CAUTION, ALERT and LOCKDOWN (red lights, alarm, reinforcements).
  Searches calm down if you stay hidden.
- **Zero hour.** You go in at 23:47. At 00:00 (about 6.5 real minutes in) the second shift arrives.
- **Risk and reward.** After the objective the van is waiting, and everything else in the building is
  yours if you carry it out. Die and you lose what you're carrying.

## The world remembers

Each facility has a fixed floor plan (so you learn it) and a persistent memory that changes what's inside:

| You did this | The facility does this |
|---|---|
| Used the same entrance on repeat visits | Installs a camera there, then posts a guard. Stop using it and the guard is reassigned. |
| Shot out cameras | Replaces them with shielded units EMP can't touch |
| Looped the camera feeds | Re-secures the terminal (twice as slow) |
| Cut alarm panels | Fits tamper seals |
| Raised alarms or a lockdown | Raises its security level: more guards, more cameras. It cools off if you stay away. |
| Killed three or more staff | Hires armoured contractors. Quiet nights send them home. |
| Spared the head of security | They come back, remember you, and watch your favourite entrance. Spare them twice and they resign and leak the patrol rota. |
| Killed the head of security | A replacement takes over and brings contractors |
| Failed to steal the target | Moves it out of the vault |
| Extracted rare items | Unlocks things: EMP charges, a cloned master key, a radio on their channel, and a story lead |

Rooms you've seen stay on your map between visits. Every mission ends with an incident report from the
facility's own systems, including the corrective actions it took and why.

## Code map

- `src/game/facility.ts` builds facilities from modular rooms on a macro grid: a spanning tree plus loops,
  locked secure rooms, reachability repair, props that keep rooms connected, and memory-driven cameras and guards.
- `src/game/engine.ts` runs the simulation: player, guard state machine, perception, sound, cameras, alarms,
  gadgets, objectives and extraction.
- `src/game/world.ts` handles the save, contracts, the story chain and the consequence engine.
- `src/game/render.ts` draws with Canvas 2D: a static layer, a per-tile lightmap, flashlights, fog of war with memory, and post effects.
- `src/game/audio.ts` synthesises every sound with WebAudio. There are no asset files.
- `src/ui/*` holds the React screens: menu (with a live CCTV feed), safehouse, briefing, HUD, report and settings.
