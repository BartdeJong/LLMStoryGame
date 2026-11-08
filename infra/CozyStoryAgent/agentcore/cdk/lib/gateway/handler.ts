import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const region = process.env.AWS_REGION;
const runtimeArn = process.env.AGENT_RUNTIME_ARN;
const secretArn = process.env.ACCESS_SECRET_ARN;
if (!region || !runtimeArn || !secretArn) throw new Error("Gateway environment is incomplete.");

const agentCore = new BedrockAgentCoreClient({ region });
const secrets = new SecretsManagerClient({ region });
let cachedSecret: { value: string; expiresAt: number } | undefined;

interface GatewayEvent {
  body: string | null;
  headers: Record<string, string | undefined>;
  isBase64Encoded: boolean;
  requestContext: { http: { method: string } };
}

async function getAccessSecret(): Promise<string> {
  if (cachedSecret && cachedSecret.expiresAt > Date.now()) return cachedSecret.value;
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) throw new Error("Gateway authorization secret is unavailable.");
  cachedSecret = { value: result.SecretString, expiresAt: Date.now() + 60_000 };
  return result.SecretString;
}

function unauthorized(): { statusCode: number; body: string } {
  return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized." }) };
}

function jsonResponse(statusCode: number, body: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export async function handler(event: GatewayEvent) {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return { statusCode: 204, body: "" };
  if (method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const authorization = event.headers.authorization ?? event.headers.Authorization ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) return unauthorized();
  const expected = await getAccessSecret();
  const supplied = Buffer.from(match[1]);
  const configured = Buffer.from(expected);
  if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) return unauthorized();

  if (!event.body) return jsonResponse(400, { error: "Request body is required." });
  const bodyText = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (Buffer.byteLength(bodyText, "utf8") > 128 * 1024) return jsonResponse(413, { error: "Request is too large." });

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { messages?: unknown }).messages)) {
    return jsonResponse(400, { error: "Request must contain a messages array." });
  }

  try {
    const response = await agentCore.send(new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      runtimeSessionId: randomUUID(),
      payload: new TextEncoder().encode(JSON.stringify(payload)),
      contentType: "application/json",
      accept: "application/json",
    }));
    if (!response.response) return jsonResponse(502, { error: "Agent returned an empty response." });
    const result = JSON.parse(await response.response.transformToString()) as { text?: unknown };
    if (typeof result.text !== "string") return jsonResponse(502, { error: "Agent response did not contain text." });
    return jsonResponse(200, result);
  } catch (error) {
    console.error("AgentCore invocation failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse(502, { error: "The Bedrock agent could not complete the request." });
  }
}
