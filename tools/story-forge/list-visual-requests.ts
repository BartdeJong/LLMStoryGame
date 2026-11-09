import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferVisualCategory, resolveVisual } from "../../src/art/glyphs";
import type { GlyphCategory } from "../../src/art/glyphs";
import { parseStoryIndex } from "../../src/story/loader";
import { validateStoryPack } from "../../src/story/validate";
import type { StoryPack } from "../../src/story/types";

const storiesDir = resolve("public/stories");
const index = parseStoryIndex(JSON.parse(readFileSync(resolve(storiesDir, "index.json"), "utf8")) as unknown);
const grouped = new Map<GlyphCategory, string[]>();
const add = (category: GlyphCategory, text: string): void => {
  const entries = grouped.get(category) ?? [];
  entries.push(text);
  grouped.set(category, entries);
};

for (const story of index.stories) {
  const file = resolve(storiesDir, `${story.id}.json`);
  if (!existsSync(file)) throw new Error(`Story "${story.id}" was listed but ${file} is missing.`);
  const report = validateStoryPack(JSON.parse(readFileSync(file, "utf8")) as unknown);
  if (!report.ok || !report.pack) throw new Error(`Story "${story.id}" is invalid: ${report.errors.map((issue) => issue.message).join("; ")}`);
  const pack: StoryPack = report.pack;
  for (const request of pack.visual_requests ?? []) {
    add(request.suggested_category, `${story.id}: ${request.name} — ${request.description} (request)`);
  }
  const visuals = [
    ...pack.items.map((item) => ({ name: item.name, description: item.description })),
    ...pack.locations.flatMap((location) => location.objects.map((object) => ({ name: object.name, description: object.description }))),
  ];
  for (const entry of visuals) {
    if (resolveVisual(entry.name, entry.description).confidence < 0.34) {
      add(inferVisualCategory(entry.name, entry.description), `${story.id}: ${entry.name} — ${entry.description} (weak match)`);
    }
  }
}

for (const category of [...grouped.keys()].sort()) {
  console.log(`## ${category}`);
  for (const entry of grouped.get(category) ?? []) console.log(`- ${entry}`);
}
