#!/usr/bin/env node
// z0gcode CLI: a coding agent whose brain runs on 0G Compute.
import "../src/env.mjs"; // load .env before config reads process.env
import readline from "node:readline";
import path from "node:path";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { exec } from "node:child_process";
import { CONFIG, normEffort, EFFORT_LEVELS, boolOf, modelChain } from "../src/config.mjs";
import { makeClient, complete } from "../src/client.mjs";
import { runAgent } from "../src/agent.mjs";
import { INIT_TASK } from "../src/context.mjs";
import { undoLastTurn, readCheckpointLog, activeTurns } from "../src/checkpoints.mjs";
import { loadCustomCommands, expandTemplate, loadHooks, runHooks, hasHooks } from "../src/commands.mjs";
import { runGoal } from "../src/goal.mjs";
import { loadProvenance } from "../src/provenance.mjs";
import {
  sessionDir, listSessions, mostRecent, createSession,
  readMessages, saveMessages, renameSession, deleteSession, migrateLegacy, ensureGitignore, pruneEmptySync,
} from "../src/sessions.mjs";
import { loadPlan } from "../src/plan.mjs";
import { loadMcp } from "../src/mcp.mjs";
import { saveSetting, loadSettings } from "../src/settings.mjs";
import { fetchModels, orderChatModels } from "../src/models-info.mjs";
import { discoverSkills, setSkillEnabled } from "../src/user-skills.mjs";
import { generateImage, transcribeAudio } from "../src/media.mjs";
import { uploadFileToStorage, anchorOnChain, downloadAndVerify } from "../src/anchor.mjs";
import { encryptEnvelope, decryptEnvelope } from "../src/crypto.mjs";
import { arrowSelect } from "../src/prompt.mjs";
import * as ui from "../src/ui.mjs";

