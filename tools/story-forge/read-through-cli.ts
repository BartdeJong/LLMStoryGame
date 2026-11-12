import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatIssue, validateStoryPack } from "../../src/story/validate";
import { storyLengthOf } from "../../src/story/loader";
import { LENGTH_IDS, type LengthId } from "../../src/story/types";
import { formatReadthrough } from "./readthrough";

const [storyId, requestedLength, ...extra] = process.argv.slice(2);
if (!storyId || extra.length > 0) {
  console.error("Usage: npm run story-readthrough -- <story-id>");
  process.exit(1);
}

// A story has one length. Naming it is optional and only checked against the pack.
const namedLength = requestedLength === undefined ? undefined : LENGTH_IDS.find((id): id is LengthId => id === requestedLength);
if (requestedLength !== undefined && !namedLength) {
  console.error(`Invalid length "${requestedLength}". A story has one length; leave it out.`);
  process.exit(1);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storyId)) {
  console.error(`Invalid story id "${storyId}". Use lowercase letters, numbers, and hyphens.`);
  process.exit(1);
}

const file = resolve("public/stories", `${storyId}.json`);
let data: unknown;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Could not read ${file}: ${(error as Error).message}`);
  process.exit(1);
}

const report = validateStoryPack(data);
if (!report.ok || !report.pack) {
  console.error(`Story "${storyId}" failed validation (${report.errors.length} error(s)).`);
  report.errors.forEach((issue) => console.error(formatIssue(issue)));
  process.exit(1);
}
if (report.pack.identity.id !== storyId) {
  console.error(`Story file "${storyId}.json" has identity.id "${report.pack.identity.id}". They must match.`);
  process.exit(1);
}

try {
  console.log(formatReadthrough(report.pack, namedLength ?? storyLengthOf(report.pack)));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
