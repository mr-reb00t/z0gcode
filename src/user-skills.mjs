// User skills: Claude-Code-style extensibility. Drop a markdown file with
// frontmatter (name, description) into ~/.z0gcode/skills (global) or
// <cwd>/.z0g/skills (project) and it is auto-discovered: the description is
// injected into the system prompt so the model knows when to use it, and the
// body is loaded on demand via the read_skill tool (progressive disclosure).
// A skill can be a single <name>.md or a <name>/SKILL.md directory.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSettings, saveSetting } from "./settings.mjs";

const skillDirs = (cwd) => [
  ["global", path.join(os.homedir(), ".z0gcode", "skills")],
  ["project", path.join(cwd || process.cwd(), ".z0g", "skills")],
];

// Parse a leading `---\n...\n---` YAML-ish frontmatter block (name/description).
function parseFrontmatter(text) {
  const meta = {};
  let body = text;
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      meta[k] = v;
    }
  }
  return { meta, body };
}

function resolveSkillFile(dir, entry) {
  const p = path.join(dir, entry);
  try {
    const st = statSync(p);
    if (st.isDirectory()) {
      const sk = path.join(p, "SKILL.md");
      return existsSync(sk) ? { file: sk, defaultName: entry } : null;
    }
    if (entry.toLowerCase().endsWith(".md")) {
      return { file: p, defaultName: entry.replace(/\.md$/i, "") };
    }
  } catch {}
  return null;
}

// Discover all user skills. Project scope overrides global by name.
// Each: { name, description, file, scope, enabled }.
export function discoverSkills(cwd) {
  const disabled = new Set(loadSettings(cwd).disabledSkills || []);
  const found = new Map();
  for (const [scope, dir] of skillDirs(cwd)) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const r = resolveSkillFile(dir, entry);
      if (!r) continue;
      let text;
      try {
        text = readFileSync(r.file, "utf8");
      } catch {
        continue;
      }
      const { meta } = parseFrontmatter(text);
      const name = String(meta.name || r.defaultName).trim();
      if (!name) continue;
      found.set(name, { name, description: String(meta.description || "").trim(), file: r.file, scope });
    }
  }
  return [...found.values()].map((s) => ({ ...s, enabled: !disabled.has(s.name) }));
}

export function readUserSkill(cwd, name) {
  const hit = discoverSkills(cwd).find((s) => s.name === name);
  if (!hit) return null;
  try {
    return parseFrontmatter(readFileSync(hit.file, "utf8")).body.trim();
  } catch {
    return null;
  }
}

// System-prompt block listing the ENABLED user skills so the model can decide
// to load them. Empty string when there are none.
export function skillsPromptBlock(cwd) {
  const enabled = discoverSkills(cwd).filter((s) => s.enabled);
  if (!enabled.length) return "";
  const lines = enabled.map((s) => `- ${s.name}: ${s.description || "(no description)"}`);
  return [
    "",
    "User skills available (call read_skill with the exact name to load the full instructions before you act on it):",
    ...lines,
  ].join("\n");
}

// Enable/disable a skill by name (persisted in global settings.disabledSkills).
export function setSkillEnabled(cwd, name, enabled) {
  const cur = new Set(loadSettings(cwd).disabledSkills || []);
  if (enabled) cur.delete(name);
  else cur.add(name);
  saveSetting("disabledSkills", [...cur]);
}
