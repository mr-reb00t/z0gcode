import { test } from "node:test";
import assert from "node:assert/strict";
import { normEffort, boolOf, modelChain, CONFIG } from "../src/config.mjs";

test("normEffort accepts levels case-insensitively, else null", () => {
  assert.equal(normEffort("high"), "high");
  assert.equal(normEffort("HIGH"), "high");
  assert.equal(normEffort(" medium "), "medium");
  assert.equal(normEffort("bogus"), null);
  assert.equal(normEffort(""), null);
  assert.equal(normEffort(undefined), null);
});

test("boolOf parses booleans and off-ish strings", () => {
  assert.equal(boolOf("on"), true);
  assert.equal(boolOf("true"), true);
  assert.equal(boolOf("off"), false);
  assert.equal(boolOf("false"), false);
  assert.equal(boolOf("0"), false);
  assert.equal(boolOf("no"), false);
  assert.equal(boolOf(true), true);
  assert.equal(boolOf(undefined), undefined);
  assert.equal(boolOf(""), undefined);
});

test("escalate config is present (boolean + a sane threshold)", () => {
  assert.equal(typeof CONFIG.escalate, "boolean");
  assert.ok(CONFIG.escalateAfter >= 2);
});

test("modelChain puts the preferred model first and dedupes fallbacks", () => {
  const chain = modelChain(CONFIG.fallbacks[0]);
  assert.equal(chain[0], CONFIG.fallbacks[0]);
  assert.equal(new Set(chain).size, chain.length);
});
