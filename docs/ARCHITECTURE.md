# Architecture

z0gcode is a small, dependency-light coding agent (Node.js, one runtime dependency: the OpenAI SDK, used purely as an OpenAI-compatible HTTP client). Everything else is original.

```
bin/z0g.mjs        CLI: run / models / doctor / attest / interactive; flags; branding
  └─ src/agent.mjs      the agentic loop (reason → call tools → feed results → repeat)
       ├─ src/client.mjs      robust 0G Compute Router client (fallback, retry, empty-guard, usage+id)
       ├─ src/tools.mjs       tools: search_files, read_file, write_file, edit_file, list_dir,
       │                      run_bash, upload_0g_storage, deploy_0g_chain, update_plan, read_skill
       ├─ src/provenance.mjs  writes .z0g/provenance.json (change hash ↔ 0G model + response id)
       ├─ src/skills.mjs      0G knowledge: system primer + loader for skills/0g/*.md
       ├─ src/user-skills.mjs user skills: discover ~/.z0gcode/skills + .z0g/skills, inject + read
       ├─ src/models-info.mjs model catalog: fetch + normalize /v1/models (price, ctx, TEE, discount)
       ├─ src/prompt.mjs      arrowSelect: raw-mode arrow-key picker (used by /model)
       ├─ src/settings.mjs    ~/.z0gcode/settings.json (model choice, disabled skills)
       ├─ src/config.mjs      defaults (0G baked in: router URL, model 0gm-1.0, fallbacks)
       └─ src/ui.mjs          ANSI UI: palette roles, glyphs, tables, colored diffs, HUD, banner
  skills/0g/*.md     bundled 0G stack patterns (chain, compute, storage, network, security, testing)
  openspec/          spec-driven change proposals (OpenSpec)
```

## Axis A: the brain runs on 0G

`src/client.mjs` points the OpenAI SDK at `https://router-api.0g.ai/v1` with the user's 0G API key. Default model `0gm-1.0-35b-a3b` (0G's in-house coding model, TEE, private + verifiable). Because the Router does not switch models on `503 no_providers_available`, the client adds app-level fallback across `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`, plus retry/backoff and an empty-response guard.

## Axis B: expert on 0G

`src/skills.mjs` injects a concise, accurate 0G primer into the system prompt (network params, SDK packages, the `evmVersion: "cancun"` requirement, storage/compute usage) and exposes `read_skill(name)` so the agent can pull the full pattern docs from `skills/0g/` on demand. That is why it writes correct 0G code instead of plausible-but-wrong code.

The same `read_skill` tool also serves **user skills** (`src/user-skills.mjs`): markdown files with `name`/`description` frontmatter discovered from `~/.z0gcode/skills` (global) and `.z0g/skills` (project). Their descriptions are injected into the system prompt (so the model knows when to load one) and the body is read on demand, the same progressive-disclosure model as Claude Code skills. Tool-level extensibility is separate and handled by MCP (`src/mcp.mjs` to consume, `src/mcp-server.mjs` to expose).

## Axis C: verifiable provenance

Because the brain runs on 0G's verifiable inference, z0gcode can do what a closed-provider CLI cannot: bind each change to the model that produced it. `src/provenance.mjs` records, per `write_file`/`edit_file`, the SHA-256 before/after, the 0G model id, and the response id into `.z0g/provenance.json`; `z0g attest` surfaces it. Honest scope: model id and response id are captured from 0G Compute (TEE); local verification of the full TEE quote and on-chain anchoring are roadmap.

## The loop (`src/agent.mjs`)

1. Build messages: system prompt (agent rules + 0G primer) + user task.
2. Call the model with the tool set.
3. If the reply has tool calls: execute each (parsing args defensively), append results, continue.
4. If the reply has no tool calls: print the summary and stop.
5. Guards: max steps, defensive JSON parse with light repair, and a loop breaker that stops if the same tool call repeats.

## Design choices

- **Owned, not forked:** the agent is original code, so there is zero dependency on an upstream framework's release cadence and the repo stays clean and small. Inspired by OpenCode and Claude Code (see NOTICE).
- **0G by default:** no config file, no OpenAI/Anthropic key. `z0g` just works against 0G once `ZOG_API_KEY` is set.
- **Safety:** file ops run always; `run_bash` requires `--auto`; paths are constrained to the working directory; secrets are never printed and never hardcoded.
