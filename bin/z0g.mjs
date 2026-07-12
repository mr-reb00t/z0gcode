#!/usr/bin/env node
// z0gcode CLI: a coding agent whose brain runs on 0G Compute.
import "../src/env.mjs"; // load .env before config reads process.env
import readline from "node:readline";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";
import { CONFIG, normEffort, EFFORT_LEVELS } from "../src/config.mjs";
import { makeClient } from "../src/client.mjs";
import { runAgent } from "../src/agent.mjs";
import { runGoal } from "../src/goal.mjs";
import { loadProvenance } from "../src/provenance.mjs";
import {
  sessionDir, listSessions, mostRecent, createSession,
  readMessages, saveMessages, renameSession, deleteSession, migrateLegacy, ensureGitignore, pruneEmptySync,
} from "../src/sessions.mjs";
import { loadPlan } from "../src/plan.mjs";
import { loadMcp } from "../src/mcp.mjs";
import { saveSetting } from "../src/settings.mjs";
import { fetchModels, orderChatModels } from "../src/models-info.mjs";
import { discoverSkills, setSkillEnabled } from "../src/user-skills.mjs";
import { arrowSelect } from "../src/prompt.mjs";
import * as ui from "../src/ui.mjs";

function helpText() {
  const groups = [
    ["Run", [
      ['z0g "<task>"', "Run a coding task (one-shot)"],
      ["z0g", "Interactive session (REPL, /help for commands)"],
      ['z0g goal "<obj>"', "Iterate until a verify command passes"],
    ]],
    ["Inspect", [
      ["z0g models", "List the 0G models on the Router (add --json)"],
      ["z0g skills", "List user/project skills (enable|disable <name>)"],
      ["z0g doctor", "Check your 0G setup (key, connectivity, model)"],
      ["z0g attest", "Show which 0G model wrote which change"],
    ]],
    ["Serve", [
      ["z0g serve --mcp", "Expose z0gcode's 0G tools as an MCP server"],
    ]],
    ["Options", [
      ["--auto", "Allow shell + on-chain actions (run_bash, deploy, upload)"],
      ["--continue", "Continue the saved session in this directory"],
      ["--model <id>", "Override the model (default " + CONFIG.model + ")"],
      ["--effort <l>", "Reasoning effort: low, medium, high (default: model's own)"],
      ['--verify "<cmd>"', "Run, then verify and self-correct with this command"],
      ["--auto-verify", "Same, auto-detecting the verify command"],
      ["--max-steps <n>", "Max agent steps (default " + CONFIG.maxSteps + ")"],
      ["--cwd <dir>", "Working directory (default: current)"],
    ]],
    ["Setup", [
      ["ZOG_API_KEY", "Your 0G Router key (env or .env). Get one at https://pc.0g.ai"],
    ]],
  ];
  const w = Math.max(...groups.flatMap(([, rows]) => rows.map(([c]) => c.length))) + 2;
  const out = [ui.strong("z0gcode") + ui.muted(" · a coding agent whose brain runs on 0G Compute.")];
  for (const [title, rows] of groups) {
    out.push("");
    out.push("  " + ui.muted(title));
    for (const [c, d] of rows) out.push("  " + ui.accent(c.padEnd(w)) + ui.muted(d));
  }
  out.push("");
  out.push("  " + ui.muted("0G is the default backend: no OpenAI or Anthropic key, no config file."));
  return out.join("\n");
}

const SLASH_COMMANDS = [
  ["/help", "Show commands"],
  ["/clear", "Reset the conversation context"],
  ["/chats", "Switch chat (arrow-key picker, search, rename, delete)"],
  ["/new", "Start a new chat (/new [title])"],
  ["/rename", "Rename the current chat (/rename <title>)"],
  ["/model", "Pick the active 0G model (saved to settings)"],
  ["/effort", "Set reasoning effort (low|medium|high|default)"],
  ["/skills", "List skills; /skills enable|disable <name>"],
  ["/attest", "Show the provenance manifest"],
  ["/plan", "Show the current task checklist"],
  ["/verify", "Run the project's verify command (npm test / .z0g/verify)"],
  ["/goal", "Run until the verify command passes"],
  ["/exit", "Quit"],
];

