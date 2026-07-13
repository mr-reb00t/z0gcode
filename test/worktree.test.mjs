import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isGitRepo, addWorktree, collectPatch, removeWorktree, applyPatch } from "../src/worktree.mjs";

const git = (cwd, args) => execSync(`git -c user.email=t@z0g.dev -c user.name=z0g ${args}`, { cwd, stdio: "pipe" });

function repo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0grepo-"));
  git(cwd, "init -q");
  writeFileSync(path.join(cwd, "base.txt"), "hello\n");
  git(cwd, "add -A");
  git(cwd, "commit -qm init");
  return cwd;
}

test("isGitRepo distinguishes a repo from a plain dir", async () => {
  assert.equal(await isGitRepo(repo()), true);
  assert.equal(await isGitRepo(mkdtempSync(path.join(tmpdir(), "z0gplain-"))), false);
});

test("worktree diff applies back to the main tree; a duplicate add is skipped", async () => {
  const cwd = repo();
  const { wtPath, branch } = await addWorktree(cwd, "t" + process.pid + "-a");
  assert.equal(existsSync(path.join(wtPath, "base.txt")), true);

  writeFileSync(path.join(wtPath, "new.txt"), "world\n");
  writeFileSync(path.join(wtPath, "base.txt"), "hello there\n");
  const { patch, files } = await collectPatch(wtPath);
  assert.ok(files.includes("new.txt") && files.includes("base.txt"));
  await removeWorktree(cwd, wtPath, branch);

  const a = await applyPatch(cwd, patch);
  assert.equal(a.ok, true);
  assert.equal(readFileSync(path.join(cwd, "new.txt"), "utf8"), "world\n");
  assert.equal(readFileSync(path.join(cwd, "base.txt"), "utf8"), "hello there\n");

  // Applying the same patch again conflicts (new.txt already exists) -> skipped.
  const a2 = await applyPatch(cwd, patch);
  assert.equal(a2.ok, false);
});

test("empty patch is a no-op", async () => {
  assert.deepEqual(await applyPatch(repo(), ""), { ok: true, reason: "no changes" });
});
