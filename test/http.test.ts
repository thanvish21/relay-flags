import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test from "node:test";
import { MemoryAuditSink } from "../src/audit.js";
import { ConfigurationError } from "../src/errors.js";
import { createHttpServer } from "../src/http.js";
import type { FlagConfig } from "../src/types.js";

const config: FlagConfig = { flags: [{ key: "enabled", default: false, rules: [{ id: "yes", clauses: [{ attribute: "tier", operator: "equals", values: ["gold"] }], value: true }] }] };

async function withServer(run: (baseUrl: string, sink: MemoryAuditSink) => Promise<void>): Promise<void> {
  const sink = new MemoryAuditSink();
  const server = createHttpServer(config, sink);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, sink); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("health endpoint responds without evaluation", async () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
}));

test("evaluation endpoint returns structured result and audits it", async () => withServer(async (baseUrl, sink) => {
  const response = await fetch(`${baseUrl}/v1/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flagKey: "enabled", subject: { key: "u1", attributes: { tier: "gold" } } }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { flagKey: "enabled", value: true, reason: { kind: "RULE_MATCH", ruleId: "yes" } });
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0]?.subjectKey, "u1");
}));

test("batch endpoint evaluates each request and validates bad input", async () => withServer(async (baseUrl) => {
  const batch = await fetch(`${baseUrl}/v1/evaluate/batch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evaluations: [{ flagKey: "enabled", subject: { key: "u1" } }, { flagKey: "enabled", subject: { key: "u2", attributes: { tier: "gold" } } }] }) });
  assert.equal(batch.status, 200);
  assert.deepEqual(await batch.json(), { evaluations: [
    { flagKey: "enabled", value: false, reason: { kind: "DEFAULT" } },
    { flagKey: "enabled", value: true, reason: { kind: "RULE_MATCH", ruleId: "yes" } }
  ] });
  const bad = await fetch(`${baseUrl}/v1/evaluate`, { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "invalid_request", message: "request body must be valid JSON" });
}));

async function withCustomServer(server: Server, run: (baseUrl: string) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function post(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("refuses to start on an invalid configuration", () => {
  assert.throws(() => createHttpServer({ flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 90 }] } }] }), ConfigurationError);
});

test("unknown routes and methods return 404", async () => withServer(async (baseUrl) => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/health`, { method: "DELETE" })).status, 404);
  const unknownPost = await post(baseUrl, "/v1/unknown", {});
  assert.equal(unknownPost.status, 404);
  assert.deepEqual(await unknownPost.json(), { error: "not_found", message: "route not found" });
}));

test("an unknown flag is reported as a client error", async () => withServer(async (baseUrl) => {
  const response = await post(baseUrl, "/v1/evaluate", { flagKey: "ghost", subject: { key: "u1" } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_request", message: "unknown flag: ghost" });
}));

test("malformed evaluation bodies are rejected before evaluation", async () => withServer(async (baseUrl, sink) => {
  const bodies: unknown[] = [
    {},
    { flagKey: "enabled" },
    { flagKey: "enabled", subject: {} },
    { flagKey: "enabled", subject: { key: "" } },
    { flagKey: "enabled", subject: { key: 7 } },
    { flagKey: 7, subject: { key: "u1" } },
    { flagKey: "enabled", subject: { key: "u1", attributes: { nested: { deep: true } } } },
    { flagKey: "enabled", subject: { key: "u1", attributes: { list: [1, 2] } } },
    [{ flagKey: "enabled", subject: { key: "u1" } }]
  ];
  for (const body of bodies) {
    const response = await post(baseUrl, "/v1/evaluate", body);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal((await response.json() as { error: string }).error, "invalid_request");
  }
  assert.equal(sink.events.length, 0, "rejected requests must not be audited");
}));

test("batch input is validated as a whole and item by item", async () => withServer(async (baseUrl) => {
  const notAnObject = await post(baseUrl, "/v1/evaluate/batch", [1, 2]);
  assert.equal(notAnObject.status, 400);
  assert.deepEqual(await notAnObject.json(), { error: "invalid_request", message: "body must be an object" });
  const missingArray = await post(baseUrl, "/v1/evaluate/batch", { evaluations: "all" });
  assert.equal(missingArray.status, 400);
  assert.deepEqual(await missingArray.json(), { error: "invalid_request", message: "evaluations must be an array" });
  const badItem = await post(baseUrl, "/v1/evaluate/batch", { evaluations: [{ flagKey: "enabled", subject: { key: "u1" } }, { flagKey: "enabled" }] });
  assert.equal(badItem.status, 400);
}));

test("an empty batch succeeds with an empty result list", async () => withServer(async (baseUrl, sink) => {
  const response = await post(baseUrl, "/v1/evaluate/batch", { evaluations: [] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { evaluations: [] });
  assert.equal(sink.events.length, 0);
}));

test("every batch member produces its own audit event", async () => withServer(async (baseUrl, sink) => {
  await post(baseUrl, "/v1/evaluate/batch", { evaluations: [{ flagKey: "enabled", subject: { key: "u1" } }, { flagKey: "enabled", subject: { key: "u2" } }, { flagKey: "enabled", subject: { key: "u3" } }] });
  assert.deepEqual(sink.events.map((event) => event.subjectKey).sort(), ["u1", "u2", "u3"]);
  for (const event of sink.events) assert.equal(new Date(event.timestamp).toISOString(), event.timestamp);
}));

test("audit records mirror the response body", async () => withServer(async (baseUrl, sink) => {
  const response = await post(baseUrl, "/v1/evaluate", { flagKey: "enabled", subject: { key: "u1", attributes: { tier: "gold" } } });
  assert.deepEqual(sink.events[0]?.evaluation, await response.json());
}));

test("bodies larger than one megabyte are refused", async () => withServer(async (baseUrl) => {
  const response = await post(baseUrl, "/v1/evaluate", JSON.stringify({ flagKey: "enabled", subject: { key: "u1", attributes: { padding: "x".repeat(1_100_000) } } }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_request", message: "request body exceeds 1MB" });
}));

test("the server works without an audit sink", async () => withCustomServer(createHttpServer(config), async (baseUrl) => {
  const response = await post(baseUrl, "/v1/evaluate", { flagKey: "enabled", subject: { key: "u1" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { flagKey: "enabled", value: false, reason: { kind: "DEFAULT" } });
}));

test("an audit sink failure surfaces as an internal error", async () => {
  const failing = { append: async () => { throw new Error("disk full"); } };
  await withCustomServer(createHttpServer(config, failing), async (baseUrl) => {
    const response = await post(baseUrl, "/v1/evaluate", { flagKey: "enabled", subject: { key: "u1" } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal_error", message: "disk full" });
  });
});
