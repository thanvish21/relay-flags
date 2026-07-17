import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlFileAuditSink, MemoryAuditSink } from "../src/audit.js";
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
