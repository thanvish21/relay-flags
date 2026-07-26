import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlFileAuditSink, MemoryAuditSink, type AuditSink } from "../src/audit.js";
import type { AuditEvent } from "../src/types.js";

const event: AuditEvent = { timestamp: "2026-01-01T00:00:00.000Z", subjectKey: "u1", evaluation: { flagKey: "f", value: true, reason: { kind: "DEFAULT" } } };

test("memory audit sink retains append-only events", async () => {
  const sink = new MemoryAuditSink();
  await sink.append(event);
  await sink.append({ ...event, subjectKey: "u2" });
  assert.deepEqual(sink.events.map((item) => item.subjectKey), ["u1", "u2"]);
});

test("file audit sink writes one valid JSON object per line", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "relay-flags-")), "audit.jsonl");
  const sink = new JsonlFileAuditSink(path);
  await sink.append(event);
  assert.deepEqual(JSON.parse((await readFile(path, "utf8")).trim()), event);
});

test("file audit sink appends rather than truncating", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "relay-flags-")), "audit.jsonl");
  const sink = new JsonlFileAuditSink(path);
  for (const subjectKey of ["u1", "u2", "u3"]) await sink.append({ ...event, subjectKey });
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => (JSON.parse(line) as AuditEvent).subjectKey), ["u1", "u2", "u3"]);
});

test("file audit sink survives a reopened sink over the same path", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "relay-flags-")), "audit.jsonl");
  await new JsonlFileAuditSink(path).append(event);
  await new JsonlFileAuditSink(path).append({ ...event, subjectKey: "u2" });
  assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);
});

test("file audit sink keeps one line per event when values contain newlines", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "relay-flags-")), "audit.jsonl");
  await new JsonlFileAuditSink(path).append({ ...event, subjectKey: "line1\nline2" });
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal((JSON.parse(lines[0]!) as AuditEvent).subjectKey, "line1\nline2");
});

test("file audit sink preserves rollout reasons verbatim", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "relay-flags-")), "audit.jsonl");
  const rollout: AuditEvent = { timestamp: "2026-01-01T00:00:00.000Z", subjectKey: "u9", evaluation: { flagKey: "f", value: "semantic", reason: { kind: "ROLLOUT", bucket: 42 } } };
  await new JsonlFileAuditSink(path).append(rollout);
  assert.deepEqual(JSON.parse((await readFile(path, "utf8")).trim()), rollout);
});

test("memory audit sink starts empty and preserves insertion order under concurrency", async () => {
  const sink = new MemoryAuditSink();
  assert.equal(sink.events.length, 0);
  await Promise.all(["u1", "u2", "u3", "u4"].map((subjectKey) => sink.append({ ...event, subjectKey })));
  assert.deepEqual(sink.events.map((item) => item.subjectKey), ["u1", "u2", "u3", "u4"]);
});

test("a failing sink propagates its rejection to the caller", async () => {
  const sink: AuditSink = { append: async () => { throw new Error("sink offline"); } };
  await assert.rejects(() => sink.append(event), /sink offline/);
});
