import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError } from "../src/errors.js";
import { bucketFor, evaluateFlag } from "../src/evaluator.js";
import type { FlagConfig } from "../src/types.js";

const config: FlagConfig = {
  segments: [{ key: "paid", clauses: [{ attribute: "plan", operator: "in", values: ["pro", "enterprise"] }] }],
  flags: [{
    key: "checkout", default: false,
    rules: [
      { id: "staff-first", clauses: [{ attribute: "role", operator: "equals", values: ["staff"] }], value: true },
      { id: "paid-second", segment: "paid", value: true }
    ],
    rollout: { salt: "v1", variations: [{ value: true, weight: 40 }, { value: false, weight: 60 }] }
  }]
};

test("uses the first matching rule before later rules and rollout", () => {
  const result = evaluateFlag(config, "checkout", { key: "a", attributes: { role: "staff", plan: "pro" } });
  assert.deepEqual(result, { flagKey: "checkout", value: true, reason: { kind: "RULE_MATCH", ruleId: "staff-first" } });
});

test("matches reusable segments", () => {
  const result = evaluateFlag(config, "checkout", { key: "a", attributes: { plan: "enterprise" } });
  assert.equal(result.value, true);
  assert.deepEqual(result.reason, { kind: "RULE_MATCH", ruleId: "paid-second" });
});

test("keeps rollout buckets stable and in range", () => {
  assert.equal(bucketFor("checkout:v1:user-42"), bucketFor("checkout:v1:user-42"));
  assert.ok(bucketFor("checkout:v1:user-42") >= 0 && bucketFor("checkout:v1:user-42") < 100);
  const one = evaluateFlag(config, "checkout", { key: "non-match" });
  const two = evaluateFlag(config, "checkout", { key: "non-match" });
  assert.deepEqual(one, two);
  assert.equal(one.reason.kind, "ROLLOUT");
});

test("returns the default when no rule or rollout applies", () => {
  const noRollout: FlagConfig = { flags: [{ key: "plain", default: "control" }] };
  assert.deepEqual(evaluateFlag(noRollout, "plain", { key: "a" }), { flagKey: "plain", value: "control", reason: { kind: "DEFAULT" } });
});

test("rejects invalid configuration", () => {
  assert.throws(() => evaluateFlag({ flags: [{ key: "bad", default: false, rollout: { salt: "x", variations: [{ value: true, weight: 90 }] } }] }, "bad", { key: "a" }), ConfigurationError);
  assert.throws(() => evaluateFlag({ flags: [{ key: "bad", default: false, rules: [{ id: "r", segment: "missing", value: true }] }] }, "bad", { key: "a" }), /unknown segment/);
});
