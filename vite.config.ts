import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { isDialogueFeedbackSession } from "./src/dialogue/feedback";

const FEEDBACK_ENDPOINT = "/__dialogue-feedback";
const MAX_FEEDBACK_BYTES = 1_000_000;

class FeedbackPayloadTooLarge extends Error {}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_FEEDBACK_BYTES) throw new FeedbackPayloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ message }));
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

function dialogueFeedbackPlugin(): Plugin {
  return {
    name: "local-dialogue-feedback",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== FEEDBACK_ENDPOINT) {
          next();
          return;
        }
        if (request.method !== "POST") {
          respond(response, 405, "Only POST is supported.");
          return;
        }
        if (!isLoopback(request.socket.remoteAddress)) {
          respond(response, 403, "Feedback files can only be saved from this computer.");
          return;
        }
        if (!request.headers["content-type"]?.includes("application/json")) {
          respond(response, 415, "Send the feedback session as JSON.");
          return;
        }

        try {
          const value: unknown = JSON.parse(await requestBody(request));
          if (!isDialogueFeedbackSession(value)) {
            respond(response, 400, "The feedback session has an invalid shape.");
            return;
          }
          const directory = resolve(process.cwd(), ".dialogue-feedback");
          const destination = resolve(directory, `${value.sessionId}.json`);
          const temporary = resolve(directory, `${value.sessionId}.tmp`);
          await mkdir(directory, { recursive: true });
          await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          await rename(temporary, destination);
          respond(response, 200, "Feedback session saved.");
        } catch (error) {
          if (error instanceof FeedbackPayloadTooLarge) {
            respond(response, 413, "The feedback session is too large to save.");
            return;
          }
          if (error instanceof SyntaxError) {
            respond(response, 400, "The feedback session is not valid JSON.");
            return;
          }
          console.error("Could not save the local dialogue feedback session.", error);
          respond(response, 500, "Could not save the feedback session.");
        }
      });
    },
  };
}

export default defineConfig({
  // The WebLLM worker is bundled as an ES module worker (it uses dynamic imports).
  worker: { format: "es" },
  build: { manifest: true },
  plugins: [dialogueFeedbackPlugin()],
});
