import { appendFile } from "node:fs/promises";
import type { AuditEvent } from "./types.js";

export interface AuditSink { append(event: AuditEvent): Promise<void>; }

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> { this.events.push(event); }
}

export class JsonlFileAuditSink implements AuditSink {
  constructor(private readonly path: string) {}
  async append(event: AuditEvent): Promise<void> { await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8"); }
}
