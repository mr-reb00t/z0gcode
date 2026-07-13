// The agentic loop: reason on 0G, call tools, feed results back, repeat until done.
import path from "node:path";
import { promises as fs } from "node:fs";
import { CONFIG, modelChain } from "./config.mjs";
import { completeStream } from "./client.mjs";
import { TOOL_DEFS, makeExecutor } from "./tools.mjs";
import { SYSTEM_0G } from "./skills.mjs";
import { skillsPromptBlock } from "./user-skills.mjs";
import { contextPromptBlock } from "./context.mjs";
import { makeProvenance } from "./provenance.mjs";
import { recordCheckpoint } from "./checkpoints.mjs";
import { isGitRepo, addWorktree, collectPatch, removeWorktree, applyPatch } from "./worktree.mjs";
import * as ui from "./ui.mjs";

function systemPrompt(cwd) {
  return [
    "You are z0gcode, a terminal coding agent whose brain runs on 0G Compute (0G's decentralized, private, verifiable inference).",
    "You help developers build software and you are an expert at building on the 0G stack.",
    "",
    "Work like a careful engineer:",
    "- If the task needs 3 or more steps, your FIRST tool call MUST be update_plan with a short checklist; then update it (exactly one step in_progress) as you complete each step.",
    "- Use search_files (regex) to locate code instead of reading whole files.",
    "- Inspect before you change: read files and list directories first.",
    "- Make minimal, correct edits. Prefer edit_file over rewriting whole files.",
    "- After changing code, verify it (run it with run_bash when allowed).",
    "- Never print secrets and never hardcode private keys; use environment variables.",
    "- When the task is complete, STOP calling tools and reply with a short summary of what you did.",
    "",
    SYSTEM_0G,
    skillsPromptBlock(cwd),
    contextPromptBlock(cwd),
  ].filter(Boolean).join("\n");
}

function argSummary(name, args) {
  if (!args) return "";
  if (name === "run_bash") return args.command || "";
  if (name === "search_files") return args.query || "";
  if (name === "update_plan") return `${(args.plan || []).length} steps`;
  if (args.path) return args.path;
  if (args.name) return args.name;
  return "";
}

