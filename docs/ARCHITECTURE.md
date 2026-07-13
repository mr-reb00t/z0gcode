# Architecture

z0gcode is a small, dependency-light coding agent (Node.js, one runtime dependency: the OpenAI SDK, used purely as an OpenAI-compatible HTTP client; `ethers` and the 0G Storage SDK are optional and loaded only for on-chain actions). Everything else is original.

```
bin/z0g.mjs        CLI: run / goal / init / models / doctor / attest / undo / checkpoints /
  │                     share / mint / image / transcribe / serve / interactive REPL; flags; branding
  └─ src/agent.mjs      the agentic loop (reason -> call tools -> feed results -> repeat)
       ├─ src/client.mjs      robust 0G Compute Router client (fallback, retry, empty-guard, usage, id, x_0g_trace)
       ├─ src/tools.mjs       tools: search_files, read_file, write_file, edit_file, list_dir, run_bash,
       │                      upload_0g_storage, deploy_0g_chain, update_plan, read_skill,
       │                      spawn_subagents, spawn_write_subagents, generate_image, transcribe_audio
       ├─ src/provenance.mjs  writes .z0g/.../provenance.json (change hash <-> 0G model, response id, TEE node)
       ├─ src/checkpoints.mjs writes .z0g/.../checkpoints.jsonl (per-turn edits, powers z0g undo)
       ├─ src/context.mjs     auto-loads AGENTS.md / .z0g/context.md into the system prompt; z0g init
       ├─ src/commands.mjs    custom slash commands (.z0g/commands/*.md) + lifecycle hooks (.z0g/hooks.json)
       ├─ src/worktree.mjs    git worktree isolation + patch merge for parallel WRITE subagents
       ├─ src/anchor.mjs      0G Storage upload + 0G Chain anchor (verifiable session)
       ├─ src/inft.mjs        deploy + mint the session NFT (contracts/Z0gSession.sol)
       ├─ src/media.mjs       image generation (z-image-turbo) + transcription (whisper), with cost
       ├─ src/skills.mjs      0G knowledge: system primer + loader for skills/0g/*.md
       ├─ src/user-skills.mjs user skills: discover ~/.z0gcode/skills + .z0g/skills, inject + read
       ├─ src/mcp.mjs / mcp-server.mjs   MCP both ways: consume external tools, expose z0g's tools
       ├─ src/models-info.mjs model catalog: fetch + normalize /v1/models (price, ctx, TEE, discount)
       ├─ src/prompt.mjs      arrowSelect: raw-mode arrow-key picker (used by /model and /chats)
       ├─ src/sessions.mjs    multiple chats per project (.z0g/sessions/<id>/, resume picker)
       ├─ src/settings.mjs    ~/.z0gcode/settings.json (model, effort, subagents, onchain, disabled skills)
       ├─ src/config.mjs      defaults (0G baked in: router URL, model 0gm-1.0, fallbacks, toggles)
       └─ src/ui.mjs          ANSI UI: palette, glyphs, tables, colored diffs, syntax highlighting, HUD, banner
  skills/0g/*.md     bundled 0G stack patterns (chain, compute, storage, network, security, testing)
  contracts/         Z0gSession.sol (ERC-721 session NFT) + its compiled artifact
```

## Axis A: the brain runs on 0G

`src/client.mjs` points the OpenAI SDK at `https://router-api.0g.ai/v1` with the user's 0G API key. Default model `0gm-1.0-35b-a3b` (0G's in-house coding model, TEE, private + verifiable). Because the Router does not switch models on `503 no_providers_available`, the client adds app-level fallback across `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`, plus retry/backoff and an empty-response guard. It also captures the `x_0g_trace` each response carries (the on-chain provider node that served the request and a 0G request id).

## Axis B: expert on 0G

`src/skills.mjs` injects a concise, accurate 0G primer into the system prompt (network params, SDK packages, the `evmVersion: "cancun"` requirement, storage/compute usage) and exposes `read_skill(name)` so the agent can pull the full pattern docs from `skills/0g/` on demand. That is why it writes correct 0G code instead of plausible-but-wrong code.