// Menu shown on /help or when you type "/" and hit Enter. `filter` narrows it.
function slashMenu(filter) {
  let rows = SLASH_COMMANDS;
  if (filter) {
    const f = SLASH_COMMANDS.filter(([c]) => c.startsWith(filter));
    if (f.length) rows = f;
  }
  const list = rows.map(([c, d]) => `  ${ui.accent(c.padEnd(9))}  ${ui.muted(d)}`).join("\n");
  return "  " + ui.muted("Commands") + "\n" + list;
}

// Tab-completion for slash commands: "/" + Tab lists all, "/mo" + Tab -> "/model".
function slashCompleter(line) {
  if (!line.startsWith("/")) return [[], line];
  const names = SLASH_COMMANDS.map(([c]) => c);
  const hits = names.filter((c) => c.startsWith(line));
  return [hits.length ? hits : names, line];
}

// Fetch chat models ordered for the picker (default first, verifiable by price).
async function chatModelsFor(client, current) {
  try {
    const all = await fetchModels(client);
    const chat = orderChatModels(all, current).filter((m) => m.tools);
    return chat.length ? chat : orderChatModels(all, current);
  } catch (e) {
    ui.error("could not list models: " + e.message);
    return null;
  }
}

const interactiveTTY = () => ui.interactive && typeof process.stdin.setRawMode === "function";

// One-shot line prompt (used for rename/delete confirmation inside the picker).
// Isolate the outer (paused) REPL readline's keypress listeners while we read,
// or it buffers this input and replays it as a spurious task on resume.
function ask(question) {
  return new Promise((resolve) => {
    const saved = process.stdin.listeners("keypress").slice();
    for (const l of saved) process.stdin.removeListener("keypress", l);
    const r = readline.createInterface({ input: process.stdin, output: process.stdout });
    r.question(question, (a) => {
      r.close();
      for (const l of saved) process.stdin.on("keypress", l);
      resolve(a);
    });
  });
}

// The arrow-key session picker with search, rename (ctrl-r) and delete (ctrl-x).
// Returns a session id, "__new__", or "__cancel__".
async function sessionPickerLoop(cwd, currentId) {
  while (true) {
    const sessions = listSessions(cwd);
    const items = [{ __new: true }, ...sessions];
    let initial = 1 <= sessions.length ? 1 : 0;
    if (currentId) {
      const at = items.findIndex((it) => it.id === currentId);
      if (at >= 0) initial = at;
    }
    const res = await arrowSelect({
      items,
      initialIndex: initial,
      renderFrame: (its, i, c) => ui.sessionPickerFrame(its, i, c),
      clearOnExit: true,
      filterable: true,
      filterText: (it) => (it.__new ? "" : it.title), // hide "New chat" while searching
      onActionKey: (key) =>
        key.ctrl && key.name === "r" ? "rename" : key.ctrl && key.name === "x" ? "delete" : null,
    });
    if (res === undefined) return "__cancel__";
    if (res.__action === "rename") {
      if (res.item && !res.item.__new) {
        const t = (await ask("  new title: ")).trim();
        if (t) await renameSession(cwd, res.item.id, t);
      }
      continue;
    }
    if (res.__action === "delete") {
      if (res.item && !res.item.__new) {
        const a = (await ask(`  delete "${res.item.title}"? (y/N) `)).trim();
        if (/^y/i.test(a)) await deleteSession(cwd, res.item.id);
      }
      continue;
    }
    if (res.__new) return "__new__";
    return res.id;
  }
}

// Resolve which session to use, based on flags and whether a picker applies.
// Returns { id, dir, history } or null if the user cancelled the picker.
async function openSession(cwd, flags, { pickerOnOpen = false } = {}) {
  await migrateLegacy(cwd);
  await ensureGitignore(cwd);
  const sessions = listSessions(cwd);
  const load = async (id) => ({ id, dir: sessionDir(cwd, id), history: await readMessages(cwd, id) });
  const fresh = async () => {
    const s = await createSession(cwd, {});
    return { id: s.id, dir: s.dir, history: null };
  };
  if (flags.new) return await fresh();
  if (flags.cont) return sessions.length ? await load(sessions[0].id) : await fresh();
  if ((flags.resume || pickerOnOpen) && sessions.length) {
    if (interactiveTTY()) {
      const chosen = await sessionPickerLoop(cwd, null);
      if (chosen === "__cancel__") return null;
      if (chosen === "__new__") return await fresh();
      return await load(chosen);
    }
    return await load(sessions[0].id); // non-interactive: most recent
  }
  return await fresh();
}

