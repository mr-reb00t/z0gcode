// The agentic loop: reason on 0G, call tools, feed results back, repeat until done.
import path from "node:path";
import { CONFIG, modelChain } from "./config.mjs";
import { completeStream } from "./client.mjs";
import { TOOL_DEFS, makeExecutor } from "./tools.mjs";
import { SYSTEM_0G } from "./skills.mjs";
import { skillsPromptBlock } from "./user-skills.mjs";
import { makeProvenance } from "./provenance.mjs";
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
  ].join("\n");
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

export async function runAgent({ client, task, cwd, sessionDir, allowBash, preferredModel, preferredEffort, onModel, history, mcp }) {
  const effort = preferredEffort || CONFIG.effort;
  const provDir = sessionDir || path.join(cwd, ".z0g");
  const execute = makeExecutor({ cwd, allowBash, sessionDir: provDir });
  const toolSet = mcp?.tools?.length ? [...TOOL_DEFS, ...mcp.tools] : TOOL_DEFS;
  const models = modelChain(preferredModel);
  const prov = makeProvenance(provDir);
  const messages = history && history.length
    ? [...history, { role: "user", content: task }]
    : [{ role: "system", content: systemPrompt(cwd) }, { role: "user", content: task }];

  const recent = []; // circuit breaker on repeated identical tool calls
  const failCounts = {}; // per-tool failure counter, drives model escalation
  let escalate = false;
  let activeModel = models[0];

  for (let step = 0; step < CONFIG.maxSteps; step++) {
    // Choose model order: escalate a stuck turn to a stronger fallback instead of looping.
    let order;
    if (escalate) {
      const stronger = models.find((m) => m !== activeModel) || activeModel;
      order = [stronger, ...models.filter((m) => m !== stronger)];
      console.log("  " + ui.warn((ui.uiTTY ? "▲" : "!") + " escalating to " + stronger));
      escalate = false;
    } else {
      order = [activeModel, ...models.filter((m) => m !== activeModel)];
    }

    ui.thinking(order[0]);
    let out;
    let streamed = false;
    let mdOut = null;
    try {
      out = await completeStream(client, {
        models: order,
        messages,
        tools: toolSet,
        effort,
        onDelta: (t) => {
          if (!streamed) {
            ui.clearThinking();
            streamed = true;
            mdOut = ui.assistantStream(); // render the answer as markdown, line by line
          }
          mdOut.push(t);
        },
      });
    } catch (e) {
      ui.clearThinking();
      ui.error(`All 0G models failed: ${e.message}`);
      return { ok: false, steps: step, messages };
    }
    ui.clearThinking();
    if (mdOut) mdOut.end();
    activeModel = out.model;
    if (onModel) onModel(out.model);
    const msg = out.message;
    messages.push(msg);

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (toolCalls.length === 0) {
      if (!streamed) ui.assistant(msg.content || "(done)");
      ui.hud(out.model, out.usage, effort);
      return { ok: true, steps: step + 1, changes: prov.count(), messages };
    }

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);
      if (args === null) {
        ui.toolCall(name, "(bad args)");
        ui.toolResult(false, "invalid JSON arguments");
        messages.push({ role: "tool", tool_call_id: tc.id, content: "ERROR: could not parse JSON arguments. Re-emit the tool call with valid JSON." });
        continue;
      }

      const key = `${name}:${JSON.stringify(args)}`;
      recent.push(key);
      if (recent.length > 6) recent.shift();
      if (recent.filter((k) => k === key).length >= 3) {
        ui.toolResult(false, "loop detected, stopping");
        messages.push({ role: "tool", tool_call_id: tc.id, content: "STOP: you called this exact tool 3 times. Change approach or finish." });
        continue;
      }

      ui.toolCall(name, argSummary(name, args));
      const res = mcp && mcp.isMcp(name) ? await mcp.call(name, args) : await execute(name, args);
      ui.toolResult(res.ok, res.summary);

      if (res.ok) {
        failCounts[name] = 0;
        if (res.plan) ui.renderPlan(res.plan);
        if (res.change) {
          const diff = ui.renderDiff(res.change.before, res.change.after);
          if (diff) console.log(diff);
          await prov.record({
            pathRel: res.change.path,
            before: res.change.before,
            after: res.change.after,
            model: out.model,
            responseId: out.responseId,
          });
        }
      } else {
        failCounts[name] = (failCounts[name] || 0) + 1;
        if (failCounts[name] >= 2) escalate = true; // stuck on this tool: try a stronger model
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content: String(res.content ?? (res.ok ? "OK" : "ERROR")) });
    }
  }

  ui.error(`Reached max steps (${CONFIG.maxSteps}).`);
  return { ok: false, steps: CONFIG.maxSteps, changes: prov.count(), messages };
}
