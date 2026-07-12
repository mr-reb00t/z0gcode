// Plan/checklist: the agent maintains a visible todo list for multi-step tasks.
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = (cwd) => path.join(cwd, ".z0g", "plan.json");

export async function savePlan(cwd, plan) {
  const f = FILE(cwd);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ tool: "z0gcode", ts: new Date().toISOString(), plan }, null, 2), "utf8");
}

export async function loadPlan(cwd) {
  try {
    const d = JSON.parse(await fs.readFile(FILE(cwd), "utf8"));
    return Array.isArray(d.plan) ? d.plan : null;
  } catch {
    return null;
  }
}
