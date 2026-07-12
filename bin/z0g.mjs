#!/usr/bin/env node
// z0gcode CLI: a coding agent whose brain runs on 0G Compute.
import "../src/env.mjs"; // load .env before config reads process.env
import readline from "node:readline";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";
import { CONFIG } from "../src/config.mjs";
import { makeClient } from "../src/client.mjs";
import { runAgent } from "../src/agent.mjs";
import { runGoal } from "../src/goal.mjs";
import { loadProvenance } from "../src/provenance.mjs";
import { saveSession, loadSession } from "../src/session.mjs";
import { loadPlan } from "../src/plan.mjs";
import { loadMcp } from "../src/mcp.mjs";
import { saveSetting } from "../src/settings.mjs";
import * as ui from "../src/ui.mjs";

const HELP = `${ui.color.magenta("z0gcode")} — a coding agent whose brain runs on 0G Compute.

Usage:
  z0g "<task>"           Run a coding task (one-shot)
  z0g                    Interactive session (REPL, /help for commands)
  z0g goal "<objective>" Run until a verify command passes (iterate-until-done)
  z0g models             List the 0G models available on the Router
  z0g doctor             Check your 0G setup (key, connectivity, model)
  z0g attest             Show the provenance manifest (which 0G model wrote which change)
  z0g serve --mcp        Run as an MCP server exposing z0gcode's 0G tools

Options:
  --auto                 Allow shell commands and on-chain actions (run_bash, upload_0g_storage)
  --continue             Continue the saved session in this directory
  --model <id>           Override the model (default ${CONFIG.model})
  --verify "<cmd>"       Run the task, then verify and self-correct with this command
  --auto-verify          Same, auto-detecting the verify command (npm test / .z0g/verify)
  --max-steps <n>        Max agent steps (default ${CONFIG.maxSteps})
  --cwd <dir>            Working directory (default: current)
  -h, --help             Show this help
  -v, --version          Show version

Setup:
  export ZOG_API_KEY=<your 0G Router key from https://pc.0g.ai>

0G is the default backend: no OpenAI or Anthropic key, no config file.`;

const SLASH_COMMANDS = [
  ["/help", "Show commands"],
  ["/clear", "Reset the conversation context"],
  ["/model", "Pick the active 0G model (saved to settings)"],
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
  const list = rows.map(([c, d]) => `  ${ui.color.magenta(c.padEnd(9))}  ${ui.color.dim(d)}`).join("\n");
  return ui.color.bold("Commands:") + "\n" + list;
}

// Tab-completion for slash commands: "/" + Tab lists all, "/mo" + Tab -> "/model".
function slashCompleter(line) {
  if (!line.startsWith("/")) return [[], line];
  const names = SLASH_COMMANDS.map(([c]) => c);
  const hits = names.filter((c) => c.startsWith(line));
  return [hits.length ? hits : names, line];
}

// Print the numbered model list and return the ids, for interactive /model.
async function pickModels(client, current) {
  let rows = [];
  try {
    const res = await client.models.list();
    rows = (res.data || []).filter((m) => (m.supported_parameters || []).includes("tools"));
    if (!rows.length) rows = res.data || [];
  } catch (e) {
    ui.error("could not list models: " + e.message);
    return null;
  }
  if (!rows.length) return null;
  console.log(ui.color.bold("Select a 0G model:"));
  rows.forEach((m, i) => {
    const cur = m.id === current ? ui.color.green(" ← current") : "";
    const num = ui.color.magenta(String(i + 1).padStart(2));
    console.log(`  ${num}. ${m.id.padEnd(20)} ${ui.color.dim("ctx=" + (m.context_length ?? "?"))}${cur}`);
  });
  ui.info("Type a number to choose (or a model id). Anything else cancels.");
  return rows.map((m) => m.id);
}

