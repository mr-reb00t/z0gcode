// Custom slash commands and lifecycle hooks, both project-local under .z0g/.
//
// Commands: .z0g/commands/<name>.md -> /<name>. The file body is a prompt
// template; "$ARGUMENTS" (or {{args}}) is replaced with whatever follows the
// command, otherwise the args are appended. Optional frontmatter: description.
//
// Hooks: .z0g/hooks.json maps an event (preRun, postRun) to a shell command or
// a list of them. Hooks run shell, so they only fire with --auto.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import * as ui from "./ui.mjs";

const CMD_DIR = (cwd) => path.join(cwd, ".z0g", "commands");

// Parse optional --- frontmatter, returning { meta, body }.
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

export function loadCustomCommands(cwd) {
  const dir = CMD_DIR(cwd);
  if (!existsSync(dir)) return [];
  const out = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return []; }
  for (const f of files) {
    try {
      const { meta, body } = parseFrontmatter(readFileSync(path.join(dir, f), "utf8"));
      const name = f.replace(/\.md$/, "").toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) continue;
      out.push({ name, description: meta.description || "custom command", template: body.trim(), file: path.join(dir, f) });
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function expandTemplate(template, args) {
  const a = (args || "").trim();
  if (/\$ARGUMENTS|\{\{\s*args\s*\}\}/.test(template)) {
    return template.replace(/\$ARGUMENTS|\{\{\s*args\s*\}\}/g, a);
  }
  return a ? template + "\n\n" + a : template;
}

// ---- hooks ----------------------------------------------------------------
const HOOK_EVENTS = ["preRun", "postRun"];

export function loadHooks(cwd) {
  const file = path.join(cwd, ".z0g", "hooks.json");
  if (!existsSync(file)) return {};
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
  const hooks = {};
  for (const ev of HOOK_EVENTS) {
    const v = raw[ev];
    if (!v) continue;
    hooks[ev] = (Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
  }
  return hooks;
}

export function hasHooks(hooks) {
  return HOOK_EVENTS.some((e) => hooks[e] && hooks[e].length);
}

const run1 = (cmd, cwd) => new Promise((resolve) => {
  exec(cmd, { cwd, timeout: 120000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
    resolve({ code: err?.code ?? 0, out: (stdout || "") + (stderr || "") });
  });
});

// Run the shell commands for an event. Only fires with allowBash (--auto).
export async function runHooks(cwd, event, hooks, allowBash, taskText) {
  const cmds = hooks?.[event];
  if (!cmds || !cmds.length) return;
  if (!allowBash) return; // hooks run shell; require --auto
  for (const cmd of cmds) {
    const expanded = cmd.replace(/\$TASK/g, () => (taskText || "").replace(/"/g, '\\"'));
    console.log(ui.muted("  " + ui.GLYPH.point + " hook " + event + ": ") + ui.muted(cmd));
    const { code, out } = await run1(expanded, cwd);
    const text = out.trim();
    if (text) console.log(text.split("\n").map((l) => "    " + ui.muted(l)).join("\n"));
    if (code !== 0) console.log("    " + ui.warn("hook exited " + code));
  }
}
