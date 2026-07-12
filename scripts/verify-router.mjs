// Verifies that the 0G Compute Router serves tool-calling (streaming + non-streaming).
// This is the proof that z0gcode's "brain runs on 0G" is real.
//   ZOG_API_KEY=sk-... node scripts/verify-router.mjs --list
//   ZOG_API_KEY=sk-... node scripts/verify-router.mjs 0gm-1.0-35b-a3b deepseek-v4-pro
// Testnet: ZOG_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
import OpenAI from "openai";

const BASE_URL = process.env.ZOG_BASE_URL || "https://router-api.0g.ai/v1";
const API_KEY = process.env.ZOG_API_KEY;
if (!API_KEY) { console.error("Missing ZOG_API_KEY"); process.exit(1); }

const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

const tools = [{
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a project file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
}];
const messages = [{ role: "user", content: "Create a file hello.txt with the text 'hola 0g' using the write_file tool. Call the tool, do not explain." }];

async function listModels() {
  const res = await client.models.list();
  const rows = res.data || [];
  console.log(`Models: ${rows.length}`);
  for (const m of rows) {
    const t = (m.supported_parameters || []).includes("tools") ? "tools" : "-";
    console.log(`  ${m.id.padEnd(24)} ${t.padEnd(6)} ctx=${m.context_length ?? "?"} type=${m.type ?? "?"}`);
  }
}

async function testStreaming(model) {
  const stream = await client.chat.completions.create({ model, stream: true, max_tokens: 16384, messages, tools });
  let name = "", args = "", text = "";
  for await (const ch of stream) {
    const d = ch.choices?.[0]?.delta;
    if (d?.tool_calls?.length) { name ||= d.tool_calls[0]?.function?.name || ""; args += d.tool_calls[0]?.function?.arguments || ""; }
    if (d?.content) text += d.content;
  }
  let parsed = null; try { parsed = args ? JSON.parse(args) : null; } catch { /* malformed */ }
  return { name, args, parsed, textLen: text.length };
}

async function testNonStreaming(model) {
  const r = await client.chat.completions.create({ model, stream: false, max_tokens: 16384, messages, tools });
  const tc = r.choices?.[0]?.message?.tool_calls?.[0];
  let parsed = null; try { parsed = tc ? JSON.parse(tc.function.arguments) : null; } catch { /* malformed */ }
  return { name: tc?.function?.name || "", args: tc?.function?.arguments || "", parsed, textLen: (r.choices?.[0]?.message?.content || "").length };
}

function verdict(r) {
  if (!r.name) return `NO TOOL CALL (falls back to chat, textLen=${r.textLen})`;
  if (r.parsed && r.parsed.path) return `TOOL OK -> ${r.name}(${JSON.stringify(r.parsed).slice(0, 80)})`;
  return `TOOL PARTIAL: ${r.name} malformed/incomplete args: ${r.args.slice(0, 80)}`;
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.length === 0) { await listModels(); return; }
  for (const model of args) {
    process.stdout.write(`\n=== ${model} ===\n`);
    for (const [mode, fn] of [["streaming", testStreaming], ["no-streaming", testNonStreaming]]) {
      const t0 = Date.now();
      try { const r = await fn(model); console.log(`  ${mode.padEnd(13)} ${verdict(r)}  (${Date.now() - t0}ms)`); }
      catch (e) { console.log(`  ${mode.padEnd(13)} ERROR ${e.status ?? ""} ${e.message}`); }
    }
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
