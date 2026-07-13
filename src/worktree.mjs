// Git worktree isolation for parallel WRITE subagents. Each write subagent gets
// its own worktree branched from HEAD, edits there, and its diff is applied back
// to the main working tree. Non-overlapping edits merge cleanly; overlapping
// files are reported and skipped (never half-applied).
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const run = (cmd, cwd) => new Promise((resolve) => {
  exec(cmd, { cwd, timeout: 180000, maxBuffer: 1 << 26 }, (err, stdout, stderr) =>
    resolve({ code: err?.code ?? 0, out: stdout || "", err: stderr || "" }));
});
const q = (s) => JSON.stringify(s); // shell-quote a path

export async function isGitRepo(cwd) {
  const r = await run("git rev-parse --is-inside-work-tree", cwd);
  return r.code === 0 && /true/.test(r.out);
}

// Create a worktree (outside the repo, in a temp dir) on a fresh branch at HEAD.
export async function addWorktree(cwd, name) {
  const wtPath = path.join(os.tmpdir(), "z0g-wt", name);
  const branch = "z0g/" + name;
  await fs.mkdir(path.dirname(wtPath), { recursive: true });
  await run(`git worktree remove --force ${q(wtPath)}`, cwd);
  await run(`git branch -D ${q(branch)}`, cwd);
  const r = await run(`git worktree add --quiet -b ${q(branch)} ${q(wtPath)} HEAD`, cwd);
  if (r.code !== 0) throw new Error("git worktree add failed: " + (r.err || r.out).trim());
  return { wtPath, branch };
}

// Stage everything in the worktree and return its diff vs HEAD (may be empty).
export async function collectPatch(wtPath) {
  await run("git add -A", wtPath);
  const patch = (await run("git diff --cached --binary HEAD", wtPath)).out;
  const files = (await run("git diff --cached --name-only HEAD", wtPath)).out.split("\n").filter(Boolean);
  return { patch, files };
}

export async function removeWorktree(cwd, wtPath, branch) {
  await run(`git worktree remove --force ${q(wtPath)}`, cwd);
  if (branch) await run(`git branch -D ${q(branch)}`, cwd);
}

// Apply a patch to the main tree, all-or-nothing (no conflict markers left).
// Returns { ok, reason }. ok:false with reason when it would conflict.
export async function applyPatch(cwd, patch) {
  if (!patch || !patch.trim()) return { ok: true, reason: "no changes" };
  const tmp = path.join(os.tmpdir(), "z0g-wt", "apply-" + Math.floor(Math.random() * 1e9) + ".patch");
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  await fs.writeFile(tmp, patch, "utf8");
  try {
    const check = await run(`git apply --binary --check ${q(tmp)}`, cwd);
    if (check.code !== 0) return { ok: false, reason: "conflicts with current tree, skipped" };
    const r = await run(`git apply --binary --whitespace=nowarn ${q(tmp)}`, cwd);
    return r.code === 0 ? { ok: true, reason: "applied" } : { ok: false, reason: (r.err || r.out).trim() };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
