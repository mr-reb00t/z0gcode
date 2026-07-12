// Session memory: persist the conversation for a working directory so it can be continued.
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = (cwd) => path.join(cwd, ".z0g", "session.json");

export async function saveSession(cwd, messages) {
  const f = FILE(cwd);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ tool: "z0gcode", ts: new Date().toISOString(), messages }, null, 2), "utf8");
}

export async function loadSession(cwd) {
  try {
    const d = JSON.parse(await fs.readFile(FILE(cwd), "utf8"));
    return Array.isArray(d.messages) && d.messages.length ? d.messages : null;
  } catch {
    return null;
  }
}