The same `read_skill` tool also serves **user skills** (`src/user-skills.mjs`): markdown files with `name`/`description` frontmatter from `~/.z0gcode/skills` (global) and `.z0g/skills` (project). Descriptions are injected so the model knows when to load one, and the body is read on demand: the same progressive-disclosure model as Claude Code skills. Project context (`src/context.mjs`) auto-loads `AGENTS.md` and `.z0g/context.md` so the agent follows the repo's own conventions and commands; `z0g init` writes an `AGENTS.md` by analyzing the project. Tool-level extensibility is handled by MCP (`src/mcp.mjs` to consume, `src/mcp-server.mjs` to expose).

## Axis C: verifiable provenance, all the way to chain

Because the brain runs on 0G's verifiable inference, z0gcode can do what a closed-provider CLI cannot: bind each change to the model, and to the 0G node, that produced it.

- **Provenance** (`src/provenance.mjs`): per `write_file`/`edit_file`, records the SHA-256 before/after, the 0G model id, the response id, and the `tee_trace` (the on-chain **provider node address** and 0G request id from `x_0g_trace`) into `.z0g/.../provenance.json`. `z0g attest` surfaces it.
- **Private, verifiable session** (`src/anchor.mjs` + `src/crypto.mjs`): `z0g share` bundles the transcript + provenance, encrypts it with AES-256-GCM under a key derived from the wallet private key (`hkdf-sha256`), and uploads the ciphertext to 0G Storage (returning a content root); `z0g share --anchor` writes that root to 0G Chain. Because 0G Storage is public and the root becomes public on-chain, encryption is what makes it private: only that wallet can decrypt. `z0g pull <root>` downloads by root, recomputes and checks the Merkle root against 0G Storage, then decrypts with the wallet; a different wallet gets authentic bytes it cannot read.
- **Session INFT** (`src/inft.mjs` + `contracts/Z0gSession.sol`): `z0g mint` deploys a minimal ERC-721 once per project and mints a token whose `sessionRoot` is the 0G Storage content root, making an AI work session an ownable, provable asset.

All on-chain actions are **off by default** and opt-in (`--onchain`, `/onchain on`, or `ZOG_ONCHAIN=on`, plus a funded `ZOG_WALLET_KEY`); when off, the agent is never even offered the gas-spending tools. Honest scope: cryptographic verification of the full TEE quote, and full ERC-7857 (encrypted metadata + oracle transfer), remain roadmap.

## The loop (`src/agent.mjs`)

1. Build messages: system prompt (agent rules + 0G primer + project context) + user task.
2. Call the model (streaming) with the tool set, filtered by the active toggles (subagents, on-chain).
3. If the reply has tool calls: execute each (parsing args defensively), record provenance + checkpoints on edits, append results, continue. `spawn_subagents` and `spawn_write_subagents` are routed specially into parallel isolated agents.
4. If the reply has no tool calls: print the summary and stop.
5. Guards: max steps, defensive JSON parse with light repair, a loop breaker on repeated identical calls, and model escalation when a tool keeps failing.

## Parallel subagents

`spawn_subagents` fans out independent **read-only** subtasks as isolated agents (capped by `ZOG_MAX_PARALLEL`); the parent synthesizes their summaries. `spawn_write_subagents` (with `--auto`, in a git repo) fans out **write** subtasks, each in its own git worktree branched from HEAD (`src/worktree.mjs`); each diff is merged back into the working tree (non-overlapping edits merge, overlapping ones are reported and skipped) and the merged edits are checkpointed so `z0g undo` reverts them.

## Design choices

- **Owned, not forked:** the agent is original code, so there is zero dependency on an upstream framework's release cadence and the repo stays clean and small. Inspired by OpenCode and Claude Code (see NOTICE).
- **0G by default:** no config file, no OpenAI/Anthropic key. `z0g` just works against 0G once `ZOG_API_KEY` is set.
- **Safety:** file ops run always; `run_bash` requires `--auto`; on-chain actions require an explicit opt-in; paths are constrained to the working directory; secrets are never printed and never hardcoded.
- **Dependency-light:** one runtime dependency (OpenAI SDK) plus the MCP SDK; `ethers` and the 0G Storage SDK are optional and dynamically imported only when an on-chain action runs, so the core installs and tests without them.
