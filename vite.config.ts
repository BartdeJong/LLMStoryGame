import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

const LAN_HTTPS = process.env.LAN_HTTPS === "1";
// Keep in sync with tools/dev-cert.mjs. Outside the Vite root so keys are never served.
const CERT_DIR = join(homedir(), ".llmstorygame-dev-certs");

// Dev-only: lets an iPad download the local CA to trust the LAN HTTPS certificate.
function devCaPlugin(): Plugin {
  return {
    name: "local-dev-ca",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/dev-ca.crt") {
          next();
          return;
        }
        try {
          const body = await readFile(resolve(CERT_DIR, "dev-ca.crt"));
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/x-x509-ca-cert");
          response.end(body);
        } catch {
          respond(response, 404, "Run npm run dev:lan to generate the dev CA.");
        }
      });
    },
  };
}

export default defineConfig({
  build: { manifest: true },
  plugins: LAN_HTTPS ? [dialogueFeedbackPlugin(), devCaPlugin()] : [dialogueFeedbackPlugin()],
  ...(LAN_HTTPS
    ? {
        server: {
          host: true,
          port: 5173,
          strictPort: true,
          fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.certs/**", "*.key"] },
          https: {
            key: readFileSync(resolve(CERT_DIR, "dev.key")),
            cert: readFileSync(resolve(CERT_DIR, "dev.crt")),
          },
        },
      }
    : {}),
});
