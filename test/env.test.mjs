import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const envMod = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "env.mjs")).href;
// Import env.mjs in a child process with a given cwd/HOME, print the loaded key.
function loadKeyFrom(cwd, extraEnv = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(envMod)}).then(() => process.stdout.write(process.env.ZOG_API_KEY || ""))`], {
    cwd, encoding: "utf8", env: { ...process.env, ZOG_API_KEY: undefined, ...extraEnv },
  });
  return r.stdout;
}

test("loads .env from a parent directory (run from a subfolder)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "z0genv-"));
  writeFileSync(path.join(root, ".env"), "ZOG_API_KEY=PROJECT_KEY\n");
  const deep = path.join(root, "a", "b");
  mkdirSync(deep, { recursive: true });
  assert.equal(loadKeyFrom(deep, { HOME: mkdtempSync(path.join(tmpdir(), "z0ghome-")) }), "PROJECT_KEY");
});

test("falls back to ~/.z0gcode/.env from anywhere", () => {
  const home = mkdtempSync(path.join(tmpdir(), "z0ghome-"));
  mkdirSync(path.join(home, ".z0gcode"), { recursive: true });
  writeFileSync(path.join(home, ".z0gcode", ".env"), "ZOG_API_KEY=GLOBAL_KEY\n");
  const nowhere = mkdtempSync(path.join(tmpdir(), "z0gnowhere-"));
  assert.equal(loadKeyFrom(nowhere, { HOME: home }), "GLOBAL_KEY");
});

test("a real environment variable wins over .env files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "z0genv-"));
  writeFileSync(path.join(root, ".env"), "ZOG_API_KEY=PROJECT_KEY\n");
  assert.equal(loadKeyFrom(root, { ZOG_API_KEY: "REAL_ENV" }), "REAL_ENV");
});
