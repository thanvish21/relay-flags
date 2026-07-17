import { readFile } from "node:fs/promises";
import { evaluateFlag } from "./evaluator.js";
import type { FlagConfig, Subject } from "./types.js";

const [configPath, subjectPath, flagKey] = process.argv.slice(2);
if (!configPath || !subjectPath || !flagKey) {
  console.error("Usage: npm run cli -- <flags.json> <subject.json> <flag-key>");
  process.exitCode = 1;
} else {
  const [configText, subjectText] = await Promise.all([readFile(configPath, "utf8"), readFile(subjectPath, "utf8")]);
  console.log(JSON.stringify(evaluateFlag(JSON.parse(configText) as FlagConfig, flagKey, JSON.parse(subjectText) as Subject), null, 2));
}
