// Multi-chat sessions per project. Each session lives in its own directory
// under .z0g/sessions/<id>/ and isolates its conversation (session.json),
// plan (plan.json), and provenance (provenance.json). File changes on disk are
// shared across sessions; the recorded history/plan/provenance are not.
import { promises as fs } from "node:fs";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = (cwd) => path.join(cwd, ".z0g", "sessions");
export const sessionDir = (cwd, id) => path.join(root(cwd), id);
const sessionFile = (cwd, id) => path.join(sessionDir(cwd, id), "session.json");

function genId() {
  // Sortable: base36 timestamp + a short random suffix (unique per run).
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e7).toString(36);
  return `${t}-${r}`;
}

// Auto-title from the first user message (single line, truncated).
export function autoTitle(messages) {
  const first = (messages || []).find(
    (m) => m.role === "user" && typeof m.content === "string" && m.content.trim()
  );
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 47) + "…" : t;
}

function countTurns(messages) {
  return Array.isArray(messages) ? messages.filter((m) => m.role === "user" || m.role === "assistant").length : 0;
}

async function readSession(cwd, id) {
  try {
    return JSON.parse(await fs.readFile(sessionFile(cwd, id), "utf8"));
  } catch {
    return null;
  }
}

export async function createSession(cwd, { title = "" } = {}) {
  const id = genId();
  const now = new Date().toISOString();
  const data = { tool: "z0gcode", id, title, created: now, updated: now, messages: [] };
  await fs.mkdir(sessionDir(cwd, id), { recursive: true });
  await fs.writeFile(sessionFile(cwd, id), JSON.stringify(data, null, 2), "utf8");
  return { id, dir: sessionDir(cwd, id), title, history: [] };
}

export async function readMessages(cwd, id) {
  const d = await readSession(cwd, id);
  return d && Array.isArray(d.messages) && d.messages.length ? d.messages : null;
}

export async function saveMessages(cwd, id, messages) {
  const d = (await readSession(cwd, id)) || { tool: "z0gcode", id, title: "", created: new Date().toISOString() };
  d.messages = messages;
  d.updated = new Date().toISOString();
  if (!d.title) d.title = autoTitle(messages);
  await fs.mkdir(sessionDir(cwd, id), { recursive: true });
  await fs.writeFile(sessionFile(cwd, id), JSON.stringify(d, null, 2), "utf8");
}

// Sync listing (used before async flows and by the picker). Newest first.
export function listSessions(cwd) {
  const dir = root(cwd);
  if (!existsSync(dir)) return [];
  const out = [];
  let ids = [];
  try {
    ids = readdirSync(dir);
  } catch {
    return [];
  }
  for (const id of ids) {
    const f = sessionFile(cwd, id);
    if (!existsSync(f)) continue;
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      out.push({
        id,
        title: (d.title && d.title.trim()) || autoTitle(d.messages),
        updated: d.updated || d.created || "",
        messageCount: countTurns(d.messages),
      });
    } catch {}
  }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return out;
}

export function hasSessions(cwd) {
  return listSessions(cwd).length > 0;
}

export function mostRecent(cwd) {
  const s = listSessions(cwd);
  return s.length ? s[0].id : null;
}

export async function renameSession(cwd, id, title) {
  const d = await readSession(cwd, id);
  if (!d) return false;
  const t = String(title || "").trim();
  if (!t) return false;
  d.title = t;
  await fs.writeFile(sessionFile(cwd, id), JSON.stringify(d, null, 2), "utf8");
  return true;
}

export async function deleteSession(cwd, id) {
  await fs.rm(sessionDir(cwd, id), { recursive: true, force: true });
}

// Synchronous prune of a session that persisted no messages. Safe to call from
// a SIGINT handler, where async cleanup would not run before the process exits.
export function pruneEmptySync(cwd, id) {
  try {
    const s = listSessions(cwd).find((x) => x.id === id);
    if (s && s.messageCount === 0) rmSync(sessionDir(cwd, id), { recursive: true, force: true });
  } catch {}
}

// Import a legacy single .z0g/session.json (+ plan/provenance) as one session,
// exactly once, so upgrading loses no history.
export async function migrateLegacy(cwd) {
  const legacy = path.join(cwd, ".z0g", "session.json");
  if (!existsSync(legacy) || hasSessions(cwd)) return;
  let messages = [];
  try {
    const d = JSON.parse(readFileSync(legacy, "utf8"));
    messages = Array.isArray(d.messages) ? d.messages : [];
  } catch {
    messages = [];
  }
  if (messages.length) {
    const { id } = await createSession(cwd, { title: autoTitle(messages) });
    await saveMessages(cwd, id, messages);
    for (const name of ["plan.json", "provenance.json"]) {
      const src = path.join(cwd, ".z0g", name);
      if (existsSync(src)) {
        try {
          await fs.copyFile(src, path.join(sessionDir(cwd, id), name));
        } catch {}
      }
    }
  }
  try {
    await fs.rename(legacy, legacy + ".migrated");
  } catch {}
}

// Add .z0g/ to the project .gitignore (only in a git repo, only once) so
// sessions and provenance are not committed by accident.
export async function ensureGitignore(cwd) {
  if (!existsSync(path.join(cwd, ".git"))) return;
  const gi = path.join(cwd, ".gitignore");
  let content = "";
  try {
    content = readFileSync(gi, "utf8");
  } catch {}
  if (/^\s*\.z0g\/?\s*$/m.test(content)) return; // already ignored
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  try {
    await fs.appendFile(gi, prefix + ".z0g/\n");
  } catch {}
}
