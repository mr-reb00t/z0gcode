import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCustomCommands, expandTemplate, loadHooks, hasHooks } from "../src/commands.mjs";

function project() {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0gcmd-"));
  mkdirSync(path.join(cwd, ".z0g", "commands"), { recursive: true });
  return cwd;
}

test("loads commands with frontmatter description, sorted", () => {
  const cwd = project();
  writeFileSync(path.join(cwd, ".z0g", "commands", "review.md"), "---\ndescription: Review a file\n---\nReview $ARGUMENTS for bugs.");
  writeFileSync(path.join(cwd, ".z0g", "commands", "note.md"), "Take a note.");
  const cmds = loadCustomCommands(cwd);
  assert.deepEqual(cmds.map((c) => c.name), ["note", "review"]);
  assert.equal(cmds.find((c) => c.name === "review").description, "Review a file");
});

test("expandTemplate substitutes $ARGUMENTS or appends", () => {
  assert.equal(expandTemplate("Review $ARGUMENTS now", "x.js"), "Review x.js now");
  assert.equal(expandTemplate("Do a thing", "extra"), "Do a thing\n\nextra");
  assert.equal(expandTemplate("Do a thing", ""), "Do a thing");
  assert.equal(expandTemplate("{{ args }}!", "hi"), "hi!");
});

test("loads and normalizes hooks", () => {
  const cwd = project();
  writeFileSync(path.join(cwd, ".z0g", "hooks.json"), JSON.stringify({ preRun: "echo a", postRun: ["echo b", "echo c"] }));
  const hooks = loadHooks(cwd);
  assert.deepEqual(hooks.preRun, ["echo a"]);
  assert.deepEqual(hooks.postRun, ["echo b", "echo c"]);
  assert.equal(hasHooks(hooks), true);
  assert.equal(hasHooks({}), false);
});

test("no .z0g -> no commands, no hooks", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0gempty-"));
  assert.deepEqual(loadCustomCommands(cwd), []);
  assert.deepEqual(loadHooks(cwd), {});
});