function helpText() {
  const groups = [
    ["Run", [
      ['z0g "<task>"', "Run a coding task (one-shot)"],
      ["z0g", "Interactive session (REPL, /help for commands)"],
      ['z0g goal "<obj>"', "Iterate until a verify command passes"],
      ["z0g init", "Analyze the project and write an AGENTS.md context file"],
    ]],
    ["Inspect", [
      ["z0g models", "List the 0G models on the Router (add --json)"],
      ["z0g skills", "List user/project skills (enable|disable <name>)"],
      ["z0g doctor", "Check your 0G setup (key, connectivity, model)"],
      ["z0g attest", "Show which 0G model wrote which change"],
      ["z0g undo", "Revert the file edits from the last turn"],
      ["z0g share", "Export a session to 0G Storage, encrypted (--anchor for 0G Chain)"],
      ["z0g pull <root>", "Fetch, verify, and decrypt a shared session (--import)"],
      ["z0g mint", "Mint a session as an NFT on 0G Chain (ERC-7857-inspired)"],
    ]],
    ["Media", [
      ['z0g image "<prompt>"', "Generate an image on 0G (z-image-turbo), saved as PNG"],
      ["z0g transcribe <file>", "Transcribe audio on 0G (whisper-large-v3)"],
    ]],
    ["Serve", [
      ["z0g serve --mcp", "Expose z0gcode's 0G tools as an MCP server"],
    ]],
    ["Options", [
      ["--auto", "Start in auto mode (run commands without asking; else /mode ask prompts)"],
      ["--onchain", "Allow gas-spending on-chain actions (off by default)"],
      ["--continue", "Continue the saved session in this directory"],
      ["--model <id>", "Override the model (default " + CONFIG.model + ")"],
      ["--effort <l>", "Reasoning effort: low, medium, high (default: model's own)"],
      ["--no-subagents", "Disable parallel subagents for this run"],
      ["--no-escalate", "Do not switch to a stronger model on repeated tool failures"],
      ['--verify "<cmd>"', "Run, then verify and self-correct with this command"],
      ["--auto-verify", "Same, auto-detecting the verify command"],
      ["--max-steps <n>", "Max agent steps (default " + CONFIG.maxSteps + ")"],
      ["--cwd <dir>", "Working directory (default: current)"],
      ["--json", "Headless: emit the run result (files, provenance, usage) as JSON"],
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
  ["/compact", "Summarize the conversation to shrink context and cost"],
  ["/chats", "Switch chat (arrow-key picker, search, rename, delete)"],
  ["/new", "Start a new chat (/new [title])"],
  ["/rename", "Rename the current chat (/rename <title>)"],
  ["/init", "Analyze the project and write an AGENTS.md context file"],
  ["/model", "Pick the active 0G model (saved to settings)"],
  ["/mode", "Permission mode: ask (approve each) | auto (run all) | plan (read-only)"],
  ["/effort", "Set reasoning effort (low|medium|high|default)"],
  ["/subagents", "Enable or disable parallel subagents (on|off)"],
  ["/onchain", "Enable or disable gas-spending on-chain actions (on|off)"],
  ["/escalate", "Toggle switching to a stronger model on repeated failures (on|off)"],
  ["/skills", "List skills; /skills enable|disable <name>"],
  ["/commands", "List project custom commands (.z0g/commands/*.md)"],
  ["/attest", "Show the provenance manifest"],
  ["/undo", "Revert the file edits from the last turn"],
  ["/checkpoints", "List the turns you can undo"],
  ["/share", "Export this session to 0G Storage (/share anchor to anchor on-chain)"],
  ["/pull", "Fetch + verify + decrypt a shared session (/pull <root> [import])"],
  ["/mint", "Mint this session as an NFT on 0G Chain (records its Storage root)"],
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

// Project-local custom command names (e.g. /review), set by repl() at startup.
let extraSlash = [];
// Tab-completion for slash commands: "/" + Tab lists all, "/mo" + Tab -> "/model".
function slashCompleter(line) {
  if (!line.startsWith("/")) return [[], line];
  const names = [...SLASH_COMMANDS.map(([c]) => c), ...extraSlash];
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
    else if (a === "--num") flags.num = Number(argv[++i]);
    else if (a === "--anchor") flags.anchor = true;
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
    else if (a === "--subagents") flags.subagents = boolOf(argv[++i]);
    else if (a === "--no-subagents") flags.subagents = false;
    else if (a === "--onchain") flags.onchain = true;
    else if (a === "--no-onchain") flags.onchain = false;
    else if (a === "--no-escalate") flags.escalate = false;
    else if (a === "--force") flags.force = true;
    else if (a === "--import") flags.import = true;
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

async function cmdImage(prompt, out, flags) {
  if (!prompt) { console.log(ui.warn('Usage: z0g image "<prompt>" [out.png] [--num 2]')); return; }
  const cwd = resolveCwd(flags);
  const n = Math.max(1, Math.min(2, Number(flags.num) || 1));
  const base = path.resolve(cwd, out || "image.png").replace(/\.png$/i, "");
  ui.info(`generating ${n} image(s) on 0G (${CONFIG.imageModel})`);
  const { images, cost } = await generateImage(makeClient(), { prompt, n });
  const written = [];
  for (let i = 0; i < images.length; i++) {
    const p = images.length > 1 ? `${base}-${i + 1}.png` : `${base}.png`;
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(images[i], "base64"));
    written.push(path.relative(cwd, p) || p);
  }
  const costStr = cost != null ? " · ~$" + cost.toFixed(4) : "";
  console.log("  " + ui.ok(ui.GLYPH.ok) + " wrote " + ui.strong(written.join(", ")) + ui.muted("  · " + CONFIG.imageModel + costStr + " · ") + ui.accent(ui.GLYPH.seal) + ui.muted(" 0G Compute (TEE)"));
}

async function cmdTranscribe(file, flags) {
  if (!file) { console.log(ui.warn("Usage: z0g transcribe <audio-file>")); return; }
  const cwd = resolveCwd(flags);
  const abs = path.resolve(cwd, file);
  if (!existsSync(abs)) { console.log(ui.warn("File not found: " + file)); return; }
  ui.info(`transcribing on 0G (${CONFIG.transcribeModel})`);
  const { text, duration, cost } = await transcribeAudio(makeClient(), abs);
  console.log("\n" + (text || ui.muted("(empty transcript)")) + "\n");
  const meta = [CONFIG.transcribeModel];
  if (duration) meta.push(duration.toFixed(1) + "s");
  if (cost != null) meta.push("~$" + cost.toFixed(4));
  console.log(ui.muted("  · " + meta.join(" · ") + " · ") + ui.accent(ui.GLYPH.seal) + ui.muted(" 0G Compute (TEE)"));
}

// Generate an AGENTS.md by letting the agent analyze the project. The file is
// then auto-loaded into the agent's context on subsequent runs.
async function cmdInit(flags) {
  const cwd = resolveCwd(flags);
  const target = path.join(cwd, "AGENTS.md");
  if (existsSync(target) && !flags.force) {
    console.log(ui.warn("AGENTS.md already exists. Re-run `z0g init --force` to regenerate it."));
    return;
  }
  console.log(ui.section("Init", "analyzing the project to write AGENTS.md"));
  const res = await runAgent({
    client: makeClient(), task: INIT_TASK, cwd,
    sessionDir: path.join(cwd, ".z0g"), allowBash: false,
    preferredModel: flags.model, preferredEffort: flags.effort,
    preferredSubagents: false, preferredOnchain: false,
  });
  if (existsSync(target)) {
    const lines = readFileSync(target, "utf8").split("\n").length;
    console.log("\n  " + ui.ok(ui.GLYPH.ok) + " " + ui.strong("AGENTS.md") + ui.muted(" written (" + lines + " lines). It is auto-loaded into the agent's context from now on."));
  } else {
    console.log(ui.warn("The agent did not create AGENTS.md. " + (res?.finalText ? "It said: " + res.finalText.slice(0, 200) : "Try again or write it by hand.")));
  }
}

// Revert the most recent turn's file edits (restore before-content, delete
// files the turn created), using the session's checkpoint log.
async function cmdUndo(flags, sessionId) {
  const cwd = resolveCwd(flags);
  await migrateLegacy(cwd);
  const id = sessionId || mostRecent(cwd);
  if (!id) { console.log(ui.warn("No session yet, nothing to undo.")); return; }
  const rep = await undoLastTurn(cwd, sessionDir(cwd, id));
  if (!rep) { console.log(ui.warn("Nothing to undo in this chat.")); return; }
  console.log(ui.section("Undo", rep.task || rep.runId));
  for (const f of rep.files) {
    const g = f.action === "failed" ? ui.err(ui.GLYPH.no) : ui.ok(ui.GLYPH.ok);
    const note = f.diverged ? ui.warn(" (had changed since; overwritten)") : "";
    console.log("  " + g + " " + f.action + " " + ui.strong(f.path) + (f.error ? ui.err(" " + f.error) : note));
  }
  console.log("\n  " + ui.muted("Reverted the last turn. Run undo again to step further back."));
}

// List the turns still available to undo (newest first).
async function cmdCheckpoints(flags, sessionId) {
  const cwd = resolveCwd(flags);
  await migrateLegacy(cwd);
  const id = sessionId || mostRecent(cwd);
  if (!id) { console.log(ui.warn("No session yet.")); return; }
  const turns = activeTurns(await readCheckpointLog(sessionDir(cwd, id)));
  if (!turns.length) { ui.info("no checkpoints yet (the agent has not edited files in this chat)"); return; }
  console.log(ui.section("Checkpoints", turns.length + " turn(s) you can undo"));
  turns.slice(-12).reverse().forEach((t, i) => {
    const files = [...new Set(t.edits.map((e) => e.path))];
    const tag = i === 0 ? ui.accent("next undo") : ui.muted(ui.relTime(t.ts));
    console.log("  " + ui.strong(files.length + " file" + (files.length === 1 ? "" : "s")) + "  " + ui.muted(files.join(", ")) + "  " + tag);
    if (t.task) console.log("    " + ui.muted(t.task));
  });
}

// Build the shareable session bundle (title + transcript + provenance) and
// write it to share-bundle.json. Returns { bundlePath, title }.
function buildSessionBundle(cwd, id) {
  const dir = sessionDir(cwd, id);
  let sess = {};
  try { sess = JSON.parse(readFileSync(path.join(dir, "session.json"), "utf8")); } catch {}
  let provenance = null;
  try { provenance = JSON.parse(readFileSync(path.join(dir, "provenance.json"), "utf8")); } catch {}
  const bundle = {
    tool: "z0gcode",
    ts: new Date().toISOString(),
    session: { id: sess.id || id, title: sess.title || "", created: sess.created, messages: sess.messages || [] },
    provenance,
  };
  const bundlePath = path.join(dir, "share-bundle.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  return { bundlePath, title: bundle.session.title || id, ts: bundle.ts };
}

// Build the bundle and encrypt it for the wallet, returning the path to upload.
// 0G Storage is public, so we only ever upload ciphertext.
function encryptedBundlePath(cwd, id) {
  const { bundlePath, title, ts } = buildSessionBundle(cwd, id);
  const enc = encryptEnvelope(readFileSync(bundlePath), process.env.ZOG_WALLET_KEY);
  const encPath = path.join(sessionDir(cwd, id), "share-bundle.enc");
  writeFileSync(encPath, enc);
  return { encPath, title, ts };
}

// Ensure the session has a 0G Storage root: reuse share.json or upload the
// bundle. Returns { root, storageTx, cached }.
async function ensureSessionRoot(cwd, id) {
  const dir = sessionDir(cwd, id);
  try {
    const rec = JSON.parse(readFileSync(path.join(dir, "share.json"), "utf8"));
    if (rec.root) return { root: rec.root, storageTx: rec.storageTx, cached: true };
  } catch { /* not shared yet */ }
  const { encPath, ts } = encryptedBundlePath(cwd, id);
  const { rootHash, txHash } = await uploadFileToStorage(encPath);
  writeFileSync(path.join(dir, "share.json"), JSON.stringify({ id, root: rootHash, storageTx: txHash, encrypted: true, ts }, null, 2));
  return { root: rootHash, storageTx: txHash, cached: false };
}

// Export a session (transcript + provenance) to 0G Storage, optionally anchoring
// the content hash on 0G Chain, for a verifiable, shareable snapshot.
async function cmdShare(flags, sessionId) {
  const cwd = resolveCwd(flags);
  await migrateLegacy(cwd);
  const id = sessionId || mostRecent(cwd);
  if (!id) { console.log(ui.warn("No session to share. Run a task first.")); return; }
  const onchainOn = flags.onchain !== undefined ? flags.onchain : CONFIG.onchain;
  if (!onchainOn) { console.log(ui.warn("On-chain is off. Enable it with --onchain, /onchain on, or ZOG_ONCHAIN=on.")); return; }
  if (!process.env.ZOG_WALLET_KEY) { console.log(ui.warn("Set ZOG_WALLET_KEY (a funded 0G mainnet key) to share on 0G.")); return; }
  const dir = sessionDir(cwd, id);
  const { encPath, title, ts } = encryptedBundlePath(cwd, id);

  console.log(ui.section("Share session", title));
  ui.info("encrypting for your wallet and uploading to 0G Storage...");
  let root, storageTx;
  try {
    ({ rootHash: root, txHash: storageTx } = await uploadFileToStorage(encPath));
  } catch (e) { console.log(ui.err("  upload failed: " + e.message)); return; }
  console.log("  " + ui.ok(ui.GLYPH.ok) + " 0G Storage root " + ui.strong(root) + ui.muted(" (encrypted)"));
  console.log("  " + ui.muted("    tx " + storageTx + "  ·  https://chainscan.0g.ai/tx/" + storageTx));
  const record = { id, root, storageTx, encrypted: true, ts };
  if (flags.anchor) {
    ui.info("anchoring the hash on 0G Chain...");
    try {
      const a = await anchorOnChain(root);
      record.anchorTx = a.txHash; record.block = a.block;
      console.log("  " + ui.ok(ui.GLYPH.ok) + " anchored on 0G Chain " + ui.strong(a.txHash));
      console.log("  " + ui.muted("    block " + a.block + "  ·  https://chainscan.0g.ai/tx/" + a.txHash));
    } catch (e) { console.log(ui.err("  anchor failed: " + e.message)); }
  }
  writeFileSync(path.join(dir, "share.json"), JSON.stringify(record, null, 2));
  console.log("\n  " + ui.accent(ui.GLYPH.seal) + ui.muted(" Verifiable session snapshot on 0G. Saved to .z0g/sessions/" + id + "/share.json"));
}

// Pull a shared session back: download by its 0G Storage root, verify the root,
// and decrypt with the wallet. Read-only (no gas); proves the round-trip and that
// only the owner's wallet can read the content.
async function cmdPull(flags, root) {
  if (!root || !/^0x[0-9a-fA-F]{6,}$/.test(root)) { console.log(ui.warn("Usage: z0g pull <0G Storage content root> [--import]")); return; }
  const cwd = resolveCwd(flags);
  await migrateLegacy(cwd);
  if (!process.env.ZOG_WALLET_KEY) { console.log(ui.warn("Set ZOG_WALLET_KEY (the wallet you shared with) to decrypt the session.")); return; }
  console.log(ui.section("Pull session", root.slice(0, 18) + "…"));
  const tmpDir = path.join(cwd, ".z0g", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, "pull-" + root.slice(2, 14) + ".enc");
  try { rmSync(tmp, { force: true }); } catch {}
  ui.info("downloading from 0G Storage and verifying the content root...");
  try {
    await downloadAndVerify(root, tmp);
  } catch (e) { console.log(ui.err("  download/verify failed: " + e.message)); return; }
  console.log("  " + ui.ok(ui.GLYPH.ok) + " content root verified against 0G Storage");
  let plain;
  try {
    plain = decryptEnvelope(readFileSync(tmp), process.env.ZOG_WALLET_KEY);
  } catch (e) {
    console.log("  " + ui.err(ui.GLYPH.no) + " " + e.message);
    console.log("  " + ui.muted("The bytes are authentic, but only the owner's wallet can read them."));
    try { rmSync(tmp, { force: true }); } catch {}
    return;
  }
  console.log("  " + ui.ok(ui.GLYPH.ok) + " decrypted with your wallet");
  let bundle;
  try { bundle = JSON.parse(plain.toString("utf8")); } catch { console.log(ui.warn("  decrypted, but the bundle is not valid JSON")); try { rmSync(tmp, { force: true }); } catch {} return; }
  const s = bundle.session || {};
  const msgs = Array.isArray(s.messages) ? s.messages.length : 0;
  const prov = (bundle.provenance && Array.isArray(bundle.provenance.entries)) ? bundle.provenance.entries.length : 0;
  console.log("\n  " + ui.strong(s.title || s.id || "session"));
  console.log("  " + ui.muted(msgs + " message(s) · " + prov + " recorded change(s) · from " + (bundle.tool || "?")));
  if (flags.import) {
    const created = await createSession(cwd, { title: s.title ? s.title + " (pulled)" : "pulled session" });
    await saveMessages(cwd, created.id, s.messages || []);
    console.log("\n  " + ui.ok(ui.GLYPH.ok) + " imported as a new chat: " + ui.strong(created.id));
  } else {
    console.log("\n  " + ui.muted("Add --import to load it as a new chat here."));
  }
  try { rmSync(tmp, { force: true }); } catch {}
  console.log("  " + ui.accent(ui.GLYPH.seal) + ui.muted(" Verifiable round-trip: fetched from 0G Storage, root-checked, decrypted."));
}

// Mint the session as an NFT on 0G Chain: its token records the 0G Storage root
// of the session bundle, so an AI work session becomes an ownable, provable
// asset (ERC-721 based, ERC-7857-inspired).
async function cmdMint(flags, sessionId) {
  const cwd = resolveCwd(flags);
  await migrateLegacy(cwd);
  const id = sessionId || mostRecent(cwd);
  if (!id) { console.log(ui.warn("No session to mint. Run a task first.")); return; }
  const onchainOn = flags.onchain !== undefined ? flags.onchain : CONFIG.onchain;
  if (!onchainOn) { console.log(ui.warn("On-chain is off. Enable it with --onchain, /onchain on, or ZOG_ONCHAIN=on.")); return; }
  if (!process.env.ZOG_WALLET_KEY) { console.log(ui.warn("Set ZOG_WALLET_KEY (a funded 0G mainnet key) to mint.")); return; }
  const dir = sessionDir(cwd, id);

  console.log(ui.section("Mint session INFT", id));
  let root, storageTx;
  ui.info("ensuring the session is on 0G Storage...");
  try {
    const r = await ensureSessionRoot(cwd, id);
    root = r.root; storageTx = r.storageTx;
    console.log("  " + ui.ok(ui.GLYPH.ok) + (r.cached ? " reusing" : " uploaded") + " 0G Storage root " + ui.strong(root));
  } catch (e) { console.log(ui.err("  storage failed: " + e.message)); return; }

  const meta = {
    name: "z0gcode session " + root.slice(0, 10),
    description: "A verifiable z0gcode session: transcript and provenance stored on 0G Storage, reasoning served by 0G Compute (TEE).",
    session: id,
    storage_root: root,
    external_url: "https://chainscan.0g.ai/tx/" + storageTx,
    attributes: [
      { trait_type: "tool", value: "z0gcode" },
      { trait_type: "backend", value: "0G Compute" },
    ],
  };
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(meta)).toString("base64");

  ui.info("minting on 0G Chain...");
  try {
    const { mintSession } = await import("../src/inft.mjs");
    const r = await mintSession(cwd, { root, uri });
    if (r.deployed) {
      console.log("  " + ui.ok(ui.GLYPH.ok) + " deployed Z0gSession " + ui.strong(r.contract));
      console.log("  " + ui.muted("    tx " + r.deployTx + "  ·  https://chainscan.0g.ai/address/" + r.contract));
    }
    console.log("  " + ui.ok(ui.GLYPH.ok) + " minted token " + ui.strong("#" + r.tokenId) + ui.muted(" to " + r.owner));
    console.log("  " + ui.muted("    tx " + r.txHash + "  ·  https://chainscan.0g.ai/tx/" + r.txHash));
    writeFileSync(path.join(dir, "mint.json"), JSON.stringify({ id, contract: r.contract, tokenId: r.tokenId, txHash: r.txHash, block: r.block, root, ts: new Date().toISOString() }, null, 2) + "\n");
    console.log("\n  " + ui.accent(ui.GLYPH.seal) + ui.muted(" This session is now an on-chain asset. Saved to .z0g/sessions/" + id + "/mint.json"));
  } catch (e) { console.log(ui.err("  mint failed: " + e.message)); }
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
  row("open", "Subagents", ui.muted(CONFIG.subagents ? "on · up to " + CONFIG.maxParallel + " parallel" : "off"));
  row(CONFIG.onchain ? (process.env.ZOG_WALLET_KEY ? "ok" : "warn") : "open", "On-chain",
    CONFIG.onchain ? (process.env.ZOG_WALLET_KEY ? ui.muted("on · wallet set") : ui.warn("on · set ZOG_WALLET_KEY")) : ui.muted("off (gas-spending, opt-in)"));

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
    if (e.tee_trace && e.tee_trace.provider) {
      console.log("      " + ui.muted("0G node") + " " + ui.accent(e.tee_trace.provider) + ui.muted(e.tee_trace.request_id ? "  req " + e.tee_trace.request_id : ""));
    }
    console.log("      " + ui.muted("signed " + e.ts + " · " + (e.response_id || "no response id")));
  }
  console.log("");
  const withNode = man.entries.filter((e) => e.tee_trace && e.tee_trace.provider).length;
  console.log("  " + ui.accent(ui.GLYPH.seal) + ui.muted(" Model id, response id" + (withNode ? ", and the 0G provider node address" : "") + " captured from 0G Compute (TEE)."));
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
    if (verifyCmd && !flags.json) {
      await runGoal({ client: makeClient(), objective: task, cwd, sessionId, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, preferredSubagents: flags.subagents, preferredOnchain: flags.onchain, preferredEscalate: flags.escalate, verifyCmd, maxIters: 3, history: opened.history });
      return;
    }
    const client = makeClient();
    const mcp = await loadMcp(cwd);
    if (mcp?.count && !flags.json) ui.info(`MCP: ${mcp.count} tool(s) from configured servers`);
    let lastModel = flags.model || CONFIG.model;
    const res = await runAgent({ client, task, cwd, sessionDir: sessionDirPath, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, preferredSubagents: flags.subagents, preferredOnchain: flags.onchain, preferredEscalate: flags.escalate, onModel: (m) => { lastModel = m; }, quiet: !!flags.json, history: opened.history, mcp });
    if (res?.messages) await saveMessages(cwd, sessionId, res.messages);
    await mcp?.close();
    if (flags.json) {
      // Headless: emit the run result as JSON (only JSON on stdout), for CI/scripts.
      const man = await loadProvenance(sessionDirPath);
      const entries = Array.isArray(man?.entries) ? man.entries : [];
      const out = {
        ok: !!res?.ok,
        steps: res?.steps ?? null,
        model: lastModel,
        finalText: res?.finalText || "",
        files: [...new Set(entries.map((e) => e.path))],
        changes: entries.map((e) => ({ path: e.path, model: e.model, node: e.tee_trace?.provider || null })),
        usage: res?.usageTotal ? { prompt: res.usageTotal.prompt, completion: res.usageTotal.completion, total: res.usageTotal.total } : null,
        session: sessionId,
      };
      console.log(JSON.stringify(out, null, 2));
    }
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
    await runGoal({ client, objective, cwd, sessionId: opened.id, sessionDir: opened.dir, allowBash: flags.auto, preferredModel: flags.model, preferredEffort: flags.effort, preferredSubagents: flags.subagents, preferredOnchain: flags.onchain, preferredEscalate: flags.escalate, verifyCmd, maxIters: 3, history: opened.history });
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
  let subagents = flags.subagents;
  let onchain = flags.onchain;
  let escalate = flags.escalate;
  // Permission mode: auto (run all) | ask (approve each) | plan (read-only).
  let mode = flags.auto ? "auto" : "ask";
  const allowedCmds = new Set(loadSettings(cwd).allowedCommands || []);
  let sessTokens = { in: 0, out: 0 };
  let priceMap = null;
  fetchModels(client).then((all) => { priceMap = Object.fromEntries(all.map((m) => [m.id, m])); }).catch(() => {});
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
  const activeModel = () => model || CONFIG.model;
  const activeEffort = () => (effort === "" ? null : (effort || CONFIG.effort));
  const activeOnchain = () => (onchain !== undefined ? onchain : CONFIG.onchain);
  const activeEscalate = () => (escalate !== undefined ? escalate : CONFIG.escalate);
  // Approve a gated action in "ask" mode. Remembers "always" choices in settings
  // so it never asks again for that program (or for on-chain actions).
  const approve = async (kind, desc) => {
    const key = kind === "run_bash" ? "bash:" + (String(desc).trim().split(/\s+/)[0] || "?") : kind === "web" ? "@web" : "@onchain";
    if (allowedCmds.has(key)) return true;
    rl.pause();
    const label = kind === "run_bash" ? "run " + ui.strong(String(desc).slice(0, 80)) : kind === "web" ? "web: " + String(desc).slice(0, 80) : "on-chain: " + desc;
    console.log("\n  " + ui.warn(ui.uiTTY ? "▲" : "!") + "  " + label);
    const a = (await ask("     allow?  " + ui.accent("y") + "es  " + ui.accent("n") + "o  " + ui.accent("a") + "lways  ")).trim().toLowerCase();
    rl.resume();
    if (a === "a" || a === "always") {
      allowedCmds.add(key);
      saveSetting("allowedCommands", [...allowedCmds]);
      ui.info("saved: won't ask again for " + (kind === "run_bash" ? key.slice(5) : kind === "web" ? "web requests" : "on-chain actions"));
      return true;
    }
    return a === "y" || a === "yes";
  };
  const costOf = () => {
    const m = priceMap && priceMap[activeModel()];
    if (!m || m.inPerM == null) return null;
    return (sessTokens.in / 1e6) * m.inPerM + (sessTokens.out / 1e6) * (m.outPerM || 0);
  };
  // Divider + session token/cost counter, then the z0g prompt.
  const showPrompt = () => {
    console.log(ui.sessionBar({ model: activeModel(), effort: activeEffort(), inTok: sessTokens.in, outTok: sessTokens.out, cost: costOf() }));
    rl.prompt();
  };
  const customCmds = loadCustomCommands(cwd);
  const customMap = Object.fromEntries(customCmds.map((c) => [c.name, c]));
  extraSlash = customCmds.map((c) => "/" + c.name);
  const hooks = loadHooks(cwd);
  // Ctrl+C interrupts a running turn (returns to the prompt) instead of killing z0g.
  let running = false;
  let abortCtl = null;
  rl.on("SIGINT", () => {
    if (running && abortCtl) { abortCtl.abort(); }
    else { rl.close(); }
  });
  // Run one agent turn: hooks, the agent, then persist history + tokens.
  const runTurn = async (task) => {
    await runHooks(cwd, "preRun", hooks, flags.auto, task);
    abortCtl = new AbortController();
    running = true;
    let res;
    try {
      res = await runAgent({ client, task, cwd, sessionDir: sessionDirPath, preferredMode: mode, approve, preferredModel: model, preferredEffort: effort, preferredSubagents: subagents, preferredOnchain: activeOnchain(), preferredEscalate: activeEscalate(), signal: abortCtl.signal, history, mcp });
    } finally {
      running = false; abortCtl = null;
    }
    history = res.messages;
    if (res.usageTotal) { sessTokens.in += res.usageTotal.prompt || 0; sessTokens.out += res.usageTotal.completion || 0; }
    await saveMessages(cwd, sessionId, history);
    if (!res.aborted) await runHooks(cwd, "postRun", hooks, flags.auto, task);
  };
  ui.info("Interactive session. Type a task, or / then Tab for commands.");
  ui.info("mode: " + ui.strong(mode) + (mode === "ask" ? " (I ask before running commands)" : mode === "plan" ? " (read-only until you /mode auto)" : " (runs commands without asking)") + "  ·  /mode ask|auto|plan  ·  Ctrl+C stops a running task");
  if (customCmds.length) ui.info(customCmds.length + " custom command(s): " + customCmds.map((c) => "/" + c.name).join(", "));
  if (hasHooks(hooks) && !flags.auto) ui.info("hooks are configured; run with --auto to enable them");
  // Blinking block cursor at the prompt (matches the demo); restore on any exit.
  ui.cursorBlink(true);
  process.once("exit", () => ui.cursorBlink(false));
  showPrompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) { pendingModels = null; showPrompt(); continue; }

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
      showPrompt();
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
      else if (cmd === "compact") {
        const hist = Array.isArray(history) ? history : [];
        const convo = hist.filter((m) => m.role !== "system");
        if (convo.length < 2) { ui.info("nothing to compact yet"); }
        else {
          ui.info("compacting the conversation to save context...");
          const sys = hist.find((m) => m.role === "system") || null;
          const req = [...hist, { role: "user", content: "Summarize this coding session compactly, for your own future reference so you can continue with far less context: the original task, key decisions, files created or changed and why, important facts or values discovered, and the current state and next step. Keep everything you would need to continue; drop the chatter. Reply with only the summary." }];
          try {
            const res = await complete(client, { models: modelChain(activeModel()), messages: req, effort: activeEffort() });
            const summary = (res.message?.content || "").trim();
            if (summary) {
              history = [...(sys ? [sys] : []), { role: "user", content: "[Earlier session, compacted]\n" + summary }];
              await saveMessages(cwd, sessionId, history);
              ui.info("compacted " + convo.length + " messages into a summary. Context is now smaller.");
            } else ui.info("could not summarize; nothing changed");
          } catch (e) { console.log(ui.warn("compact failed: " + e.message)); }
        }
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
      else if (cmd === "subagents") {
        const a = arg.toLowerCase().trim();
        if (a === "on" || a === "off") {
          subagents = a === "on"; saveSetting("subagents", subagents);
          ui.info("subagents " + (subagents ? "on" : "off") + " (saved)");
        } else if (!a) {
          const cur = subagents !== undefined ? subagents : CONFIG.subagents;
          ui.info("subagents: " + (cur ? "on" : "off") + "  ·  usage: /subagents on|off");
        } else {
          console.log(ui.warn("usage: /subagents on|off"));
        }
      }
      else if (cmd === "onchain") {
        const a = arg.toLowerCase().trim();
        if (a === "on" || a === "off") {
          onchain = a === "on"; saveSetting("onchain", onchain);
          ui.info("on-chain " + (onchain ? "on" : "off") + " (saved)" + (onchain && !process.env.ZOG_WALLET_KEY ? "  ·  set ZOG_WALLET_KEY to a funded key" : ""));
        } else if (!a) {
          ui.info("on-chain: " + (activeOnchain() ? "on" : "off") + "  ·  gas-spending (Storage/Chain/anchor)  ·  usage: /onchain on|off");
        } else {
          console.log(ui.warn("usage: /onchain on|off"));
        }
      }
      else if (cmd === "escalate") {
        const a = arg.toLowerCase().trim();
        if (a === "on" || a === "off") {
          escalate = a === "on"; saveSetting("escalate", escalate);
          ui.info("escalate " + (escalate ? "on" : "off") + " (saved)" + (escalate ? "  ·  switches to a stronger model after " + CONFIG.escalateAfter + " tool failures" : "  ·  stays on the chosen model"));
        } else if (!a) {
          ui.info("escalate: " + (activeEscalate() ? "on" : "off") + "  ·  after " + CONFIG.escalateAfter + " failures  ·  usage: /escalate on|off");
        } else {
          console.log(ui.warn("usage: /escalate on|off"));
        }
      }
      else if (cmd === "mode") {
        const a = arg.toLowerCase().trim();
        if (["ask", "auto", "plan"].includes(a)) {
          mode = a;
          const desc = a === "auto" ? "runs commands without asking" : a === "plan" ? "read-only: explores and plans, no writes or commands" : "asks before each command / on-chain action";
          ui.info("mode: " + ui.strong(a) + "  ·  " + desc);
        } else if (!a) {
          ui.info("mode: " + ui.strong(mode) + "  ·  usage: /mode ask|auto|plan" + (allowedCmds.size ? "  ·  " + allowedCmds.size + " always-allowed" : ""));
        } else {
          console.log(ui.warn("usage: /mode ask|auto|plan"));
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
      else if (cmd === "share") {
        if (Array.isArray(history) && history.length) await saveMessages(cwd, sessionId, history);
        await cmdShare({ ...flags, anchor: /anchor/.test(arg) || flags.anchor, onchain: activeOnchain() }, sessionId);
      }
      else if (cmd === "mint") {
        if (Array.isArray(history) && history.length) await saveMessages(cwd, sessionId, history);
        await cmdMint({ ...flags, onchain: activeOnchain() }, sessionId);
      }
      else if (cmd === "pull") await cmdPull({ ...flags, import: /import/.test(arg) }, rest[0]);
      else if (cmd === "init") await cmdInit({ ...flags, force: /force|-f/.test(arg) });
      else if (cmd === "undo") await cmdUndo(flags, sessionId);
      else if (cmd === "checkpoints") await cmdCheckpoints(flags, sessionId);
      else if (cmd === "plan") { const p = await loadPlan(sessionDirPath); if (p) ui.renderPlan(p); else ui.info("no plan yet"); }
      else if (cmd === "verify") await runVerify(cwd);
      else if (cmd === "commands") {
        if (!customCmds.length) ui.info("no custom commands. Add .z0g/commands/<name>.md to create /<name>");
        else { console.log(ui.section("Custom commands", customCmds.length + " loaded")); for (const c of customCmds) console.log("  " + ui.accent("/" + c.name) + "  " + ui.muted(c.description)); }
      }
      else if (cmd === "goal") {
        abortCtl = new AbortController(); running = true;
        try {
          await runGoal({ client, objective: arg, cwd, sessionId, sessionDir: sessionDirPath, preferredMode: mode, approve, preferredModel: model, preferredEffort: effort, preferredSubagents: subagents, preferredOnchain: activeOnchain(), preferredEscalate: activeEscalate(), signal: abortCtl.signal, verifyCmd: flags.verify || detectVerifyCmd(cwd), maxIters: 3, history });
        } finally { running = false; abortCtl = null; }
        history = await readMessages(cwd, sessionId) || history;
      }
      else if (customMap[cmd]) {
        const task = expandTemplate(customMap[cmd].template, arg);
        await runTurn(task);
      }
      else ui.info("unknown command; /help for the list");
      showPrompt();
      continue;
    }

    await runTurn(input);
    showPrompt();
  }
  rl.close();
  ui.cursorBlink(false);
  await pruneIfEmpty(sessionId);
  await mcp?.close();
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.help) { console.log(helpText()); return; }
  if (flags.version) {
    let v = "";
    try { v = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch {}
    console.log("z0gcode " + (v || "0.4.0"));
    return;
  }

  const sub = positional[0];
  try {
    if (sub === "models") return await cmdModels(flags);
    if (sub === "image") return await cmdImage(positional[1], positional[2], flags);
    if (sub === "transcribe") return await cmdTranscribe(positional[1], flags);
    if (sub === "init") return await cmdInit(flags);
    if (sub === "undo") return await cmdUndo(flags);
    if (sub === "checkpoints") return await cmdCheckpoints(flags);
    if (sub === "share") return await cmdShare(flags);
    if (sub === "pull") return await cmdPull(flags, positional[1]);
    if (sub === "mint") return await cmdMint(flags);
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
    if (!flags.json) ui.banner(flags.model || CONFIG.model, CONFIG.baseURL);
    await runTask(task, flags);
  } catch (e) {
    ui.error(e.message);
    process.exitCode = 1;
  }
}

main();
