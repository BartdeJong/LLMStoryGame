// Layered character sprite spec: what a character looks like, written as data in the story pack.
// Pure (no canvas), so the story validator can use it. The renderer is in characterSprites.ts.
// Keep in sync with the "sprite" definition in tools/story-forge/schema/story-pack.schema.json.

export const SPRITE_SPECIES = [
  "human", "bear", "dog", "cat", "fox", "mouse", "rabbit", "owl", "badger", "hedgehog",
  "otter", "frog", "sheep", "mole", "tortoise", "magpie", "crow", "wren", "heron", "moth",
] as const;
export const SPRITE_HEIGHTS = ["tiny", "short", "average", "tall"] as const;
export const SPRITE_GIRTHS = ["slim", "average", "stout"] as const;
export const HAIR_STYLES = [
  "none", "short", "messy", "long", "bob", "bun", "ponytail", "curly", "balding", "pigtails", "mop",
] as const;
export const OUTFIT_STYLES = [
  "none", "shirt", "jumper", "striped", "dress", "coat", "duffle-coat", "suit", "waistcoat",
  "uniform", "cape", "overalls", "cardigan", "robe", "smock",
] as const;
export const HEADWEAR_STYLES = [
  "none", "deerstalker", "bowler", "top-hat", "flat-cap", "bonnet", "headscarf", "bush-hat",
  "police-helmet", "chef-hat", "captain-cap", "peaked-cap", "beret", "woolly-hat", "straw-hat",
  "hood", "veil-hat",
] as const;
export const ACCESSORY_KINDS = [
  "glasses", "monocle", "moustache", "beard", "brows", "pipe", "freckles", "scarf", "bowtie", "apron",
  "shawl", "locket", "nametag", "belt", "satchel", "cane", "umbrella", "spoon", "broom", "notebook",
  "basket", "lantern", "suitcase", "orange", "book", "spyglass", "medical-bag", "flower", "ball",
] as const;

// Things carried in a hand; a character holds at most one.
export const HELD_ACCESSORIES: readonly string[] = [
  "cane", "umbrella", "spoon", "broom", "notebook", "basket", "lantern", "suitcase", "orange", "book",
  "spyglass", "medical-bag", "flower", "ball",
];

export type SpriteSpecies = (typeof SPRITE_SPECIES)[number];
export type SpriteHeight = (typeof SPRITE_HEIGHTS)[number];
export type SpriteGirth = (typeof SPRITE_GIRTHS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type OutfitStyle = (typeof OUTFIT_STYLES)[number];
export type HeadwearStyle = (typeof HEADWEAR_STYLES)[number];
export type AccessoryKind = (typeof ACCESSORY_KINDS)[number];

export interface SpriteHair {
  style: HairStyle;
  color: string;
}
export interface SpriteOutfit {
  style: OutfitStyle;
  color: string; // main garment
  trim?: string; // collar, buttons, hem, sleeves of a waistcoat, stripes
  legs?: string; // trousers or stockings
}
export interface SpriteHeadwear {
  style: HeadwearStyle;
  color: string;
  trim?: string; // band, ribbon, badge
}
export interface SpriteAccessory {
  kind: AccessoryKind;
  color?: string;
}

export interface SpriteSpec {
  species: SpriteSpecies;
  height: SpriteHeight;
  girth: SpriteGirth;
  skin: string; // skin, fur or feather colour
  accent?: string; // muzzle, belly, face disc or wing colour (defaults to a lighter skin)
  hair?: SpriteHair;
  outfit?: SpriteOutfit;
  headwear?: SpriteHeadwear;
  accessories?: SpriteAccessory[];
}

export const MAX_ACCESSORIES = 4;
// Two sprites in one story must differ in at least this many attributes.
export const MIN_SPRITE_DIFFERENCES = 3;

const HEX = /^#[0-9a-fA-F]{6}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf(options: readonly string[], value: unknown): boolean {
  return typeof value === "string" && options.includes(value);
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not a sprite field.`);
}

function checkColor(value: unknown, path: string, errors: string[], required: boolean): void {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || !HEX.test(value)) errors.push(`${path} must be a #rrggbb hex colour.`);
}

