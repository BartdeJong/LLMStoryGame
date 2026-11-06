import type { AreaBrief, Biome } from "./types";

export const PLACEHOLDER_BRIEFS: Readonly<Record<Biome, AreaBrief>> = {
  meadow: {
    name: "Meadow Crossing",
    biome: "meadow",
    mood: "quiet and welcoming",
    palette: "meadow",
    doorLabels: ["Old forest track", "Village lane", "Shore path"],
  },
  forest: {
    name: "Whispering Wood",
    biome: "forest",
    mood: "softly mysterious",
    palette: "forest",
    doorLabels: ["Mossy cave", "Meadow trail"],
  },
  shore: {
    name: "Tidepool Shore",
    biome: "shore",
    mood: "bright and breezy",
    palette: "shore",
    doorLabels: ["Village gate", "Sea cave"],
  },
  cave: {
    name: "Hollowstone Cave",
    biome: "cave",
    mood: "still and curious",
    palette: "cave",
    doorLabels: ["Ruined passage", "Forest mouth"],
  },
  building: {
    name: "Wayfarer's House",
    biome: "building",
    mood: "warm and quiet",
    palette: "village",
    doorLabels: ["Front door", "Back door"],
  },
  ruins: {
    name: "Overgrown Ruins",
    biome: "ruins",
    mood: "old but peaceful",
    palette: "ruins",
    doorLabels: ["Sunken stair", "Forest arch"],
  },
  village: {
    name: "Little Fern Village",
    biome: "village",
    mood: "friendly and unhurried",
    palette: "village",
    doorLabels: ["Meadow gate", "Old cottage", "Shore road"],
  },
};

export function getPlaceholderBrief(biome: Biome): AreaBrief {
  return PLACEHOLDER_BRIEFS[biome];
}
