import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ConfigurationError, InputError } from "./errors.js";
import { evaluateFlag, validateConfig } from "./evaluator.js";
import type { AuditSink } from "./audit.js";
import type { FlagConfig, Subject } from "./types.js";

export function createHttpServer(config: FlagConfig, auditSink?: AuditSink): Server {
  validateConfig(config);
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return send(response, 200, { status: "ok" });
      if (request.method !== "POST") return send(response, 404, { error: "not_found", message: "route not found" });
      const body = await readJson(request);
      if (request.url === "/v1/evaluate") {
        const result = await evaluateRequest(config, body, auditSink);
        return send(response, 200, result);
      }
      if (request.url === "/v1/evaluate/batch") {
        if (!isRecord(body)) throw new InputError("body must be an object");
        if (!Array.isArray(body.evaluations)) throw new InputError("evaluations must be an array");
        const results = await Promise.all(body.evaluations.map((item: unknown) => evaluateRequest(config, item, auditSink)));
        return send(response, 200, { evaluations: results });
      }
      return send(response, 404, { error: "not_found", message: "route not found" });
    } catch (error) {
      const expected = error instanceof InputError || error instanceof ConfigurationError;
      return send(response, expected ? 400 : 500, { error: expected ? "invalid_request" : "internal_error", message: error instanceof Error ? error.message : "unexpected error" });
    }
  });
}

async function evaluateRequest(config: FlagConfig, body: unknown, auditSink?: AuditSink) {
  if (!isRecord(body) || typeof body.flagKey !== "string" || !isSubject(body.subject)) throw new InputError("body requires flagKey and subject with a key");
  const evaluation = evaluateFlag(config, body.flagKey, body.subject);
  await auditSink?.append({ timestamp: new Date().toISOString(), subjectKey: body.subject.key, evaluation });
  return evaluation;
}

function isSubject(value: unknown): value is Subject {
  return isRecord(value) && typeof value.key === "string" && value.key.length > 0 &&
    (value.attributes === undefined || (isRecord(value.attributes) && Object.values(value.attributes).every((v) => ["string", "number", "boolean"].includes(typeof v))));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000) throw new InputError("request body exceeds 1MB");
  }
  try { return JSON.parse(body); } catch { throw new InputError("request body must be valid JSON"); }
}
