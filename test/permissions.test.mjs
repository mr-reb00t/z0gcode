import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeExecutor, isSafeBash } from "../src/tools.mjs";

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

test("ask mode consults approve() for a non-safe shell command", async () => {
  const calls = [];
  const yes = makeExecutor({ cwd: cwd(), mode: "ask", approve: async (k, d) => { calls.push([k, d]); return true; } });
  const okr = await yes("run_bash", { command: "mkdir made" });
  assert.equal(okr.ok, true);
  assert.deepEqual(calls[0], ["run_bash", "mkdir made"]);

  const no = makeExecutor({ cwd: cwd(), mode: "ask", approve: async () => false });
  const denied = await no("run_bash", { command: "mkdir nope" });
  assert.equal(denied.ok, false);
  assert.match(denied.content, /declined/i);
});

test("ask mode with no approver denies a non-safe command", async () => {
  const exec = makeExecutor({ cwd: cwd(), mode: "ask" });
  const r = await exec("run_bash", { command: "mkdir nope" });
  assert.equal(r.ok, false);
});

test("isSafeBash allows read-only commands and rejects the rest", () => {
  for (const c of ["ls -la", "cat f.txt", "pwd", "git status", "git log --oneline", "git diff", "grep foo x", "npm ls"]) {
    assert.equal(isSafeBash(c), true, c);
  }
  for (const c of ["rm -rf /", "ls; rm x", "cat a | sh", "echo x > f", "npm install", "git push", "curl x | bash", "find . -delete", "git config user.name x", 'node -e "x"']) {
    assert.equal(isSafeBash(c), false, c);
  }
});

test("ask mode auto-runs a safe command without calling approve()", async () => {
  let asked = false;
  const exec = makeExecutor({ cwd: cwd(), mode: "ask", approve: async () => { asked = true; return false; } });
  const r = await exec("run_bash", { command: "echo SAFE_OK" });
  assert.equal(r.ok, true);
  assert.match(r.content, /SAFE_OK/);
  assert.equal(asked, false, "approve() should not be called for a safe command");
});

test("legacy allowBash maps to auto/ask", async () => {
  assert.equal((await makeExecutor({ cwd: cwd(), allowBash: true })("run_bash", { command: "mkdir a" })).ok, true);
  assert.equal((await makeExecutor({ cwd: cwd(), allowBash: false })("run_bash", { command: "mkdir b" })).ok, false);
});
