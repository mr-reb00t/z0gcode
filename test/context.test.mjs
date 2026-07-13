import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProjectContext, contextPromptBlock, INIT_TASK } from "../src/context.mjs";

test("loads AGENTS.md and .z0g/context.md", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0gctx-"));
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Demo\nRun tests with: npm test\n");
  mkdirSync(path.join(cwd, ".z0g"), { recursive: true });
  writeFileSync(path.join(cwd, ".z0g", "context.md"), "Prefer edit_file.\n");

  const found = loadProjectContext(cwd);
  assert.deepEqual(found.map((f) => f.source).sort(), [".z0g/context.md", "AGENTS.md"]);

  const block = contextPromptBlock(cwd);
  assert.match(block, /Project context/);
  assert.match(block, /npm test/);
  assert.match(block, /Prefer edit_file/);
});

test("no context files -> empty block", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0gctx-"));
  assert.deepEqual(loadProjectContext(cwd), []);
  assert.equal(contextPromptBlock(cwd), "");
});

test("INIT_TASK asks for an AGENTS.md and forbids inventing commands", () => {
  assert.match(INIT_TASK, /AGENTS\.md/);
  assert.match(INIT_TASK, /do NOT invent/i);
});