// Returns every problem with a sprite spec; an empty list means it is valid.
export function validateSpriteSpec(value: unknown, path = "sprite"): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return [`${path} must be an object.`];
  checkKeys(value, ["species", "height", "girth", "skin", "accent", "hair", "outfit", "headwear", "accessories"], path, errors);
  if (!oneOf(SPRITE_SPECIES, value.species)) errors.push(`${path}.species must be one of ${SPRITE_SPECIES.join(", ")}.`);
  if (!oneOf(SPRITE_HEIGHTS, value.height)) errors.push(`${path}.height must be one of ${SPRITE_HEIGHTS.join(", ")}.`);
  if (!oneOf(SPRITE_GIRTHS, value.girth)) errors.push(`${path}.girth must be one of ${SPRITE_GIRTHS.join(", ")}.`);
  checkColor(value.skin, `${path}.skin`, errors, true);
  checkColor(value.accent, `${path}.accent`, errors, false);

  const layer = (
    key: "hair" | "outfit" | "headwear",
    styles: readonly string[],
    extra: readonly string[],
  ): void => {
    const part = value[key];
    if (part === undefined) return;
    if (!isObject(part)) {
      errors.push(`${path}.${key} must be an object.`);
      return;
    }
    checkKeys(part, ["style", "color", ...extra], `${path}.${key}`, errors);
    if (!oneOf(styles, part.style)) errors.push(`${path}.${key}.style must be one of ${styles.join(", ")}.`);
    checkColor(part.color, `${path}.${key}.color`, errors, true);
    for (const name of extra) checkColor(part[name], `${path}.${key}.${name}`, errors, false);
  };
  layer("hair", HAIR_STYLES, []);
  layer("outfit", OUTFIT_STYLES, ["trim", "legs"]);
  layer("headwear", HEADWEAR_STYLES, ["trim"]);

  const accessories = value.accessories;
  if (accessories !== undefined) {
    if (!Array.isArray(accessories)) errors.push(`${path}.accessories must be a list.`);
    else {
      if (accessories.length > MAX_ACCESSORIES) errors.push(`${path}.accessories has more than ${MAX_ACCESSORIES} entries.`);
      accessories.forEach((accessory, index) => {
        const where = `${path}.accessories[${index}]`;
        if (!isObject(accessory)) {
          errors.push(`${where} must be an object.`);
          return;
        }
        checkKeys(accessory, ["kind", "color"], where, errors);
        if (!oneOf(ACCESSORY_KINDS, accessory.kind)) errors.push(`${where}.kind must be one of ${ACCESSORY_KINDS.join(", ")}.`);
        checkColor(accessory.color, `${where}.color`, errors, false);
      });
      const held = accessories.filter((item) => isObject(item) && typeof item.kind === "string" && HELD_ACCESSORIES.includes(item.kind));
      if (held.length > 1) errors.push(`${path}.accessories holds more than one item in the hands.`);
    }
  }
  return errors;
}

export function parseSpriteSpec(value: unknown): SpriteSpec | null {
  return validateSpriteSpec(value).length === 0 ? (value as SpriteSpec) : null;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

function farApart(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb) > 70;
}

// How many attributes differ between two sprites (colours count when clearly different).
export function spriteDifferences(a: SpriteSpec, b: SpriteSpec): number {
  const kinds = (spec: SpriteSpec): string => (spec.accessories ?? []).map((item) => item.kind).sort().join(",");
  const checks: boolean[] = [
    a.species !== b.species,
    a.height !== b.height,
    a.girth !== b.girth,
    farApart(a.skin, b.skin),
    farApart(a.accent, b.accent),
    (a.hair?.style ?? "none") !== (b.hair?.style ?? "none"),
    farApart(a.hair?.color, b.hair?.color),
    (a.outfit?.style ?? "none") !== (b.outfit?.style ?? "none"),
    farApart(a.outfit?.color, b.outfit?.color),
    farApart(a.outfit?.trim, b.outfit?.trim),
    (a.headwear?.style ?? "none") !== (b.headwear?.style ?? "none"),
    farApart(a.headwear?.color, b.headwear?.color),
    kinds(a) !== kinds(b),
  ];
  return checks.filter(Boolean).length;
}
