// User settings, persisted like Claude Code's settings.json.
// Global: ~/.z0gcode/settings.json. Project overrides: <cwd>/.z0g/settings.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const GLOBAL_DIR = path.join(os.homedir(), ".z0gcode");
const GLOBAL_FILE = path.join(GLOBAL_DIR, "settings.json");
const projectFile = (cwd) => path.join(cwd, ".z0g", "settings.json");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// Merge global then project (project wins).
export function loadSettings(cwd) {
  const g = readJson(GLOBAL_FILE);
  const p = cwd ? readJson(projectFile(cwd)) : {};
  return { ...g, ...p };
}

// Save a key to the global settings file.
export function saveSetting(key, value) {
  const s = readJson(GLOBAL_FILE);
  s[key] = value;
  try {
    mkdirSync(GLOBAL_DIR, { recursive: true });
    writeFileSync(GLOBAL_FILE, JSON.stringify(s, null, 2) + "\n");
  } catch {}
  return s;
}

export const settingsPath = GLOBAL_FILE;
