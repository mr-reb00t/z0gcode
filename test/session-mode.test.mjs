import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSession, getSessionMode, setSessionMode, saveMessages, listSessions } from "../src/sessions.mjs";

const cwd = () => mkdtempSync(path.join(tmpdir(), "z0gmode-"));

test("a chat remembers its permission mode across reopen", async () => {
  const c = cwd();
  const s = await createSession(c, {});
  assert.equal(await getSessionMode(c, s.id), null, "new chat has no saved mode");
  await setSessionMode(c, s.id, "auto");
  assert.equal(await getSessionMode(c, s.id), "auto");
  await setSessionMode(c, s.id, "plan");
  assert.equal(await getSessionMode(c, s.id), "plan");
});

test("invalid modes are ignored", async () => {
  const c = cwd();
  const s = await createSession(c, {});
  await setSessionMode(c, s.id, "bogus");
  assert.equal(await getSessionMode(c, s.id), null);
});

test("saving the mode does not disturb messages or the listing", async () => {
  const c = cwd();
  const s = await createSession(c, {});
  await saveMessages(c, s.id, [{ role: "user", content: "hi there" }]);
  await setSessionMode(c, s.id, "auto");
  const list = listSessions(c).find((x) => x.id === s.id);
  assert.equal(list.messageCount, 1, "message count preserved");
  assert.equal(await getSessionMode(c, s.id), "auto");
});
