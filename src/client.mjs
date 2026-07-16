// Robust client for the 0G Compute Router.
// The Router is OpenAI-compatible but does NOT switch models on 503, so we add
// app-level multi-model fallback, retry/backoff, and empty-response handling.
import OpenAI from "openai";
import { CONFIG } from "./config.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeClient() {
  if (!CONFIG.apiKey) {
    throw new Error("Missing ZOG_API_KEY. Get a 0G Router key at https://pc.0g.ai, then export it, put it in a project .env, or in ~/.z0gcode/.env to use it from anywhere.");
  }
  return new OpenAI({ baseURL: CONFIG.baseURL, apiKey: CONFIG.apiKey });
}

// Try each model in order; retry a model on 503/429; move on to the next on hard error.
// Returns { message, model, usage, responseId, systemFingerprint }. Throws only if every model fails.
export async function complete(client, { models, messages, tools, effort }) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = {
          model,
          messages,
          max_tokens: CONFIG.maxTokens,
          temperature: CONFIG.temperature,
        };
        if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
        if (effort) body.reasoning_effort = effort;
        const res = await client.chat.completions.create(body);
        const message = res.choices?.[0]?.message;
        if (!message) throw new Error("empty response");
        // A turn with neither content nor tool calls is unusable: treat as failure.
        const hasContent = (message.content || "").trim().length > 0;
        const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        if (!hasContent && !hasTools) throw new Error("no content and no tool calls");
        return {
          message,
          model,
          usage: res.usage || null,
          responseId: res.id || null,
          systemFingerprint: res.system_fingerprint || null,
          trace: res.x_0g_trace || null,
        };
      } catch (e) {
        lastErr = e;
        const status = e?.status;
        if (status === 503) {
          await sleep(400 * (attempt + 1));
          continue; // retry same model: providers may recover
        }
        if (status === 429) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        break; // 400/auth/other: this model won't work, try the next
      }
    }
  }
  throw lastErr || new Error("all models failed");
}

// Streaming variant: calls onDelta(text) for content as it arrives and assembles
// tool calls from streamed fragments. Same fallback/retry as complete().
export async function completeStream(client, { models, messages, tools, onDelta, effort, signal }) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (signal?.aborted) throw new Error("aborted");
        const body = {
          model,
          messages,
          tools,
          tool_choice: "auto",
          max_tokens: CONFIG.maxTokens,
          temperature: CONFIG.temperature,
          stream: true,
          stream_options: { include_usage: true },
        };
        if (effort) body.reasoning_effort = effort;
        const stream = await client.chat.completions.create(body, signal ? { signal } : undefined);
        let content = "";
        const acc = [];
        let usage = null;
        let responseId = null;
        let trace = null;
        for await (const chunk of stream) {
          if (chunk.id) responseId = responseId || chunk.id;
          if (chunk.usage) usage = chunk.usage;
          if (chunk.x_0g_trace) trace = chunk.x_0g_trace; // 0G TEE trace: provider node + request id

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            content += delta.content;
            if (onDelta) onDelta(delta.content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tcd of delta.tool_calls) {
              const i = tcd.index ?? 0;
              if (!acc[i]) acc[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tcd.id) acc[i].id = tcd.id;
              if (tcd.function?.name) acc[i].function.name = tcd.function.name;
              if (tcd.function?.arguments) acc[i].function.arguments += tcd.function.arguments;
            }
          }
        }
        const toolCalls = acc
          .filter(Boolean)
          .map((t, i) => ({ ...t, id: t.id || `call_${responseId || "s"}_${i}` }));
        const hasContent = content.trim().length > 0;
        if (!hasContent && toolCalls.length === 0) throw new Error("empty stream");
        const message = { role: "assistant", content: content || null };
        if (toolCalls.length) message.tool_calls = toolCalls;
        return { message, model, usage, responseId, trace };
      } catch (e) {
        lastErr = e;
        if (signal?.aborted) throw e; // user interrupt: do not retry or fall back
        const status = e?.status;
        if (status === 503) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        if (status === 429) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr || new Error("all models failed");
}
