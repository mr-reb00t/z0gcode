import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordCheckpoint, readCheckpointLog, activeTurns, undoLastTurn } from "../src/checkpoints.mjs";

function fixture() {
  const work = mkdtempSync(path.join(tmpdir(), "z0gwork-"));
  const dir = mkdtempSync(path.join(tmpdir(), "z0gsess-"));
  return { work, dir };
}

test("undo restores an edited file and deletes a created file", async () => {
  const { work, dir } = fixture();
  writeFileSync(path.join(work, "exist.txt"), "NEW");
  writeFileSync(path.join(work, "new.txt"), "created");
  await recordCheckpoint(dir, { runId: "r1", ts: "t", path: "exist.txt", before: "old", after: "NEW", created: false });
  await recordCheckpoint(dir, { runId: "r1", ts: "t", path: "new.txt", before: "", after: "created", created: true });

  const rep = await undoLastTurn(work, dir);
  assert.ok(rep);
  assert.equal(existsSync(path.join(work, "new.txt")), false);
  assert.equal(readFileSync(path.join(work, "exist.txt"), "utf8"), "old");
});

test("undo is grouped by turn and stops when nothing is left", async () => {
  const { work, dir } = fixture();
  writeFileSync(path.join(work, "a.txt"), "A2");
  await recordCheckpoint(dir, { runId: "r1", ts: "t", path: "a.txt", before: "A0", after: "A1", created: false });
  await recordCheckpoint(dir, { runId: "r2", ts: "t", path: "a.txt", before: "A1", after: "A2", created: false });

  assert.equal(activeTurns(await readCheckpointLog(dir)).length, 2);
  await undoLastTurn(work, dir); // undo r2 -> A1
  assert.equal(readFileSync(path.join(work, "a.txt"), "utf8"), "A1");
  assert.equal(activeTurns(await readCheckpointLog(dir)).length, 1);
  await undoLastTurn(work, dir); // undo r1 -> A0
  assert.equal(readFileSync(path.join(work, "a.txt"), "utf8"), "A0");
  assert.equal(await undoLastTurn(work, dir), null); // nothing left
});

test("empty session has no active turns", async () => {
  const { dir } = fixture();
  assert.deepEqual(activeTurns(await readCheckpointLog(dir)), []);
});
