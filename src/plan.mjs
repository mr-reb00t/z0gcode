// Plan/checklist: the agent maintains a visible todo list for multi-step tasks.
// `dir` is the session directory (.z0g/sessions/<id>) so the plan is per-chat.
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = (dir) => path.join(dir, "plan.json");

export async function savePlan(dir, plan) {
  const f = FILE(dir);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ tool: "z0gcode", ts: new Date().toISOString(), plan }, null, 2), "utf8");
}

export async function loadPlan(dir) {
  try {
    const d = JSON.parse(await fs.readFile(FILE(dir), "utf8"));
    return Array.isArray(d.plan) ? d.plan : null;
  } catch {
    return null;
  }
}
