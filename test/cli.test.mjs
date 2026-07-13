import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "z0g.mjs");
// Run offline: no API key, empty cwd so no .env is picked up.
const run = (args) => spawnSync(process.execPath, [bin, ...args], {
  encoding: "utf8", cwd: path.dirname(bin), env: { ...process.env, ZOG_API_KEY: "" },
});

test("--version prints the version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /z0gcode 0\.\d/);
});

test("--help lists core commands", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  for (const s of ["z0g init", "z0g undo", "z0g share", "--onchain"]) {
    assert.ok(r.stdout.includes(s), "help should mention " + s);
  }
});
