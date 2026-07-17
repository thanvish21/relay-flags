import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { MemoryAuditSink } from "../src/audit.js";
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
