// Project context: auto-loaded guidance the agent should always follow.
// Looks for AGENTS.md (the emerging standard) and .z0g/context.md in the
// working directory, and injects them into the system prompt.
import { readFileSync } from "node:fs";
import path from "node:path";

const CANDIDATES = ["AGENTS.md", ".z0g/context.md"];
const MAX_CONTEXT = 8000; // keep the injected block small

// Return [{ source, text }] for each context file found (may be empty).
export function loadProjectContext(cwd) {
  const found = [];
  let budget = MAX_CONTEXT;
  for (const rel of CANDIDATES) {
    if (budget <= 0) break;
    try {
      let text = readFileSync(path.join(cwd, rel), "utf8").trim();
      if (!text) continue;
      if (text.length > budget) text = text.slice(0, budget) + "\n… [truncated]";
      budget -= text.length;
      found.push({ source: rel, text });
    } catch { /* not present */ }
  }
  return found;
}

// A system-prompt block describing the project context, or "" if none.
export function contextPromptBlock(cwd) {
  const found = loadProjectContext(cwd);
  if (!found.length) return "";
  const parts = found.map((f) => "----- " + f.source + " -----\n" + f.text);
  return [
    "## Project context",
    "This project ships contributor guidance below. Treat it as authoritative:",
    "follow its conventions, use its build/test/run commands, and respect its constraints.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

// The task the agent runs for `z0g init` / `/init` to author an AGENTS.md.
export const INIT_TASK = [
  "Analyze THIS project and write a concise AGENTS.md at the repository root, so future agents and contributors have the context they need.",
  "",
  "Investigate first (do not guess): use list_dir on the root and key folders, read package.json / pyproject.toml / go.mod / Cargo.toml / any config, read the README if present, and search_files for scripts, test setup, and entry points.",
  "",
  "AGENTS.md MUST contain, as short markdown sections:",
  "1. Overview: one paragraph on what the project is and does.",
  "2. Stack: languages, frameworks, key dependencies.",
  "3. Commands: exact install, build, run, and test commands you actually found (do NOT invent them; if a command is missing, say so).",
  "4. Layout: the important directories and what lives in each.",
  "5. Conventions: anything a contributor must follow (style, patterns, gotchas) that you can infer from the code.",
  "",
  "Keep it under ~150 lines and specific to this repo. Create it with write_file at path 'AGENTS.md'. When done, reply with a one-line summary.",
].join("\n");
