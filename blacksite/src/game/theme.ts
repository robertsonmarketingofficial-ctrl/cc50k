// Per-facility art direction: every map is daylit and grounded in a real place.
import type { FacilityId, RoomType } from "./types";

export interface Theme {
  id: FacilityId;
  label: string;
  sun: { elevation: number; azimuth: number; color: number; intensity: number };
  sky: { turbidity: number; rayleigh: number; mie: number; mieG: number };
  hemi: { sky: number; ground: number; intensity: number };
  exposure: number;
  fog: { color: number; near: number; far: number };
  interiorH: number; exteriorH: number;
  exterior: { wall: string; plinth: string; trim: string; ground: string; apron: string };
  interior: { wall: string; dado: "zellige" | "paint" | "wood" | "none"; dadoPalette?: string[]; dadoPaint?: string; ceiling: string; beams: boolean };
  floors: Partial<Record<RoomType | "corridor", { kind: "terracotta" | "paving" | "zellige" | "metal" | "wood"; tint: string }>>;
  lampColor: string;
  mountains: number | null;
  style: "border" | "villa" | "office" | "chalet";
}

export const THEMES: Record<FacilityId, Theme> = {
  kestrel: {
    id: "kestrel", label: "Desert border post", style: "border",
    sun: { elevation: 25, azimuth: 248, color: 0xffd6a2, intensity: 4.1 },
    sky: { turbidity: 2.4, rayleigh: 1.5, mie: 0.004, mieG: 0.82 },
    hemi: { sky: 0xa8c4ea, ground: 0xc98f58, intensity: 0.95 },
    exposure: 0.55,
    fog: { color: 0xdcc09a, near: 220, far: 1900 },
    interiorH: 3.3, exteriorH: 6.4,
    exterior: { wall: "#d9a877", plinth: "#b58a60", trim: "#e8d2b0", ground: "#d4ad7c", apron: "#cdb896" },
    interior: { wall: "#e6d2b4", dado: "zellige", dadoPalette: ["#1d5c78", "#2e7a5c", "#ede5d2", "#b4522c", "#1b2c48"], ceiling: "#eadcc4", beams: true },
    floors: {
      lobby: { kind: "paving", tint: "#e3d6bf" }, executive: { kind: "zellige", tint: "" }, office: { kind: "terracotta", tint: "#b8663f" },
      security: { kind: "terracotta", tint: "#a95e3c" }, server: { kind: "metal", tint: "#8f9597" }, lab: { kind: "paving", tint: "#e8e4dc" },
      storage: { kind: "paving", tint: "#b3a893" }, dock: { kind: "paving", tint: "#a89f8e" }, maintenance: { kind: "paving", tint: "#a39b8b" },
      armory: { kind: "paving", tint: "#a8a092" }, vault: { kind: "metal", tint: "#7f8588" }, holding: { kind: "paving", tint: "#b0a898" },
      corridor: { kind: "terracotta", tint: "#c07048" },
    },
    lampColor: "#ffd9a8", mountains: 0xa27853,
  },
  halvorsen: {
    id: "halvorsen", label: "Mediterranean villa", style: "villa",
    sun: { elevation: 42, azimuth: 150, color: 0xfff6e8, intensity: 3.3 },
    sky: { turbidity: 3.2, rayleigh: 1.1, mie: 0.004, mieG: 0.8 },
    hemi: { sky: 0xd4e6ff, ground: 0xb8a58c, intensity: 1.1 },
    exposure: 0.6,
    fog: { color: 0xd8e4ee, near: 110, far: 600 },
    interiorH: 3.4, exteriorH: 6.8,
    exterior: { wall: "#efe6d6", plinth: "#c9b89c", trim: "#f6f0e4", ground: "#9a8f6a", apron: "#d8ccb4" },
    interior: { wall: "#f1ebe0", dado: "paint", dadoPaint: "#d9d0c0", ceiling: "#f4efe6", beams: true },
    floors: {
      lobby: { kind: "paving", tint: "#e9e3d6" }, office: { kind: "wood", tint: "#8a5a36" }, executive: { kind: "wood", tint: "#6f4428" },
      lab: { kind: "paving", tint: "#eceae4" }, server: { kind: "metal", tint: "#9aa0a2" }, corridor: { kind: "terracotta", tint: "#c87a50" },
      storage: { kind: "paving", tint: "#bdb4a2" }, dock: { kind: "paving", tint: "#aaa290" }, security: { kind: "terracotta", tint: "#b8704a" },
    },
    lampColor: "#fff0d8", mountains: 0x7f8d7a,
  },
  meridian: {
    id: "meridian", label: "Office tower", style: "office",
    sun: { elevation: 48, azimuth: 170, color: 0xffffff, intensity: 3.2 },
    sky: { turbidity: 2.4, rayleigh: 0.9, mie: 0.003, mieG: 0.8 },
    hemi: { sky: 0xdbe8f8, ground: 0x9a9a98, intensity: 1.15 },
    exposure: 0.6,
    fog: { color: 0xd7e1ea, near: 120, far: 700 },
    interiorH: 3.2, exteriorH: 9,
    exterior: { wall: "#c9cdd0", plinth: "#7c8286", trim: "#e7eaec", ground: "#8f9092", apron: "#bfc0bd" },
    interior: { wall: "#eceeed", dado: "none", ceiling: "#f2f3f3", beams: false },
    floors: {
      lobby: { kind: "paving", tint: "#e4e2dc" }, office: { kind: "paving", tint: "#7d8288" }, executive: { kind: "wood", tint: "#7a5a40" },
      server: { kind: "metal", tint: "#a0a6aa" }, corridor: { kind: "paving", tint: "#d8d6d0" }, security: { kind: "paving", tint: "#8a8f94" },
    },
    lampColor: "#f4f8ff", mountains: null,
  },
  blacksite: {
    id: "blacksite", label: "Mountain chalet", style: "chalet",
    sun: { elevation: 30, azimuth: 225, color: 0xfff4e6, intensity: 3.3 },
    sky: { turbidity: 2.2, rayleigh: 1.2, mie: 0.004, mieG: 0.8 },
    hemi: { sky: 0xd6e6ff, ground: 0x8a8a80, intensity: 1.1 },
    exposure: 0.6,
    fog: { color: 0xdbe6f2, near: 110, far: 650 },
    interiorH: 3.2, exteriorH: 6.2,
    exterior: { wall: "#8a6848", plinth: "#8e8c86", trim: "#e9e4dc", ground: "#eef2f6", apron: "#bdb8ae" },
    interior: { wall: "#c79b6c", dado: "wood", ceiling: "#b88a5c", beams: true },
    floors: {
      lobby: { kind: "wood", tint: "#8a5c38" }, office: { kind: "wood", tint: "#7a5032" }, executive: { kind: "wood", tint: "#6a4228" },
      lab: { kind: "paving", tint: "#e2e2de" }, server: { kind: "metal", tint: "#9aa0a2" }, corridor: { kind: "wood", tint: "#86583a" },
      storage: { kind: "paving", tint: "#a8a49a" }, holding: { kind: "paving", tint: "#a2a098" },
    },
    lampColor: "#ffe2b8", mountains: 0x8a929e,
  },
};
