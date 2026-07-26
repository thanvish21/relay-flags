import { createHash } from "node:crypto";
import { ConfigurationError } from "./errors.js";
import type { Clause, CompiledConfig, Evaluation, Flag, FlagConfig, FlagValue, Subject } from "./types.js";

type Index = { flags: Map<string, Flag<FlagValue>>; segments: Map<string, Clause[]> };

export function validateConfig(config: FlagConfig): void {
  if (!config || !Array.isArray(config.flags)) throw new ConfigurationError("config.flags must be an array");
  const keys = new Set<string>();
  for (const flag of config.flags) {
    if (!flag.key || keys.has(flag.key)) throw new ConfigurationError(`flag keys must be unique and non-empty: ${flag.key}`);
    keys.add(flag.key);
    if (typeof flag.default !== "boolean" && typeof flag.default !== "string") throw new ConfigurationError(`flag ${flag.key} has an invalid default`);
    if (flag.rules !== undefined && !Array.isArray(flag.rules)) throw new ConfigurationError(`flag ${flag.key} rules must be an array`);
    for (const rule of flag.rules ?? []) {
      if (typeof rule.value !== typeof flag.default) throw new ConfigurationError(`rule ${rule.id} value type must match flag ${flag.key} default`);
      if (rule.segment && rule.clauses?.length) throw new ConfigurationError(`rule ${rule.id} cannot have both segment and clauses`);
      if (!rule.segment && !rule.clauses?.length) throw new ConfigurationError(`rule ${rule.id} needs segment or clauses`);
      validateClauses(rule.clauses ?? [], `rule ${rule.id}`);
    }
    if (flag.rollout) {
      if (!flag.rollout.salt || !Array.isArray(flag.rollout.variations) || !flag.rollout.variations.length) throw new ConfigurationError(`flag ${flag.key} rollout needs salt and variations`);
      const sum = flag.rollout.variations.reduce((total, variation) => {
        if (!Number.isInteger(variation.weight) || variation.weight <= 0) throw new ConfigurationError(`flag ${flag.key} rollout weights must be positive integers`);
        if (typeof variation.value !== typeof flag.default) throw new ConfigurationError(`flag ${flag.key} rollout value type must match default`);
        return total + variation.weight;
      }, 0);
      if (sum !== 100) throw new ConfigurationError(`flag ${flag.key} rollout weights must total 100`);
    }
  }
  if (config.segments !== undefined && !Array.isArray(config.segments)) throw new ConfigurationError("config.segments must be an array");
  const segmentKeys = new Set<string>();
  for (const segment of config.segments ?? []) {
    if (!segment.key || segmentKeys.has(segment.key)) throw new ConfigurationError(`segment keys must be unique and non-empty: ${segment.key}`);
    segmentKeys.add(segment.key);
    if (!Array.isArray(segment.clauses) || !segment.clauses.length) throw new ConfigurationError(`segment ${segment.key} needs clauses`);
    validateClauses(segment.clauses, `segment ${segment.key}`);
  }
  for (const flag of config.flags) for (const rule of flag.rules ?? []) {
    if (rule.segment && !segmentKeys.has(rule.segment)) throw new ConfigurationError(`rule ${rule.id} references unknown segment ${rule.segment}`);
  }
}

function validateClauses(clauses: Clause[], owner: string): void {
  for (const clause of clauses) {
    if (!clause.attribute || !["equals", "in"].includes(clause.operator) || !Array.isArray(clause.values) || !clause.values.length) {
      throw new ConfigurationError(`${owner} contains an invalid clause`);
    }
  }
}

function indexConfig(config: FlagConfig): Index {
  validateConfig(config);
  return { flags: new Map(config.flags.map((flag) => [flag.key, flag])), segments: new Map((config.segments ?? []).map((segment) => [segment.key, segment.clauses])) };
}

export function compileConfig(config: FlagConfig): CompiledConfig {
  const index = indexConfig(config);
  return { evaluate: (flagKey, subject) => evaluateIndexed(index, flagKey, subject) };
}

export function evaluateFlag(config: FlagConfig, flagKey: string, subject: Subject): Evaluation {
  return evaluateIndexed(indexConfig(config), flagKey, subject);
}

function evaluateIndexed(index: Index, flagKey: string, subject: Subject): Evaluation {
  if (!subject?.key) throw new ConfigurationError("subject key is required");
  const flag = index.flags.get(flagKey);
  if (!flag) throw new ConfigurationError(`unknown flag: ${flagKey}`);
  for (const rule of flag.rules ?? []) {
    const clauses = rule.segment ? index.segments.get(rule.segment)! : rule.clauses!;
    if (clauses.every((clause) => matches(clause, subject))) return { flagKey, value: rule.value, reason: { kind: "RULE_MATCH", ruleId: rule.id } };
  }
  if (flag.rollout) {
    const bucket = bucketFor(`${flag.key}:${flag.rollout.salt}:${subject.key}`);
    let upperBound = 0;
    for (const variation of flag.rollout.variations) {
      upperBound += variation.weight;
      if (bucket < upperBound) return { flagKey, value: variation.value, reason: { kind: "ROLLOUT", bucket } };
    }
  }
  return { flagKey, value: flag.default, reason: { kind: "DEFAULT" } };
}

function matches(clause: Clause, subject: Subject): boolean {
  const value = clause.attribute === "key" ? subject.key : subject.attributes?.[clause.attribute];
  return value !== undefined && clause.values.some((candidate) => candidate === value);
}

export function bucketFor(input: string): number {
  const hash = createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0) % 100;
}