// Parse tool-call arguments defensively (open models occasionally emit slightly-off JSON).
function parseArgs(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    try {
      // light repair: strip trailing commas
      return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

export async function runAgent({ client, task, cwd, sessionDir, allowBash, preferredModel, preferredEffort, preferredSubagents, preferredOnchain, onModel, history, mcp, quiet = false, toolNames = null, isSubagent = false }) {
  const q = !!quiet;
  // "" means an explicit unset (use the model's own default); undefined falls back.
  const effort = preferredEffort === "" ? null : (preferredEffort || CONFIG.effort);
  const subOn = preferredSubagents !== undefined ? preferredSubagents : CONFIG.subagents;
  const onchainOn = preferredOnchain !== undefined ? preferredOnchain : CONFIG.onchain;
  const provDir = sessionDir || path.join(cwd, ".z0g");
  const execute = makeExecutor({ cwd, allowBash, sessionDir: provDir, onchain: onchainOn });
  // Restrict the toolset for subagents (read-only), and drop spawn_subagents when
  // it is a subagent (no recursion) or the toggle is off. Drop on-chain tools when
  // the on-chain toggle is off so the agent never proposes a gas-spending action.
  let baseTools = toolNames ? TOOL_DEFS.filter((t) => toolNames.includes(t.function.name)) : TOOL_DEFS;
  if (isSubagent || !subOn) baseTools = baseTools.filter((t) => t.function.name !== "spawn_subagents" && t.function.name !== "spawn_write_subagents");
  // Write subagents edit files and run shell in worktrees, so require --auto.
  if (!allowBash) baseTools = baseTools.filter((t) => t.function.name !== "spawn_write_subagents");
  if (!onchainOn) baseTools = baseTools.filter((t) => t.function.name !== "upload_0g_storage" && t.function.name !== "deploy_0g_chain");
  const toolSet = !isSubagent && mcp?.tools?.length ? [...baseTools, ...mcp.tools] : baseTools;
  const models = modelChain(preferredModel);
  const prov = makeProvenance(provDir);
  // A per-run id groups this turn's edits so `z0g undo` reverts them together.
  const runId = "r" + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  const messages = history && history.length
    ? [...history, { role: "user", content: task }]
    : [{ role: "system", content: systemPrompt(cwd) }, { role: "user", content: task }];

  const recent = []; // circuit breaker on repeated identical tool calls
  const failCounts = {}; // per-tool failure counter, drives model escalation
  let escalate = false;
  let activeModel = models[0];
  const usageTotal = { prompt: 0, completion: 0, total: 0 };
  let finalText = "";

  for (let step = 0; step < CONFIG.maxSteps; step++) {
    // Choose model order: escalate a stuck turn to a stronger fallback instead of looping.
    let order;
    if (escalate) {
      const stronger = models.find((m) => m !== activeModel) || activeModel;
      order = [stronger, ...models.filter((m) => m !== stronger)];
      if (!q) console.log("  " + ui.warn((ui.uiTTY ? "▲" : "!") + " escalating to " + stronger));
      escalate = false;
    } else {
      order = [activeModel, ...models.filter((m) => m !== activeModel)];
    }

    if (!q) ui.thinking(order[0]);
    let out;
    let mdOut = null;
    try {
      out = await completeStream(client, {
        models: order,
        messages,
        tools: toolSet,
        effort,
        onDelta: q
          ? undefined
          : (t) => {
              if (!mdOut) {
                ui.clearThinking();
                mdOut = ui.assistantStream(); // render the answer as markdown, line by line
              }
              mdOut.push(t);
            },
      });
    } catch (e) {
      if (!q) {
        ui.clearThinking();
        ui.error(`All 0G models failed: ${e.message}`);
      }
      usageTotal.total = usageTotal.prompt + usageTotal.completion;
      return { ok: false, steps: step, messages, finalText, usageTotal };
    }
    if (!q) ui.clearThinking();
    if (mdOut) mdOut.end();
    activeModel = out.model;
    if (onModel) onModel(out.model);
    if (out.usage) {
      usageTotal.prompt += out.usage.prompt_tokens || out.usage.input_tokens || 0;
      usageTotal.completion += out.usage.completion_tokens || out.usage.output_tokens || 0;
    }
    const msg = out.message;
    messages.push(msg);

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) {
      finalText = (msg.content || "").trim();
      if (!q) {
        if (!mdOut) ui.assistant(msg.content || "(done)");
        ui.hud(out.model, out.usage, effort);
      }
      usageTotal.total = usageTotal.prompt + usageTotal.completion;
      return { ok: true, steps: step + 1, changes: prov.count(), messages, finalText, usageTotal };
    }

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);
      if (args === null) {
        if (!q) { ui.toolCall(name, "(bad args)"); ui.toolResult(false, "invalid JSON arguments"); }
        messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: could not parse JSON arguments. Re-emit the tool call with valid JSON." });
        continue;
      }

      const key = `${name}:${JSON.stringify(args)}`;
      recent.push(key);
      if (recent.length > 6) recent.shift();
      if (recent.filter((k) => k === key).length >= 3) {
        if (!q) ui.toolResult(false, "loop detected, stopping");
        messages.push({ role: "tool", tool_call_id: tc.id, content: "STOP: you called this exact tool 3 times. Change approach or finish." });
        continue;
      }

      // Parallel subagents: routed here, not through the normal executor.
      if (name === "spawn_subagents") {
        if (isSubagent) {
          if (!q) { ui.toolCall(name, ""); ui.toolResult(false, "subagents cannot spawn subagents"); }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: a subagent cannot spawn subagents." });
          continue;
        }
        const subtasks = (Array.isArray(args.tasks) ? args.tasks.filter((t) => t && typeof t.prompt === "string" && t.prompt.trim()) : []).slice(0, 12);
        if (!subtasks.length) {
          if (!q) { ui.toolCall(name, ""); ui.toolResult(false, "no tasks"); }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: provide tasks: [{ prompt }]." });
          continue;
        }
        if (!q) ui.subagentsStart(subtasks.length);
        const subResults = await runSubagents({
          client, tasks: subtasks, cwd, sessionDir: provDir,
          preferredModel, preferredEffort,
          onOne: q ? null : (r) => ui.subagentOne(r),
        });
        if (!q) ui.subagentsSummary(subResults);
        // Bound the tool result so a big fan-out can't overflow the parent context.
        // Full untruncated output stays in the saved per-subagent transcripts.
        const PER_SUB = 8000;
        const TOTAL_SUB = 40000;
        const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "\n... [truncated]" : (s || ""));
        let combined = subResults.map((r) => `## ${r.label} (${r.ok ? "ok" : "failed"})\n${clip(r.summary, PER_SUB)}`).join("\n\n");
        if (combined.length > TOTAL_SUB) combined = combined.slice(0, TOTAL_SUB) + "\n... [more subagent output truncated; see .z0g/sessions/<id>/subagents/]";
        const totalTok = subResults.reduce((a, r) => a + (r.tokens || 0), 0);
        messages.push({ role: "tool", tool_call_id: tc.id, content: `Subagent results (${subResults.length} agents, ${totalTok} tokens):\n\n${combined}` });
        continue;
      }

      // Parallel WRITE subagents: each edits in an isolated git worktree, then
      // its diff is merged back into the main tree.
      if (name === "spawn_write_subagents") {
        if (isSubagent) {
          if (!q) { ui.toolCall(name, ""); ui.toolResult(false, "subagents cannot spawn subagents"); }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: a subagent cannot spawn subagents." });
          continue;
        }
        const subtasks = (Array.isArray(args.tasks) ? args.tasks.filter((t) => t && typeof t.prompt === "string" && t.prompt.trim()) : []).slice(0, 8);
        if (!subtasks.length) {
          if (!q) { ui.toolCall(name, ""); ui.toolResult(false, "no tasks"); }
          messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: provide tasks: [{ prompt }]." });
          continue;
        }
        if (!q) ui.subagentsStart(subtasks.length, "write · isolated git worktrees");
        const out = await runWriteSubagents({
          client, tasks: subtasks, cwd, sessionDir: provDir,
          preferredModel, preferredEffort,
          onOne: q ? null : (r) => ui.subagentOne(r),
        });
        if (!out.ok) {
          if (!q) ui.toolResult(false, out.error);
          messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: " + out.error });
          continue;
        }
        const wr = out.results;
        // Record checkpoints for merged edits so `z0g undo` reverts them too.
        for (const r of wr) {
          for (const ch of (r.changes || [])) {
            await recordCheckpoint(provDir, {
              runId, ts: new Date().toISOString(),
              task: typeof task === "string" ? task.slice(0, 80) : "",
              path: ch.path, before: ch.before, after: ch.after,
              created: !!ch.created, tool: "spawn_write_subagents", model: activeModel,
            });
          }
        }
        if (!q) ui.subagentsSummary(wr);
        const PER = 6000, TOTAL = 40000;
        const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "\n... [truncated]" : (s || ""));
        const applied = wr.filter((r) => r.applied);
        let combined = wr.map((r) => `## ${r.label} (${r.ok ? "ok" : "failed"}${r.applied ? ", merged" : ", " + (r.applyReason || "not merged")})\nfiles: ${r.files.join(", ") || "none"}\n${clip(r.summary, PER)}`).join("\n\n");
        if (combined.length > TOTAL) combined = combined.slice(0, TOTAL) + "\n... [more output truncated; see .z0g/sessions/<id>/subagents/]";
        messages.push({ role: "tool", tool_call_id: tc.id, content: `Write-subagent results (${wr.length} agents, ${applied.length} merged into the working tree):\n\n${combined}` });
        continue;
      }

      if (!q) ui.toolCall(name, argSummary(name, args));
      const res = mcp && mcp.isMcp(name) ? await mcp.call(name, args) : await execute(name, args);
      if (!q) ui.toolResult(res.ok, res.summary);

      if (res.ok) {
        failCounts[name] = 0;
        if (!q && res.plan) ui.renderPlan(res.plan);
        if (res.change) {
          if (!q) {
            const diff = ui.renderDiff(res.change.before, res.change.after);
            if (diff) console.log(diff);
          }
          await prov.record({
            pathRel: res.change.path,
            before: res.change.before,
            after: res.change.after,
            model: out.model,
            responseId: out.responseId,
            trace: out.trace,
          });
          if (!isSubagent) {
            await recordCheckpoint(provDir, {
              runId, ts: new Date().toISOString(),
              task: typeof task === "string" ? task.slice(0, 80) : "",
              path: res.change.path, before: res.change.before, after: res.change.after,
              created: !!res.change.created, tool: name, model: out.model,
            });
          }
        }
      } else {
        failCounts[name] = (failCounts[name] || 0) + 1;
        if (failCounts[name] >= 2) escalate = true; // stuck on this tool: try a stronger model
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: String(res.content ?? (res.ok ? "OK" : "ERROR")) });
    }
  }

  if (!q) ui.error(`Reached max steps (${CONFIG.maxSteps}).`);
  usageTotal.total = usageTotal.prompt + usageTotal.completion;
  return { ok: false, steps: CONFIG.maxSteps, changes: prov.count(), messages, finalText, usageTotal };
}