function parse(argv) {
  const flags = { auto: false, cont: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto") flags.auto = true;
    else if (a === "--mcp") flags.mcp = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--auto-verify") flags.autoVerify = true;
    else if (a === "--continue") flags.cont = true;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--new") flags.new = true;
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--effort") {
      const v = String(argv[++i] || "").toLowerCase().trim();
      if (EFFORT_LEVELS.includes(v)) flags.effort = v;
      else if (["default", "off", "none", "unset", "model"].includes(v)) flags.effort = ""; // explicit unset
      // otherwise leave undefined (falls back to the saved/env default)
    }
    else if (a === "--verify") flags.verify = argv[++i];
    else if (a === "--max-steps") CONFIG.maxSteps = Number(argv[++i]) || CONFIG.maxSteps;
    else if (a === "--cwd") flags.cwd = argv[++i];
    else if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "-v" || a === "--version") flags.version = true;
    else positional.push(a);
  }
  return { flags, positional };
}

function resolveCwd(flags) {
  return flags.cwd ? path.resolve(process.cwd(), flags.cwd) : process.cwd();
}

function detectVerifyCmd(cwd) {
  const zogVerify = path.join(cwd, ".z0g", "verify");
  if (existsSync(zogVerify)) {
    try {
      const c = readFileSync(zogVerify, "utf8").trim();
      if (c) return c;
    } catch {}
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
    const test = pkg.scripts?.test;
    if (test && !/no test specified/i.test(test)) return "npm test";
  } catch {}
  return null;
}

function sh(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, so, se) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, out: `${so || ""}${se || ""}` });
    });
  });
}

