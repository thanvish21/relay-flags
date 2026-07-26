import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError } from "../src/errors.js";
import { compileConfig, evaluateFlag } from "../src/evaluator.js";
import type { FlagConfig, Subject } from "../src/types.js";

const config: FlagConfig = {
  segments: [
    { key: "paid", clauses: [{ attribute: "plan", operator: "in", values: ["pro", "enterprise"] }] },
    { key: "paid-eu", clauses: [{ attribute: "plan", operator: "in", values: ["pro", "enterprise"] }, { attribute: "region", operator: "equals", values: ["eu"] }] }
  ],
  flags: [
    {
      key: "checkout", default: false,
      rules: [
        { id: "blocked", clauses: [{ attribute: "status", operator: "equals", values: ["banned"] }], value: false },
        { id: "eu-paid", segment: "paid-eu", value: true },
        { id: "paid", segment: "paid", value: true },
        { id: "seats", clauses: [{ attribute: "seats", operator: "in", values: [10, 20] }], value: true },
        { id: "trial", clauses: [{ attribute: "trial", operator: "equals", values: [true] }], value: true }
      ],
      rollout: { salt: "v1", variations: [{ value: true, weight: 30 }, { value: false, weight: 70 }] }
    },
    { key: "search", default: "classic", rules: [{ id: "beta", segment: "paid", value: "semantic" }] },
    { key: "static", default: true },
    { key: "self-referencing", default: false, rules: [{ id: "by-key", clauses: [{ attribute: "key", operator: "in", values: ["allowlisted-user"] }], value: true }] }
  ]
};

const compiled = compileConfig(config);

function evaluate(flagKey: string, subject: Subject) {
  const direct = evaluateFlag(config, flagKey, subject);
  assert.deepEqual(compiled.evaluate(flagKey, subject), direct, "compiled and uncompiled evaluation diverged");
  return direct;
}

test("an unknown flag key is a configuration error, not a silent default", () => {
  assert.throws(() => evaluateFlag(config, "does-not-exist", { key: "u1" }), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /unknown flag: does-not-exist/);
    return true;
  });
  assert.throws(() => compiled.evaluate("does-not-exist", { key: "u1" }), ConfigurationError);
});

test("a missing or empty subject key is rejected", () => {
  assert.throws(() => evaluateFlag(config, "static", { key: "" }), /subject key is required/);
  assert.throws(() => evaluateFlag(config, "static", undefined as unknown as Subject), /subject key is required/);
  assert.throws(() => compiled.evaluate("static", { key: "" }), /subject key is required/);
});

test("a subject with no attributes falls through every attribute rule", () => {
  assert.equal(evaluate("search", { key: "u1" }).value, "classic");
  assert.deepEqual(evaluate("search", { key: "u1" }).reason, { kind: "DEFAULT" });
});

test("an absent attribute never matches, even against a clause listing undefined-like values", () => {
  assert.deepEqual(evaluate("search", { key: "u1", attributes: { unrelated: "pro" } }).reason, { kind: "DEFAULT" });
});

test("clause comparison is strict, so a number never equals its string form", () => {
  assert.equal(evaluate("checkout", { key: "u1", attributes: { seats: 10 } }).value, true);
  assert.deepEqual(evaluate("checkout", { key: "u1", attributes: { seats: "10" } }).reason.kind, "ROLLOUT");
});

test("clause comparison is strict, so a boolean never equals its string form", () => {
  assert.deepEqual(evaluate("checkout", { key: "u1", attributes: { trial: true } }).reason, { kind: "RULE_MATCH", ruleId: "trial" });
  assert.equal(evaluate("checkout", { key: "u1", attributes: { trial: "true" } }).reason.kind, "ROLLOUT");
});

test("the first matching rule wins even when later rules also match", () => {
  const result = evaluate("checkout", { key: "u1", attributes: { status: "banned", plan: "enterprise", region: "eu", trial: true } });
  assert.deepEqual(result, { flagKey: "checkout", value: false, reason: { kind: "RULE_MATCH", ruleId: "blocked" } });
});

test("rule order decides between two matching segments", () => {
  const euPaid = evaluate("checkout", { key: "u1", attributes: { plan: "pro", region: "eu" } });
  assert.deepEqual(euPaid.reason, { kind: "RULE_MATCH", ruleId: "eu-paid" });
  const paidElsewhere = evaluate("checkout", { key: "u1", attributes: { plan: "pro", region: "us" } });
  assert.deepEqual(paidElsewhere.reason, { kind: "RULE_MATCH", ruleId: "paid" });
});

test("a multi-clause segment requires every clause to hold", () => {
  assert.deepEqual(evaluate("checkout", { key: "u1", attributes: { plan: "free", region: "eu" } }).reason.kind, "ROLLOUT");
});

test("one segment can back several rules across several flags", () => {
  assert.equal(evaluate("search", { key: "u1", attributes: { plan: "enterprise" } }).value, "semantic");
  assert.equal(evaluate("checkout", { key: "u1", attributes: { plan: "enterprise" } }).value, true);
});

test("the reserved attribute name key targets the subject key itself", () => {
  assert.deepEqual(evaluate("self-referencing", { key: "allowlisted-user" }).reason, { kind: "RULE_MATCH", ruleId: "by-key" });
  assert.deepEqual(evaluate("self-referencing", { key: "someone-else" }).reason, { kind: "DEFAULT" });
});

test("an attribute literally named key is shadowed by the subject key", () => {
  assert.deepEqual(evaluate("self-referencing", { key: "someone-else", attributes: { key: "allowlisted-user" } }).reason, { kind: "DEFAULT" });
});

test("a matching rule short-circuits the rollout entirely", () => {
  const result = evaluate("checkout", { key: "u1", attributes: { plan: "pro" } });
  assert.equal(result.reason.kind, "RULE_MATCH");
});

test("a flag with no rules and no rollout always returns its typed default", () => {
  assert.deepEqual(evaluate("static", { key: "u1", attributes: { plan: "enterprise", trial: true } }), { flagKey: "static", value: true, reason: { kind: "DEFAULT" } });
});

test("string flags carry string variants end to end", () => {
  const result = evaluate("search", { key: "u1", attributes: { plan: "pro" } });
  assert.equal(typeof result.value, "string");
  assert.equal(result.value, "semantic");
});

test("unrelated attributes never disturb a decision", () => {
  const base = evaluate("checkout", { key: "u1" });
  assert.deepEqual(evaluate("checkout", { key: "u1", attributes: { noise: "x", more: 1, other: false } }), base);
});

test("compiling twice from the same configuration yields identical decisions", () => {
  const other = compileConfig(config);
  for (const key of ["u1", "u2", "u3", "u4"]) assert.deepEqual(other.evaluate("checkout", { key }), compiled.evaluate("checkout", { key }));
});

test("a compiled configuration ignores later mutation of the source object", () => {
  const source: FlagConfig = { flags: [{ key: "f", default: false }] };
  const snapshot = compileConfig(source);
  source.flags.push({ key: "added-later", default: true });
  assert.throws(() => snapshot.evaluate("added-later", { key: "u1" }), /unknown flag: added-later/);
  assert.equal(evaluateFlag(source, "added-later", { key: "u1" }).value, true);
});
