// MCP client: connect to configured MCP servers (.z0g/mcp.json) and expose their
// tools to the agent, so z0gcode becomes a hub for 0G and third-party MCP tools.
// The SDK is an optional dependency: if it or the config is missing, MCP is skipped.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const CONFIG = (cwd) => path.join(cwd, ".z0g", "mcp.json");
const PREFIX = "mcp_";

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);

// Returns null (MCP disabled) or { tools, isMcp, call, close, count }.
export async function loadMcp(cwd) {
  const cfgPath = CONFIG(cwd);
  if (!existsSync(cfgPath)) return null;
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {
    return null;
  }
  const servers = cfg.servers || cfg.mcpServers || {};
  if (!Object.keys(servers).length) return null;

  let Client, StdioClientTransport;
  try {
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js"));
  } catch {
    return null; // SDK not installed
  }

  const routes = {}; // agentToolName -> { client, remote }
  const tools = [];
  const conns = [];

  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || !spec.command) continue;
    try {
      const transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args || [],
        env: { ...process.env, ...(spec.env || {}) },
      });
      const client = new Client({ name: "z0gcode", version: "0.2.0" }, { capabilities: {} });
      await client.connect(transport);
      conns.push(client);
      const res = await client.listTools();
      for (const t of res.tools || []) {
        const toolName = `${PREFIX}${sanitize(name)}__${sanitize(t.name)}`;
        routes[toolName] = { client, remote: t.name };
        tools.push({
          type: "function",
          function: {
            name: toolName,
            description: `[MCP:${name}] ${t.description || t.name}`,
            parameters: t.inputSchema && t.inputSchema.type ? t.inputSchema : { type: "object", properties: {} },
          },
        });
      }
    } catch {
      // skip a server that fails to start/connect
    }
  }

  return {
    tools,
    count: tools.length,
    isMcp: (name) => !!routes[name],
    async call(name, args) {
      const r = routes[name];
      if (!r) return { ok: false, summary: `mcp ${name} not found`, content: "unknown MCP tool" };
      try {
        const out = await r.client.callTool({ name: r.remote, arguments: args || {} });
        const text = (out.content || [])
          .map((x) => (x.type === "text" ? x.text : JSON.stringify(x)))
          .join("\n");
        return { ok: !out.isError, summary: `mcp ${name}`, content: text || "OK" };
      } catch (e) {
        return { ok: false, summary: `mcp ${name} error`, content: `ERROR: ${e.message}` };
      }
    },
    async close() {
      for (const c of conns) {
        try {
          await c.close();
        } catch {}
      }
    },
  };
}
