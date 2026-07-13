// Load .env into process.env BEFORE anything reads config. Imported first in
// bin/z0g.mjs so config.mjs sees the vars. Dependency-free; never overrides a
// variable already set in the real environment.
//
// Lookup order (first found wins per variable, real env always wins):
//   1. the nearest .env walking up from the current directory (project-local),
//      so `z0g` works from any subfolder of a project, not just its root.
//   2. ~/.z0gcode/.env (global), so a key set once works from anywhere.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function loadEnvFile(file) {
  if (!file || !existsSync(file)) return;
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const keyPart = line.slice(0, eq).replace(/^export\s+/, "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyPart)) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[keyPart] === undefined) process.env[keyPart] = val;
    }
  } catch {
    // ignore a malformed .env
  }
}

// Nearest .env walking up from `dir` to the filesystem root.
function nearestEnv(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    const f = path.join(cur, ".env");
    if (existsSync(f)) return f;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

loadEnvFile(nearestEnv(process.cwd()));                       // project-local (any ancestor)
loadEnvFile(path.join(os.homedir(), ".z0gcode", ".env"));    // global fallback
