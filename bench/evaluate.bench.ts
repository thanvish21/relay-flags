import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { bucketFor, compileConfig, evaluateFlag } from "../src/evaluator.js";
import type { FlagConfig, Subject } from "../src/types.js";

const QUICK = process.argv.includes("--quick");
const REPEATS = QUICK ? 3 : 7;
const SHAPES: Array<[flags: number, rules: number]> = [[1, 1], [10, 3], [100, 5], [500, 10]];

function buildConfig(flagCount: number, ruleCount: number): FlagConfig {
  return {
    segments: [{ key: "paid", clauses: [{ attribute: "plan", operator: "in", values: ["pro", "enterprise"] }] }],
    flags: Array.from({ length: flagCount }, (_, flagIndex) => ({
      key: `flag-${flagIndex}`,
      default: false,
      rules: Array.from({ length: ruleCount }, (_, ruleIndex) => (
        ruleIndex % 3 === 2
          ? { id: `rule-${ruleIndex}`, segment: "paid", value: true }
          : { id: `rule-${ruleIndex}`, clauses: [{ attribute: "role", operator: "equals" as const, values: [`role-${ruleIndex}`] }], value: true }
      )),
      rollout: { salt: "2026-01", variations: [{ value: true, weight: 25 }, { value: false, weight: 75 }] }
    }))
  };
}

function measure(iterations: number, run: (index: number) => unknown): number {
  const samples: number[] = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    for (let index = 0; index < iterations / 10; index += 1) run(index);
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) run(index);
    samples.push(iterations / ((performance.now() - started) / 1000));
  }
  return samples.sort((left, right) => left - right)[Math.floor(samples.length / 2)]!;
}

function row(cells: string[], widths: number[]): string {
  return `| ${cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join(" | ")} |`;
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((entry) => entry[index]!.length)));
  const divider = `|${widths.map((width, index) => (index === 0 ? "-".repeat(width + 2) : `${"-".repeat(width + 1)}:`)).join("|")}|`;
  return [row(header, widths), divider, ...rows.map((entry) => row(entry, widths))].join("\n");
}

const perSecond = (value: number): string => Math.round(value).toLocaleString("en-US");
const nanoseconds = (value: number): string => `${(1_000_000_000 / value).toFixed(0)} ns`;

const missSubject: Subject = { key: "subject-0", attributes: { plan: "free", role: "unmatched" } };
const hitSubject: Subject = { key: "subject-0", attributes: { plan: "free", role: "role-0" } };

console.log(`relay-flags evaluation benchmark`);
console.log(`node ${process.version} | ${platform()} ${arch()} | ${cpus()[0]?.model.trim() ?? "unknown cpu"} | ${cpus().length} threads`);
console.log(`median of ${REPEATS} runs${QUICK ? " (quick mode)" : ""}\n`);

const rows: string[][] = [];
for (const [flagCount, ruleCount] of SHAPES) {
  const iterations = QUICK ? 5_000 : flagCount >= 100 ? 20_000 : 50_000;
  const config = buildConfig(flagCount, ruleCount);
  const compiled = compileConfig(config);
  const flagKey = `flag-${flagCount - 1}`;
  const perCall = measure(iterations, (index) => evaluateFlag(config, flagKey, { key: `subject-${index}`, attributes: missSubject.attributes }));
  const compileOnce = measure(iterations, (index) => compiled.evaluate(flagKey, { key: `subject-${index}`, attributes: missSubject.attributes }));
  rows.push([`${flagCount} flags x ${ruleCount} rules`, perSecond(perCall), perSecond(compileOnce), `${(compileOnce / perCall).toFixed(1)}x`, nanoseconds(compileOnce)]);
}
console.log(table(["configuration", "evaluateFlag /s", "compiled /s", "speedup", "compiled latency"], rows));

const wide = buildConfig(100, 5);
const wideCompiled = compileConfig(wide);
const shortCircuit = measure(QUICK ? 5_000 : 50_000, (index) => wideCompiled.evaluate("flag-99", { key: `subject-${index}`, attributes: hitSubject.attributes }));
const fullScan = measure(QUICK ? 5_000 : 50_000, (index) => wideCompiled.evaluate("flag-99", { key: `subject-${index}`, attributes: missSubject.attributes }));
const hashOnly = measure(QUICK ? 20_000 : 200_000, (index) => bucketFor(`flag-99:2026-01:subject-${index}`));
const compileCost = measure(QUICK ? 200 : 2_000, () => compileConfig(wide));

console.log(`\n${table(["operation (100 flags x 5 rules)", "ops/s", "latency"], [
  ["first rule matches, no hash", perSecond(shortCircuit), nanoseconds(shortCircuit)],
  ["no rule matches, rollout hash", perSecond(fullScan), nanoseconds(fullScan)],
  ["bucketFor alone (SHA-256)", perSecond(hashOnly), nanoseconds(hashOnly)],
  ["compileConfig (once per config)", perSecond(compileCost), nanoseconds(compileCost)]
])}`);