// Run independent read-only subtasks in parallel (capped), each as an isolated
// subagent. Returns [{ label, ok, summary, tokens }]. Subagents cannot write,
// run shell, or spawn further subagents. Transcripts are saved per subagent.
const SUBAGENT_TOOLS = ["read_file", "search_files", "list_dir", "read_skill", "update_plan"];

export async function runSubagents({ client, tasks, cwd, sessionDir, preferredModel, preferredEffort, onOne }) {
  const cap = Math.max(1, CONFIG.maxParallel);
  const results = new Array(tasks.length);
  // Each subagent gets its OWN directory so its plan/provenance stay isolated
  // from the parent and from siblings; number after any existing subdirs so a
  // second fan-out does not clobber the first. base is computed once up front.
  const rootDir = sessionDir ? path.join(sessionDir, "subagents") : null;
  let base = 0;
  if (rootDir) {
    try {
      await fs.mkdir(rootDir, { recursive: true });
      base = (await fs.readdir(rootDir)).filter((n) => /^\d+$/.test(n)).length;
    } catch {}
  }
  let next = 0;
  const runOne = async (i) => {
    const t = tasks[i];
    const label = (t.label && String(t.label).trim()) || `subagent ${i + 1}`;
    const subDir = rootDir ? path.join(rootDir, String(base + i + 1)) : undefined;
    let res = null;
    try {
      res = await runAgent({
        client, task: t.prompt, cwd, sessionDir: subDir,
        allowBash: false, preferredModel, preferredEffort,
        quiet: true, toolNames: SUBAGENT_TOOLS, isSubagent: true,
      });
      results[i] = { label, ok: !!res.ok, summary: res.finalText || "(no summary)", tokens: res.usageTotal?.total || 0 };
    } catch (e) {
      results[i] = { label, ok: false, summary: "error: " + e.message, tokens: 0 };
    }
    try {
      if (subDir) {
        await fs.mkdir(subDir, { recursive: true });
        await fs.writeFile(path.join(subDir, "transcript.json"), JSON.stringify({ task: t, result: results[i], messages: res?.messages || [] }, null, 2), "utf8");
      }
    } catch {}
    if (onOne) onOne(results[i]);
  };
  const pool = async () => {
    while (next < tasks.length) {
      const i = next++;
      await runOne(i);
    }
  };
  const workers = [];
  for (let w = 0; w < Math.min(cap, tasks.length); w++) workers.push(pool());
  await Promise.all(workers);
  return results;
}

