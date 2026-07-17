import { readFile } from "node:fs/promises";
import { createHttpServer } from "./http.js";
import { JsonlFileAuditSink } from "./audit.js";
import type { FlagConfig } from "./types.js";

const configPath = process.env.FLAG_CONFIG ?? "examples/flags.json";
const port = Number(process.env.PORT ?? 3000);
const config = JSON.parse(await readFile(configPath, "utf8")) as FlagConfig;
const server = createHttpServer(config, new JsonlFileAuditSink(process.env.AUDIT_LOG ?? "audit.jsonl"));
server.listen(port, () => console.log(`relay-flags listening on :${port}`));