async function cmdModels(flags = {}) {
  const client = makeClient();
  const models = await fetchModels(client);
  if (flags.json) {
    const out = models.map((m) => ({
      id: m.id, name: m.name, type: m.type, context_length: m.ctx, max_output: m.maxOut,
      price_in_per_1m: m.inPerM, price_out_per_1m: m.outPerM,
      tools: m.tools, vision: m.vision, verifiable: m.verifiable, private: m.private,
      tee: m.tee, discount_pct: m.discount,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(ui.renderModelsTable(models, { currentId: CONFIG.model }));
}

async function cmdDoctor() {
  const warnGlyph = ui.uiTTY ? "▲" : "!";
  const row = (state, label, value) => {
    const g =
      state === "ok" ? ui.ok(ui.GLYPH.ok) :
      state === "err" ? ui.err(ui.GLYPH.no) :
      state === "warn" ? ui.warn(warnGlyph) : ui.muted(ui.GLYPH.open);
    console.log("    " + g + "  " + ui.muted(String(label).padEnd(18)) + value);
  };
  const group = (t) => console.log("  " + ui.muted(t));

  console.log(ui.section("Doctor", "0G Compute"));
  const hasKey = !!CONFIG.apiKey;
  group("Auth");
  row(hasKey ? "ok" : "err", "ZOG_API_KEY", hasKey ? "set · value hidden" : ui.warn("missing"));
  if (!hasKey) {
    console.log("\n  " + ui.err(ui.GLYPH.no) + "  " + ui.strong("Not ready") + ui.muted(" · 1 issue"));
    console.log("  " + ui.muted("Fix: export ZOG_API_KEY=<key> (or add it to .env) · get one at https://pc.0g.ai"));
    return;
  }

  group("Router");
  row("ok", "Endpoint", ui.host(CONFIG.baseURL));
  let models = null;
  try {
    models = await fetchModels(makeClient());
    row("ok", "Reachable", "ok · " + models.length + " models");
  } catch (e) {
    row("err", "Reachable", ui.err("failed: " + e.message));
  }

  group("Model");
  const def = models ? models.find((m) => m.id === CONFIG.model) : null;
  let chip = "";
  if (def) {
    const t = ui.trustTier(def);
    const tee = def.private ? "TeeML" : def.verifiable ? "TeeTLS" : "";
    chip = "   " + t.role((t.glyph ? t.glyph + " " : "") + t.long) + (tee ? ui.muted(" (" + tee + ")") : "");
  }
  row("ok", "Default", CONFIG.model + chip);
  if (models) row(def ? "ok" : "warn", "On router", def ? "available" : ui.warn("not found (will fall back)"));
  row("open", "Fallbacks", ui.muted(CONFIG.fallbacks.join(", ")));

  group("Runtime");
  row("open", "Limits", ui.muted(CONFIG.maxSteps + " steps · " + CONFIG.maxTokens + " max tokens · temp " + CONFIG.temperature));
  row("open", "Effort", ui.muted(CONFIG.effort || "unset (model default)"));

  console.log("");
  if (models && def) {
    console.log("  " + ui.ok(ui.GLYPH.ok) + "  " + ui.strong("Ready.") + "   " + ui.accent(ui.GLYPH.seal) + ui.muted(" 0G Compute (TEE)"));
  } else {
    console.log("  " + ui.warn(warnGlyph) + "  " + ui.strong("Degraded") + ui.muted(models ? " · default model not on router" : " · router unreachable"));
  }
}

async function printAttest(dir) {
  const man = await loadProvenance(dir);
  if (!man || !Array.isArray(man.entries) || man.entries.length === 0) {
    console.log(ui.muted("No provenance yet. Run a task that edits files, then attest."));
    return;
  }
  const n = man.entries.length;
  console.log(ui.section("Provenance", n + (n === 1 ? " change" : " changes") + " on 0G"));
  const EMPTY = "e3b0c44298fc"; // sha256("") prefix: a new file
  for (const e of man.entries) {
    const g = e.response_id ? ui.ok(ui.GLYPH.ok) : ui.muted(ui.GLYPH.open);
    console.log("  " + g + " " + ui.strong(e.path));
    console.log("      " + ui.muted("model  ") + ui.accent(e.model));
    const before = String(e.sha256_before).slice(0, 12);
    const after = String(e.sha256_after).slice(0, 12);
    const from = before.startsWith(EMPTY) ? "(new file)" : before;
    console.log("      " + ui.muted("hash   ") + ui.muted(from) + " " + ui.accent(ui.GLYPH.chevron) + " " + ui.muted(after));
    console.log("      " + ui.muted("signed " + e.ts + " · " + (e.response_id || "no response id")));
  }
  console.log("");
  console.log("  " + ui.accent(ui.GLYPH.seal) + ui.muted(" Model id + response id captured from 0G Compute (TEE)."));
  console.log("  " + ui.muted("Full TEE-quote verification: roadmap."));
}

function printSkills(cwd) {
  const skills = discoverSkills(cwd);
  console.log(ui.section("Skills", skills.length + (skills.length === 1 ? " skill" : " skills")));
  if (!skills.length) {
    console.log("  " + ui.muted("No user skills yet. Add a markdown file with name/description frontmatter to:"));
    console.log("  " + ui.muted("  ~/.z0gcode/skills/<name>.md   (global)   or   .z0g/skills/<name>.md   (project)"));
    console.log("  " + ui.muted("Enabled skills are offered to the agent; load one with the read_skill tool."));
    return;
  }
  for (const s of skills) {
    const g = s.enabled ? ui.ok(ui.GLYPH.ok) : ui.muted(ui.GLYPH.open);
    const state = s.enabled ? "" : ui.muted(" (disabled)");
    console.log("  " + g + " " + ui.strong(s.name) + ui.muted("  · " + s.scope) + state);
    if (s.description) console.log("      " + ui.muted(s.description));
  }
  console.log("");
  console.log("  " + ui.muted("Toggle: /skills enable <name> · /skills disable <name>. The agent loads a skill with read_skill."));
}

function cmdSkills(cwd, arg) {
  const parts = String(arg || "").trim().split(/\s+/).filter(Boolean);
  const sub = parts[0];
  if (sub === "enable" || sub === "disable") {
    const name = parts.slice(1).join(" ");
    if (!name) { console.log(ui.warn("Usage: /skills " + sub + " <name>")); return; }
    if (!discoverSkills(cwd).some((s) => s.name === name)) { console.log(ui.warn("No skill named " + name)); return; }
    setSkillEnabled(cwd, name, sub === "enable");
    console.log("  " + ui.ok(ui.GLYPH.ok) + " skill " + ui.strong(name) + " " + (sub === "enable" ? "enabled" : "disabled"));
    return;
  }
  printSkills(cwd);
}

async function runVerify(cwd) {
  const cmd = detectVerifyCmd(cwd);
  if (!cmd) {
    console.log(ui.warn("No verify command found (add a package.json test script or a .z0g/verify file)."));
    return;
  }
  console.log(ui.muted("running: " + cmd));
  const r = await sh(cmd, cwd);
  const head = r.code === 0 ? ui.ok(ui.GLYPH.ok + " passed") : ui.err(ui.GLYPH.no + " failed (exit " + r.code + ")");
  console.log(head + "\n" + ui.muted(r.out.slice(0, 4000)));
}

async function runTask(task, flags) {
  const cwd = resolveCwd(flags);
  const opened = await openSession(cwd, flags);
  if (!opened) return; // picker cancelled
  const { id: sessionId, dir: sessionDirPath } = opened;
  const onSig = () => { pruneEmptySync(cwd, sessionId); process.exit(130); };
  process.once("SIGINT", onSig);
  try {
    // Auto-verify: a normal run becomes self-correcting when a verify command is present.
    const verifyCmd = flags.verify || (flags.autoVerify ? detectVerifyCmd(cwd) : null);
    if (verifyCmd) {
      await runGoal({ client: makeClient(), objective: task, cwd, sessionId, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, verifyCmd, maxIters: 3, history: opened.history });
      return;
    }
    const client = makeClient();
    const mcp = await loadMcp(cwd);
    if (mcp?.count) ui.info(`MCP: ${mcp.count} tool(s) from configured servers`);
    const res = await runAgent({ client, task, cwd, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, history: opened.history, mcp });
    if (res?.messages) await saveMessages(cwd, sessionId, res.messages);
    await mcp?.close();
  } finally {
    process.removeListener("SIGINT", onSig);
    pruneEmptySync(cwd, sessionId); // drop a session that produced no messages
  }
}

async function cmdGoal(objective, flags) {
  if (!objective) {
    console.log(ui.warn('Usage: z0g goal "<objective>" [--verify "<cmd>"] [--auto]'));
    return;
  }
  const client = makeClient();
  const cwd = resolveCwd(flags);
  const opened = await openSession(cwd, flags);
  if (!opened) return;
  const onSig = () => { pruneEmptySync(cwd, opened.id); process.exit(130); };
  process.once("SIGINT", onSig);
  try {
    const verifyCmd = flags.verify || detectVerifyCmd(cwd);
    if (!flags.auto) ui.info("tip: run goal with --auto so the agent can run and verify its own work.");
    await runGoal({ client, objective, cwd, sessionId: opened.id, sessionDir: opened.dir, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, verifyCmd, maxIters: 3, history: opened.history });
  } finally {
    process.removeListener("SIGINT", onSig);
    pruneEmptySync(cwd, opened.id);
  }
}

async function repl(flags) {
  const client = makeClient();
  const cwd = resolveCwd(flags);
  const opened = await openSession(cwd, flags, { pickerOnOpen: true });
  if (!opened) return; // cancelled the picker on open
  let sessionId = opened.id;
  let sessionDirPath = opened.dir;
  let history = opened.history;
  let model = flags.model;
  let effort = flags.effort;
  const mcp = await loadMcp(cwd);
  if (mcp?.count) ui.info(`MCP: ${mcp.count} tool(s) from configured servers`);

  // Delete a session that never persisted any messages (empty "New chat").
  const pruneIfEmpty = async (id) => {
    const s = listSessions(cwd).find((x) => x.id === id);
    if (s && s.messageCount === 0) {
      try { await deleteSession(cwd, id); } catch {}
    }
  };
  const sessTitle = (id) => listSessions(cwd).find((s) => s.id === id)?.title || "New chat";

  const promptStr = ui.strong("z0g") + ui.accent(" " + ui.GLYPH.chevron) + " ";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: promptStr, completer: slashCompleter });
  let pendingModels = null; // when set, the next line is a /model selection
  ui.info("Interactive session. Type a task, or / then Tab for commands.");
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) { pendingModels = null; rl.prompt(); continue; }

    // Resolve a pending /model pick (a slash command instead cancels it).
    if (pendingModels && !input.startsWith("/")) {
      const list = pendingModels;
      pendingModels = null;
      const n = Number.parseInt(input, 10);
      let chosen = null;
      if (!Number.isNaN(n) && n >= 1 && n <= list.length) chosen = list[n - 1];
      else if (list.includes(input)) chosen = input;
      if (chosen) { model = chosen; saveSetting("model", chosen); console.log(ui.pickConfirm(chosen)); }
      else ui.info("model unchanged");
      rl.prompt();
      continue;
    }
    if (pendingModels) pendingModels = null;

    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.slice(1).split(/\s+/);
      const arg = rest.join(" ");
      if (cmd === "exit" || cmd === "quit") break;
      else if (cmd === "help" || cmd === "") console.log(slashMenu());
      else if (cmd === "clear") {
        if (Array.isArray(history) && history.length) await saveMessages(cwd, sessionId, history);
        await pruneIfEmpty(sessionId);
        const s = await createSession(cwd, {});
        sessionId = s.id; sessionDirPath = s.dir; history = null;
        ui.info("context cleared");
      }
      else if (cmd === "model") {
        if (arg) { model = arg; saveSetting("model", arg); console.log(ui.pickConfirm(arg)); }
        else {
          const cur = model || CONFIG.model;
          const models = await chatModelsFor(client, cur);
          if (models && models.length) {
            if (interactiveTTY()) {
              rl.pause();
              const chosen = await arrowSelect({
                items: models,
                initialIndex: Math.max(0, models.findIndex((m) => m.id === cur)),
                renderFrame: (its, i) => ui.modelPickerFrame(its, i, cur),
                clearOnExit: true,
              });
              rl.resume();
              if (chosen) { model = chosen.id; saveSetting("model", chosen.id); console.log(ui.pickConfirm(chosen.id)); }
              else ui.info("model unchanged");
            } else {
              console.log(ui.renderModelsPickList(models, cur));
              pendingModels = models.map((m) => m.id);
            }
          }
        }
      }
      else if (cmd === "effort") {
        const a = arg.toLowerCase().trim();
        if (!a) {
          const cur = effort === "" ? null : (effort || CONFIG.effort);
          ui.info("effort: " + (cur || "model default") + "  ·  valid: " + EFFORT_LEVELS.join(", ") + ", default");
        } else if (EFFORT_LEVELS.includes(a)) {
          effort = a; saveSetting("effort", a); ui.info("effort set to " + a + " (saved)");
        } else if (["default", "off", "none", "unset", "model"].includes(a)) {
          effort = ""; saveSetting("effort", undefined); ui.info("effort: model default (saved)");
        } else {
          console.log(ui.warn("invalid effort. valid: " + EFFORT_LEVELS.join(", ") + ", default"));
        }
      }
      else if (cmd === "skills") cmdSkills(cwd, arg);
      else if (cmd === "chats") {
        if (Array.isArray(history) && history.length) await saveMessages(cwd, sessionId, history);
        if (interactiveTTY()) {
          rl.pause();
          const chosen = await sessionPickerLoop(cwd, sessionId);
          rl.resume();
          if (chosen && chosen !== "__cancel__") {
            if (chosen !== sessionId) await pruneIfEmpty(sessionId); // never prune the one we keep
            if (chosen === "__new__") {
              const s = await createSession(cwd, {});
              sessionId = s.id; sessionDirPath = s.dir; history = null;
              ui.info("new chat");
            } else {
              sessionId = chosen; sessionDirPath = sessionDir(cwd, chosen);
              history = await readMessages(cwd, chosen);
              ui.info("switched to: " + sessTitle(sessionId));
            }
          } else if (!listSessions(cwd).some((s) => s.id === sessionId)) {
            // Active session was deleted inside the picker, then cancelled: re-point.
            const rid = mostRecent(cwd);
            if (rid) {
              sessionId = rid; sessionDirPath = sessionDir(cwd, rid);
              history = await readMessages(cwd, rid);
              ui.info("switched to: " + sessTitle(sessionId));
            } else {
              const s = await createSession(cwd, {});
              sessionId = s.id; sessionDirPath = s.dir; history = null;
              ui.info("new chat");
            }
          }
        } else ui.info("switching sessions needs an interactive terminal");
      }
      else if (cmd === "new") {
        if (Array.isArray(history) && history.length) await saveMessages(cwd, sessionId, history);
        await pruneIfEmpty(sessionId);
        const s = await createSession(cwd, { title: arg || "" });
        sessionId = s.id; sessionDirPath = s.dir; history = null;
        ui.info("new chat" + (arg ? ": " + arg : ""));
      }
      else if (cmd === "rename") {
        if (arg) { await renameSession(cwd, sessionId, arg); ui.info("renamed to: " + arg); }
        else ui.info("usage: /rename <title>");
      }
      else if (cmd === "attest") await printAttest(sessionDirPath);
      else if (cmd === "plan") { const p = await loadPlan(sessionDirPath); if (p) ui.renderPlan(p); else ui.info("no plan yet"); }
      else if (cmd === "verify") await runVerify(cwd);
      else if (cmd === "goal") {
        await runGoal({ client, objective: arg, cwd, sessionId, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: model, preferredEffort: effort, verifyCmd: flags.verify || detectVerifyCmd(cwd), maxIters: 3, history });
        history = await readMessages(cwd, sessionId) || history;
      } else ui.info("unknown command; /help for the list");
      rl.prompt();
      continue;
    }

    const res = await runAgent({ client, task: input, cwd, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: model, preferredEffort: effort, history, mcp });
    history = res.messages;
    await saveMessages(cwd, sessionId, history);
    rl.prompt();
  }
  rl.close();
  await pruneIfEmpty(sessionId);
  await mcp?.close();
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.help) { console.log(helpText()); return; }
  if (flags.version) { console.log("z0gcode 0.2.0"); return; }

  const sub = positional[0];
  try {
    if (sub === "models") return await cmdModels(flags);
    if (sub === "skills") return cmdSkills(resolveCwd(flags), positional.slice(1).join(" "));
    if (sub === "doctor") return await cmdDoctor();
    if (sub === "attest") {
      const acwd = resolveCwd(flags);
      await migrateLegacy(acwd);
      const id = mostRecent(acwd);
      return await printAttest(id ? sessionDir(acwd, id) : path.join(acwd, ".z0g"));
    }
    if (sub === "serve") {
      if (flags.mcp) {
        const { startMcpServer } = await import("../src/mcp-server.mjs");
        await startMcpServer({ cwd: resolveCwd(flags), allowBash: flags.auto });
        return; // stays alive serving the stdio MCP transport
      }
      console.log("Usage: z0g serve --mcp");
      return;
    }
    if (sub === "goal") {
      ui.banner(flags.model || CONFIG.model, CONFIG.baseURL);
      return await cmdGoal(positional.slice(1).join(" "), flags);
    }

    const task = sub === "run" ? positional.slice(1).join(" ") : positional.join(" ");
    if (!task) {
      if (process.stdin.isTTY) {
        await ui.bannerAnimated(flags.model || CONFIG.model, CONFIG.baseURL);
        return await repl(flags);
      }
      ui.banner(flags.model || CONFIG.model, CONFIG.baseURL);
      console.log(helpText());
      return;
    }
    ui.banner(flags.model || CONFIG.model, CONFIG.baseURL);
    await runTask(task, flags);
  } catch (e) {
    ui.error(e.message);
    process.exitCode = 1;
  }
}

main();