// Run independent WRITE subtasks in parallel, each in its own git worktree, then
// apply each worktree's diff back to the main tree (non-overlapping edits merge;
// overlapping files are reported and skipped). Returns { ok, error?, results }.
// Each result: { label, ok, summary, files, applied, applyReason, changes, tokens }.
const WRITE_SUBAGENT_TOOLS = ["read_file", "search_files", "list_dir", "read_skill", "update_plan", "write_file", "edit_file", "run_bash"];

export async function runWriteSubagents({ client, tasks, cwd, sessionDir, preferredModel, preferredEffort, onOne }) {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, error: "Write subagents require a git repository. Run `git init` and make a commit first." };
  }
  const rootDir = sessionDir ? path.join(sessionDir, "subagents") : null;
  let base = 0;
  if (rootDir) {
    try { await fs.mkdir(rootDir, { recursive: true }); base = (await fs.readdir(rootDir)).filter((n) => /^\d+$/.test(n)).length; } catch {}
  }
  const stamp = Date.now().toString(36);

  // 1) Create a worktree per subtask (sequential: git index is single-writer).
  const wts = new Array(tasks.length);
  for (let i = 0; i < tasks.length; i++) {
    try { wts[i] = await addWorktree(cwd, `${stamp}-${base + i + 1}`); }
    catch (e) { wts[i] = { error: e.message }; }
  }

  // 2) Run each subagent in its worktree, in parallel (pooled), and collect diffs.
  const cap = Math.max(1, CONFIG.maxParallel);
  const results = new Array(tasks.length);
  let next = 0;
  const runOne = async (i) => {
    const t = tasks[i];
    const label = (t.label && String(t.label).trim()) || `write-subagent ${i + 1}`;
    const wt = wts[i];
    if (!wt || wt.error) {
      results[i] = { label, ok: false, summary: "worktree failed: " + (wt?.error || "unknown"), files: [], patch: "", tokens: 0 };
      if (onOne) onOne(results[i]); return;
    }
    const subDir = rootDir ? path.join(rootDir, String(base + i + 1)) : undefined;
    let res = null, patch = "", files = [];
    try {
      res = await runAgent({
        client, task: t.prompt, cwd: wt.wtPath, sessionDir: subDir,
        allowBash: true, preferredModel, preferredEffort,
        quiet: true, toolNames: WRITE_SUBAGENT_TOOLS, isSubagent: true,
      });
      ({ patch, files } = await collectPatch(wt.wtPath));
      results[i] = { label, ok: !!res.ok, summary: res.finalText || "(no summary)", files, patch, tokens: res.usageTotal?.total || 0 };
    } catch (e) {
      results[i] = { label, ok: false, summary: "error: " + e.message, files: [], patch: "", tokens: 0 };
    }
    try {
      if (subDir) {
        await fs.mkdir(subDir, { recursive: true });
        await fs.writeFile(path.join(subDir, "transcript.json"), JSON.stringify({ task: t, result: { ...results[i], patch: undefined }, messages: res?.messages || [] }, null, 2), "utf8");
      }
    } catch {}
    try { await removeWorktree(cwd, wt.wtPath, wt.branch); } catch {}
    if (onOne) onOne(results[i]);
  };
  const pool = async () => { while (next < tasks.length) { const i = next++; await runOne(i); } };
  const workers = [];
  for (let w = 0; w < Math.min(cap, tasks.length); w++) workers.push(pool());
  await Promise.all(workers);

  // 3) Apply each diff to the main tree in order, capturing before/after so the
  // parent can checkpoint them (keeps `z0g undo` working for merged writes).
  for (const r of results) {
    if (!r.patch || !r.patch.trim()) { r.applied = false; r.applyReason = "no changes"; r.changes = []; delete r.patch; continue; }
    const pre = [];
    for (const f of r.files) {
      let before = "", existed = true;
      try { before = await fs.readFile(path.join(cwd, f), "utf8"); } catch { before = ""; existed = false; }
      pre.push({ path: f, before, existed });
    }
    const a = await applyPatch(cwd, r.patch);
    r.applied = a.ok; r.applyReason = a.reason;
    r.changes = [];
    if (a.ok) {
      for (const p of pre) {
        let after = "";
        try { after = await fs.readFile(path.join(cwd, p.path), "utf8"); } catch { after = ""; }
        if (after !== p.before) r.changes.push({ path: p.path, before: p.before, after, created: !p.existed && after !== "" });
      }
    }
    delete r.patch;
  }
  return { ok: true, results };
}
