// MCP server mode: expose z0gcode's 0G tools so other agents (Claude Code, Cursor,
// another z0gcode) can use them. Stdio transport, so nothing may be written to
// stdout except the MCP protocol; logs go to stderr.
import { TOOL_DEFS, makeExecutor } from "./tools.mjs";

// The 0G-native tools worth exposing to other agents.
const EXPOSE = new Set(["read_skill", "upload_0g_storage"]);

export async function startMcpServer({ cwd, allowBash }) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  const exposed = TOOL_DEFS.filter((t) => EXPOSE.has(t.function.name));
  const execute = makeExecutor({ cwd, allowBash });

  const server = new Server({ name: "z0gcode", version: "0.2.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposed.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (!EXPOSE.has(name)) {
      return { content: [{ type: "text", text: `tool ${name} is not exposed` }], isError: true };
    }
    const res = await execute(name, args || {});
    return { content: [{ type: "text", text: String(res.content ?? (res.ok ? "OK" : "ERROR")) }], isError: !res.ok };
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write(`z0gcode MCP server ready (tools: ${exposed.map((t) => t.function.name).join(", ")})\n`);
}
