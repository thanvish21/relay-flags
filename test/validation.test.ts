import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError } from "../src/errors.js";
import { compileConfig, validateConfig } from "../src/evaluator.js";
import type { FlagConfig } from "../src/types.js";

function rejects(name: string, config: unknown, message: RegExp): void {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateConfig(config as FlagConfig), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError, `expected ConfigurationError, received ${String(error)}`);
      assert.match(error.message, message);
      return true;
    });
  });
}

rejects("a missing configuration", undefined, /config\.flags must be an array/);
rejects("a configuration without flags", {}, /config\.flags must be an array/);
rejects("flags declared as an object", { flags: {} }, /config\.flags must be an array/);
rejects("an empty flag key", { flags: [{ key: "", default: false }] }, /unique and non-empty/);
rejects("duplicate flag keys", { flags: [{ key: "a", default: false }, { key: "a", default: true }] }, /unique and non-empty/);
rejects("a numeric default", { flags: [{ key: "a", default: 1 }] }, /invalid default/);
rejects("a null default", { flags: [{ key: "a", default: null }] }, /invalid default/);
rejects("rules declared as an object", { flags: [{ key: "a", default: false, rules: {} }] }, /rules must be an array/);
rejects("a rule whose value type differs from the default", { flags: [{ key: "a", default: false, rules: [{ id: "r", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }], value: "on" }] }] }, /value type must match/);
rejects("a rule with both a segment and clauses", { segments: [{ key: "s", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }] }], flags: [{ key: "a", default: false, rules: [{ id: "r", segment: "s", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }], value: true }] }] }, /cannot have both segment and clauses/);
rejects("a rule with neither a segment nor clauses", { flags: [{ key: "a", default: false, rules: [{ id: "r", value: true }] }] }, /needs segment or clauses/);
rejects("a rule referencing an unknown segment", { flags: [{ key: "a", default: false, rules: [{ id: "r", segment: "ghost", value: true }] }] }, /unknown segment ghost/);
rejects("a clause with an empty attribute", { flags: [{ key: "a", default: false, rules: [{ id: "r", clauses: [{ attribute: "", operator: "equals", values: ["y"] }], value: true }] }] }, /invalid clause/);
rejects("a clause with an unsupported operator", { flags: [{ key: "a", default: false, rules: [{ id: "r", clauses: [{ attribute: "x", operator: "contains", values: ["y"] }], value: true }] }] }, /invalid clause/);
rejects("a clause with no values", { flags: [{ key: "a", default: false, rules: [{ id: "r", clauses: [{ attribute: "x", operator: "equals", values: [] }], value: true }] }] }, /invalid clause/);
rejects("a clause with values declared as an object", { flags: [{ key: "a", default: false, rules: [{ id: "r", clauses: [{ attribute: "x", operator: "equals", values: {} }], value: true }] }] }, /invalid clause/);
rejects("segments declared as an object", { flags: [{ key: "a", default: false }], segments: {} }, /config\.segments must be an array/);
rejects("an empty segment key", { flags: [{ key: "a", default: false }], segments: [{ key: "", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }] }] }, /unique and non-empty/);
rejects("duplicate segment keys", { flags: [{ key: "a", default: false }], segments: [{ key: "s", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }] }, { key: "s", clauses: [{ attribute: "x", operator: "equals", values: ["z"] }] }] }, /unique and non-empty/);
rejects("a segment with no clauses", { flags: [{ key: "a", default: false }], segments: [{ key: "s", clauses: [] }] }, /segment s needs clauses/);
rejects("a segment with a missing clause list", { flags: [{ key: "a", default: false }], segments: [{ key: "s" }] }, /segment s needs clauses/);
rejects("a rollout without a salt", { flags: [{ key: "a", default: false, rollout: { variations: [{ value: true, weight: 100 }] } }] }, /needs salt and variations/);
rejects("a rollout with an empty salt", { flags: [{ key: "a", default: false, rollout: { salt: "", variations: [{ value: true, weight: 100 }] } }] }, /needs salt and variations/);
rejects("a rollout without variations", { flags: [{ key: "a", default: false, rollout: { salt: "s" } }] }, /needs salt and variations/);
rejects("a rollout with an empty variation list", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [] } }] }, /needs salt and variations/);
rejects("a zero-weight variation", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 100 }, { value: false, weight: 0 }] } }] }, /positive integers/);
rejects("a negative weight", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 120 }, { value: false, weight: -20 }] } }] }, /positive integers/);
rejects("a fractional weight", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 25.5 }, { value: false, weight: 74.5 }] } }] }, /positive integers/);
rejects("weights totalling less than 100", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 40 }, { value: false, weight: 50 }] } }] }, /must total 100/);
rejects("weights totalling more than 100", { flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 60 }, { value: false, weight: 50 }] } }] }, /must total 100/);
rejects("a rollout variation typed differently from the default", { flags: [{ key: "a", default: "control", rollout: { salt: "s", variations: [{ value: true, weight: 100 }] } }] }, /rollout value type must match/);

test("accepts a configuration with no flags at all", () => {
  assert.doesNotThrow(() => validateConfig({ flags: [] }));
});

test("accepts a flag with neither rules nor a rollout", () => {
  assert.doesNotThrow(() => validateConfig({ flags: [{ key: "a", default: true }] }));
});

test("accepts a declared segment that no rule references", () => {
  assert.doesNotThrow(() => validateConfig({ flags: [{ key: "a", default: false }], segments: [{ key: "unused", clauses: [{ attribute: "x", operator: "equals", values: ["y"] }] }] }));
});

test("accepts a single variation that consumes the whole population", () => {
  assert.doesNotThrow(() => validateConfig({ flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 100 }] } }] }));
});

test("compiling an invalid configuration fails immediately rather than at evaluation", () => {
  assert.throws(() => compileConfig({ flags: [{ key: "a", default: false, rollout: { salt: "s", variations: [{ value: true, weight: 90 }] } }] }), ConfigurationError);
});
