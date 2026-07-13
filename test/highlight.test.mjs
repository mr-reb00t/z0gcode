import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeCode } from "../src/ui.mjs";

const typesOf = (toks, t) => toks.filter((x) => x.t === t).map((x) => x.v);

test("js: keywords, numbers, comments", () => {
  const toks = tokenizeCode("const x = 42; // a comment", "js");
  assert.ok(typesOf(toks, "kw").includes("const"));
  assert.ok(typesOf(toks, "num").includes("42"));
  assert.deepEqual(typesOf(toks, "com"), ["// a comment"]);
});

test("js: strings are one span and not mistaken for code", () => {
  const toks = tokenizeCode('let s = "hi there";', "js");
  assert.deepEqual(typesOf(toks, "str"), ['"hi there"']);
  assert.ok(typesOf(toks, "kw").includes("let"));
});

test("python: hash comment and def keyword", () => {
  const toks = tokenizeCode("def add(a, b):  # sum", "python");
  assert.ok(typesOf(toks, "kw").includes("def"));
  assert.deepEqual(typesOf(toks, "com"), ["# sum"]);
});

test("solidity keywords", () => {
  const toks = tokenizeCode("function f() public returns (uint256) { return 7; }", "solidity");
  const kw = typesOf(toks, "kw");
  for (const k of ["function", "public", "returns", "uint256", "return"]) assert.ok(kw.includes(k), k);
  assert.ok(typesOf(toks, "num").includes("7"));
});

test("json: booleans as keywords, strings preserved", () => {
  const toks = tokenizeCode('{ "ok": true, "n": 3 }', "json");
  assert.ok(typesOf(toks, "kw").includes("true"));
  assert.ok(typesOf(toks, "str").includes('"ok"'));
  assert.ok(typesOf(toks, "num").includes("3"));
});

test("unknown language still tokenizes strings and numbers, no keywords", () => {
  const toks = tokenizeCode('x = "a" + 10', "whatever");
  assert.equal(typesOf(toks, "kw").length, 0);
  assert.ok(typesOf(toks, "str").includes('"a"'));
  assert.ok(typesOf(toks, "num").includes("10"));
});
