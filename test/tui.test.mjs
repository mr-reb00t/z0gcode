import { test } from "node:test";
import assert from "node:assert/strict";
import { createTui, tuiCapable } from "../src/tui.mjs";

// Under `node --test`, stdout is not a TTY, so the fixed-bottom UI must decline
// and let the caller fall back to the classic readline prompt.
test("tuiCapable() is false without an interactive TTY", () => {
  assert.equal(tuiCapable(), false);
});

test("Z0G_CLASSIC / Z0G_NO_TUI force the classic prompt", () => {
  const saved = { c: process.env.Z0G_CLASSIC, n: process.env.Z0G_NO_TUI };
  try {
    process.env.Z0G_CLASSIC = "1";
    assert.equal(tuiCapable(), false);
    delete process.env.Z0G_CLASSIC;
    process.env.Z0G_NO_TUI = "1";
    assert.equal(tuiCapable(), false);
  } finally {
    if (saved.c === undefined) delete process.env.Z0G_CLASSIC; else process.env.Z0G_CLASSIC = saved.c;
    if (saved.n === undefined) delete process.env.Z0G_NO_TUI; else process.env.Z0G_NO_TUI = saved.n;
  }
});

test("createTui() returns the shell API without touching the terminal", () => {
  let wrote = false;
  const orig = process.stdout.write;
  process.stdout.write = (...a) => { wrote = true; return orig.apply(process.stdout, a); };
  let tui;
  try {
    tui = createTui({
      promptStr: "z0g > ",
      statusProvider: () => ({ model: "m", mode: "ask", approve: "ask each", tokens: 0, cost: 0, running: false }),
      onModeCycle: () => {},
    });
  } finally {
    process.stdout.write = orig;
  }
  for (const m of ["start", "stop", "readLine", "setRunning", "suspend", "resume", "refresh"]) {
    assert.equal(typeof tui[m], "function", "missing method: " + m);
  }
  // Construction must be inert (no scroll region, no listeners) until start().
  assert.equal(wrote, false, "createTui() must not write to stdout on construction");
});