function parse(argv) {
  const flags = { auto: false, cont: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto") flags.auto = true;
    else if (a === "--mcp") flags.mcp = true;
    else if (a === "--auto-verify") flags.autoVerify = true;
    else if (a === "--continue") flags.cont = true;
    else if (a === "--model") flags.model = argv[++i];
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

async function cmdModels() {
  const client = makeClient();
  const res = await client.models.list();
  const rows = (res.data || []).filter((m) => (m.supported_parameters || []).includes("tools") || m.type === "chatbot");
  console.log(ui.color.bold(`0G Router models (${rows.length}):`));
  for (const m of rows) {
    const tools = (m.supported_parameters || []).includes("tools") ? ui.color.green("tools") : ui.color.dim("—    ");
    console.log(`  ${m.id.padEnd(20)} ${tools}  ${ui.color.dim("ctx=" + (m.context_length ?? "?"))}`);
  }
}

async function cmdDoctor() {
  console.log(ui.color.bold("z0gcode doctor"));
  const hasKey = !!CONFIG.apiKey;
  console.log(`  ZOG_API_KEY   ${hasKey ? ui.color.green("set") : ui.color.red("missing")}`);
  console.log(`  Router        ${CONFIG.baseURL}`);
  console.log(`  Model         ${CONFIG.model}  ${ui.color.dim("(fallbacks: " + CONFIG.fallbacks.join(", ") + ")")}`);
  if (!hasKey) {
    console.log(ui.color.yellow("\n  Set ZOG_API_KEY (https://pc.0g.ai) to enable inference."));
    return;
  }
  try {
    const client = makeClient();
    const res = await client.models.list();
    const ids = (res.data || []).map((m) => m.id);
    const present = ids.includes(CONFIG.model);
    console.log(`  Connectivity  ${ui.color.green("ok")} (${ids.length} models)`);
    console.log(`  Default model ${present ? ui.color.green("available") : ui.color.yellow("not found (will fall back)")}`);
  } catch (e) {
    console.log(`  Connectivity  ${ui.color.red("failed")}: ${e.message}`);
  }
}

async function printAttest(cwd) {
  const man = await loadProvenance(cwd);
  if (!man || !Array.isArray(man.entries) || man.entries.length === 0) {
    console.log(ui.color.dim("No provenance recorded yet. Run a task that edits files, then attest."));
    return;
  }
  console.log(ui.color.bold(`z0gcode provenance — ${man.entries.length} change(s):`));
  for (const e of man.entries) {
    console.log(`  ${e.path}`);
    console.log(ui.color.dim(`    ${String(e.sha256_before).slice(0, 12)} → ${String(e.sha256_after).slice(0, 12)}  ·  ${e.model}  ·  ${e.ts}`));
  }
  console.log(ui.color.dim("\n  Model id and response id are captured from 0G Compute (TEE). Full TEE-quote verification is roadmap."));
}

async function runVerify(cwd) {
  const cmd = detectVerifyCmd(cwd);
  if (!cmd) {
    console.log(ui.color.yellow("No verify command found (add a package.json test script or a .z0g/verify file)."));
    return;
  }
  console.log(ui.color.dim(`running: ${cmd}`));
  const r = await sh(cmd, cwd);
  console.log((r.code === 0 ? ui.color.green("passed") : ui.color.red(`failed (exit ${r.code})`)) + "\n" + r.out.slice(0, 4000));
}

async function runTask(task, flags) {
  const cwd = resolveCwd(flags);
  // Auto-verify: a normal run becomes self-correcting when a verify command is present.
  const verifyCmd = flags.verify || (flags.autoVerify ? detectVerifyCmd(cwd) : null);
  if (verifyCmd) {
    await runGoal({ client: makeClient(), objective: task, cwd, allowBash: flags.auto, preferredModel: flags.model, verifyCmd, maxIters: 3 });
    return;
  }
  const client = makeClient();
  const history = flags.cont ? await loadSession(cwd) : null;
  const mcp = await loadMcp(cwd);
  if (mcp?.count) ui.info(`MCP: ${mcp.count} tool(s) from configured servers`);
  const res = await runAgent({ client, task, cwd, allowBash: flags.auto, preferredModel: flags.model, history, mcp });
  if (res?.messages) await saveSession(cwd, res.messages);
  await mcp?.close();
}

async function cmdGoal(objective, flags) {
  if (!objective) {
    console.log(ui.color.yellow('Usage: z0g goal "<objective>" [--verify "<cmd>"] [--auto]'));
    return;
  }
  const client = makeClient();
  const cwd = resolveCwd(flags);
  const verifyCmd = flags.verify || detectVerifyCmd(cwd);
  if (!flags.auto) ui.info("tip: run goal with --auto so the agent can run and verify its own work.");
  await runGoal({ client, objective, cwd, allowBash: flags.auto, preferredModel: flags.model, verifyCmd, maxIters: 3 });
}

async function repl(flags) {
  const client = makeClient();
  const cwd = resolveCwd(flags);
  let history = flags.cont ? await loadSession(cwd) : null;
  let model = flags.model;
  const mcp = await loadMcp(cwd);
  if (mcp?.count) ui.info(`MCP: ${mcp.count} tool(s) from configured servers`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: ui.color.magenta("z0g › "), completer: slashCompleter });
  let pendingModels = null; // when set, the next line is a /model selection
  ui.info("Interactive session. Type a task, or / then Tab for commands.");
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }

    // Resolve a pending /model pick (a slash command instead cancels it).
    if (pendingModels && !input.startsWith("/")) {
      const list = pendingModels;
      pendingModels = null;
      const n = Number.parseInt(input, 10);
      let chosen = null;
      if (!Number.isNaN(n) && n >= 1 && n <= list.length) chosen = list[n - 1];
      else if (list.includes(input)) chosen = input;
      if (chosen) { model = chosen; saveSetting("model", chosen); ui.info(`model → ${chosen} (saved)`); }
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
      else if (cmd === "clear") { history = null; ui.info("context cleared"); }
      else if (cmd === "model") {
        if (arg) { model = arg; saveSetting("model", arg); ui.info(`model → ${arg} (saved)`); }
        else pendingModels = await pickModels(client, model || CONFIG.model);
      }
      else if (cmd === "attest") await printAttest(cwd);
      else if (cmd === "plan") { const p = await loadPlan(cwd); if (p) ui.renderPlan(p); else ui.info("no plan yet"); }
      else if (cmd === "verify") await runVerify(cwd);
      else if (cmd === "goal") {
        await runGoal({ client, objective: arg, cwd, allowBash: flags.auto, preferredModel: model, verifyCmd: flags.verify || detectVerifyCmd(cwd), maxIters: 3 });
        history = await loadSession(cwd) || history;
      } else ui.info("unknown command; /help for the list");
      rl.prompt();
      continue;
    }

    const res = await runAgent({ client, task: input, cwd, allowBash: flags.auto, preferredModel: model, history, mcp });
    history = res.messages;
    await saveSession(cwd, history);
    rl.prompt();
  }
  rl.close();
  await mcp?.close();
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.help) { console.log(HELP); return; }
  if (flags.version) { console.log("z0gcode 0.2.0"); return; }

  const sub = positional[0];
  try {
    if (sub === "models") return await cmdModels();
    if (sub === "doctor") return await cmdDoctor();
    if (sub === "attest") return await printAttest(resolveCwd(flags));
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
      ui.banner(flags.model || CONFIG.model, CONFIG.baseURL);
      if (process.stdin.isTTY) return await repl(flags);
      console.log(HELP);
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
