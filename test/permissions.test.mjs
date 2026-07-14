import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeExecutor } from "../src/tools.mjs";

const cwd = () => mkdtempSync(path.join(tmpdir(), "z0gperm-"));

test("auto mode runs shell", async () => {
  const exec = makeExecutor({ cwd: cwd(), mode: "auto" });
  const r = await exec("run_bash", { command: "echo Z_OK" });
  assert.equal(r.ok, true);
  assert.match(r.content, /Z_OK/);
});

test("plan mode is read-only: no shell, no writes", async () => {
  const c = cwd();
  const exec = makeExecutor({ cwd: c, mode: "plan" });
  const bash = await exec("run_bash", { command: "echo NO" });
  assert.equal(bash.ok, false);
  assert.match(bash.content, /plan mode/i);
  const write = await exec("write_file", { path: "x.txt", content: "hi" });
  assert.equal(write.ok, false);
  assert.match(write.content, /plan mode/i);
  assert.equal(existsSync(path.join(c, "x.txt")), false);
});

test("plan mode still allows reads", async () => {
  const c = cwd();
  writeFileSync(path.join(c, "r.txt"), "hello");
  const exec = makeExecutor({ cwd: c, mode: "plan" });
  const r = await exec("read_file", { path: "r.txt" });
  assert.equal(r.ok, true);
  assert.match(r.content, /hello/);
});

test("ask mode consults approve() for shell", async () => {
  const calls = [];
  const yes = makeExecutor({ cwd: cwd(), mode: "ask", approve: async (k, d) => { calls.push([k, d]); return true; } });
  const okr = await yes("run_bash", { command: "echo YES" });
  assert.equal(okr.ok, true);
  assert.deepEqual(calls[0], ["run_bash", "echo YES"]);

  const no = makeExecutor({ cwd: cwd(), mode: "ask", approve: async () => false });
  const denied = await no("run_bash", { command: "echo NO" });
  assert.equal(denied.ok, false);
  assert.match(denied.content, /declined/i);
});

test("ask mode with no approver denies shell (non-interactive)", async () => {
  const exec = makeExecutor({ cwd: cwd(), mode: "ask" });
  const r = await exec("run_bash", { command: "echo NO" });
  assert.equal(r.ok, false);
});

test("legacy allowBash maps to auto/ask", async () => {
  assert.equal((await makeExecutor({ cwd: cwd(), allowBash: true })("run_bash", { command: "echo A" })).ok, true);
  assert.equal((await makeExecutor({ cwd: cwd(), allowBash: false })("run_bash", { command: "echo B" })).ok, false);
});
