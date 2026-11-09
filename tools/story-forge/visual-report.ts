import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveVisual } from "../../src/art/glyphs";
import { formatIssue, validateStoryPack } from "../../src/story/validate";
import type { StoryPack } from "../../src/story/types";

const storyId = process.argv[2];
if (!storyId) throw new Error("Usage: npm run visual-report -- <story-id>");
const file = resolve("public/stories", `${storyId}.json`);
if (!existsSync(file)) throw new Error(`Story "${storyId}" was not found at ${file}.`);
const report = validateStoryPack(JSON.parse(readFileSync(file, "utf8")) as unknown);
if (!report.ok || !report.pack) throw new Error(report.errors.map(formatIssue).join("\n"));
const pack: StoryPack = report.pack;
const warnings = report.warnings.filter((issue) => issue.code.startsWith("VISUAL_"));
const entries = [
  ...pack.items.map((item, index) => ({
    path: `items[${index}]`,
    name: item.name,
    description: item.description,
    visual: item.visual ?? resolveVisual(item.name, item.description),
  })),
  ...pack.locations.flatMap((location, locationIndex) => location.objects.map((object, objectIndex) => ({
    path: `locations[${locationIndex}].objects[${objectIndex}]`,
    name: object.name,
    description: object.description,
    visual: object.visual ?? resolveVisual(object.name, object.description),
  }))),
];
const columns = ["Name", "Chosen icon", "Confidence", "Warnings"];
const rows = entries.map((entry) => [
  entry.name,
  entry.visual.icon,
  resolveVisual(entry.name, entry.description).confidence.toFixed(2),
  warnings.filter((warning) => warning.path === entry.path).map((warning) => warning.message).join("; ") || "—",
]);
const widths = columns.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index]!.length)));
const format = (values: string[]): string => `| ${values.map((value, index) => value.padEnd(widths[index]!)).join(" | ")} |`;
console.log(format(columns));
console.log(`|-${widths.map((width) => "-".repeat(width)).join("-|-")}-|`);
for (const row of rows) console.log(format(row));
