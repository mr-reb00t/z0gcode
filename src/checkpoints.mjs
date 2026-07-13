// Checkpoints: an append-only log of every file edit (with full before/after
// content) so `z0g undo` can revert what the agent did. Grouped by runId so a
// single undo reverts a whole turn (which may touch several files).
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = (dir) => path.join(dir, "checkpoints.jsonl");

export async function recordCheckpoint(dir, entry) {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(FILE(dir), JSON.stringify(entry) + "\n", "utf8");
}

export async function readCheckpointLog(dir) {
  try {
    const raw = await fs.readFile(FILE(dir), "utf8");
    return raw.split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// Active edit turns (runId -> edits), newest last, excluding undone runs.
export function activeTurns(log) {
  const undone = new Set(log.filter((e) => e.op === "undo").map((e) => e.runId));
  const turns = new Map();
  for (const e of log) {
    if (e.op) continue;               // undo markers carry no edit
    if (undone.has(e.runId)) continue;
    if (!turns.has(e.runId)) turns.set(e.runId, { runId: e.runId, ts: e.ts, task: e.task, edits: [] });
    turns.get(e.runId).edits.push(e);
  }
  return [...turns.values()];
}

// Revert the most recent active turn. Restores each file's `before` (or deletes
// files the turn created), in reverse edit order. Returns a report or null.
export async function undoLastTurn(cwd, dir) {
  const log = await readCheckpointLog(dir);
  const turns = activeTurns(log);
  if (!turns.length) return null;
  const turn = turns[turns.length - 1];
  const files = [];
  for (const e of [...turn.edits].reverse()) {
    const abs = path.resolve(cwd, e.path);
    let cur = null;
    try { cur = await fs.readFile(abs, "utf8"); } catch { cur = null; }
    const diverged = cur !== null && cur !== e.after; // changed since the agent left it
    try {
      if (e.created) {
        await fs.rm(abs, { force: true });
        files.push({ path: e.path, action: "deleted", diverged });
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, e.before ?? "", "utf8");
        files.push({ path: e.path, action: "restored", diverged });
      }
    } catch (err) {
      files.push({ path: e.path, action: "failed", error: err.message });
    }
  }
  await recordCheckpoint(dir, { op: "undo", runId: turn.runId, ts: new Date().toISOString() });
  return { runId: turn.runId, ts: turn.ts, task: turn.task, files };
}
