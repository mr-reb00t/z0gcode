# z0gcode

<p align="center">
  <img src="assets/logo/z0gcode-banner.svg" alt="z0gcode: coding agent on 0G" width="480">
</p>

<p align="center">
  <b>A terminal coding agent whose brain runs on <a href="https://0g.ai">0G Compute</a>.</b><br>
  Private, verifiable AI for developers, powered by 0G's own coding model, and an expert at building on the 0G stack.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-A78BFF" alt="MIT license">
  <img src="https://img.shields.io/badge/node-18%2B-6B7080" alt="Node 18+">
  <img src="https://img.shields.io/badge/brain-0G_Compute_TEE-A78BFF" alt="0G Compute">
  <img src="https://img.shields.io/badge/runtime_deps-1-6B7080" alt="1 runtime dependency">
  <img src="https://img.shields.io/badge/ETHGlobal-Lisbon-A78BFF" alt="ETHGlobal Lisbon">
</p>

Built by **Andrei & Claude** for the 0G track at ETHGlobal Lisbon (Track 2: Infrastructure & Tooling).

```
  › read_skill chain
    ✓ skill: chain
  › write_file hardhat.config.js
    ✓ wrote hardhat.config.js (674 bytes)

Done. Configured for 0G Chain Mainnet: solidity 0.8.24, evmVersion "cancun"
(required by 0G Chain), chainId 16661, PRIVATE_KEY read from env.
```

The mark is a barred zero: the circle is the `0` of 0G and the violet slash is the `z` of z0g.

## Why z0gcode

Most coding agents ship your code and prompts to OpenAI or Anthropic. z0gcode sends them to **0G's decentralized, TEE-backed inference** instead, and three things follow, each carrying real weight:

1. **Its brain runs on 0G.** Every reasoning step and tool call is served by the [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview), private and verifiable (TEE), on 0G's own `0gm-1.0-35b-a3b` coding model. No OpenAI or Anthropic key, no data leaving to Big Tech, and open models at a fraction of the cost (compare with `z0g models`).
2. **It is an expert at building on 0G.** It ships with bundled 0G skills (chain, compute, storage, network, security, testing), so it writes correct 0G code including the non-obvious bits. In the demo above it knew, unprompted, that 0G Chain contracts must compile with `evmVersion: "cancun"`.
3. **It can prove which model wrote your code.** Because 0G inference is verifiable, `z0g attest` records a manifest binding each file change (before and after hash) to the exact 0G model and response id that produced it. A closed-provider CLI cannot do this.

The agent loop, tools, and CLI are original and dependency-light (one runtime dep). z0gcode is inspired by OpenCode and Claude Code; see [NOTICE](NOTICE).

## Quickstart

```bash
git clone https://github.com/mr-reb00t/z0gcode
cd z0gcode
npm install
npm link                    # optional: puts `z0g` on your PATH
export ZOG_API_KEY=<your 0G Router key from https://pc.0g.ai>
# or drop ZOG_API_KEY=... into a .env file (loaded automatically; see .env.example for all options)

z0g doctor                  # check key, connectivity, model
z0g "add a /health endpoint to server.js and test it"
```

No `npm link`? Run it with `node bin/z0g.mjs`. An `npm i -g z0gcode` package is on the way.

## Usage

```bash
z0g "add a /health endpoint to server.js and test it"   # one-shot task
z0g --auto "scaffold a Fastify app and run it"           # --auto allows shell commands (on-chain is a separate --onchain opt-in)
z0g goal --auto "make the failing tests pass"            # iterate until a verify command passes
z0g --continue "now add input validation"                # resume the most recent chat
z0g --resume                                             # pick a chat to resume (arrow-key picker)
z0g                                                      # interactive session (picks a chat if the project has any)
z0g models                                               # rich table of 0G models (add --json)
z0g skills                                               # list user/project skills (enable|disable)
z0g doctor                                               # check key, connectivity, model
z0g attest                                               # show which 0G model wrote which change
z0g image "a flat blue rocket icon" rocket.png           # generate an image on 0G (z-image-turbo)
z0g transcribe memo.mp3                                  # transcribe audio on 0G (whisper-large-v3)
z0g serve --mcp                                          # expose z0gcode's 0G tools over MCP
```

**In the REPL**, type `/` then **Tab** to autocomplete slash commands: `/chats`, `/new`, `/rename`, `/init`, `/goal`, `/model`, `/effort`, `/subagents`, `/onchain`, `/skills`, `/attest`, `/share`, `/plan`, `/verify`, `/clear`, `/help`, `/exit`. `/chats` opens an arrow-key session picker (type to search, `ctrl-r` rename, `ctrl-x` delete); `/new [title]` starts a chat and `/rename <title>` renames the current one. `/model` opens the model picker (saved to `~/.z0gcode/settings.json`); `/effort low|medium|high` (or `default`) tunes reasoning depth vs speed and cost; `/subagents on|off` toggles parallel subagents; `/onchain on|off` toggles gas-spending on-chain actions (off by default); `/skills` lists and toggles your skills; `/share [anchor]` exports the session to 0G Storage (and anchors it on 0G Chain). A short intro animation and a "thinking on 0G" indicator play on a color TTY; set `Z0G_NO_ANIM=1` to disable. Each turn is separated by a divider carrying a running session token and cost counter.

**Options:** `--auto`, `--onchain`, `--continue`, `--resume`, `--new`, `--model <id>`, `--effort low|medium|high`, `--no-subagents`, `--verify "<cmd>"`, `--auto-verify`, `--max-steps <n>`, `--cwd <dir>`, and `--json` (with `models`).

## Features

**The agent**
- Agentic loop with tools: `search_files` (regex + glob), `read_file`, `write_file`, `edit_file`, `list_dir`, `run_bash` (gated by `--auto`), `update_plan`, and `read_skill`.
- Colored diffs for every change, an inference HUD (tokens, answering model, `0G Compute (TEE)`), and a visible planning checklist on multi-step tasks.
- Streaming answers rendered as terminal markdown (bold, headings, lists, tables, inline code, and syntax-highlighted code blocks for JS/TS, Python, Solidity, Go, Rust, shell, JSON, and more); piped output stays raw and greppable.
- Multiple chats per project, each isolating its own history, plan, and provenance under `.z0g/sessions/`. On open, an arrow-key picker (with search, rename, delete) resumes a chat; `--continue` resumes the most recent, `--resume` shows the picker, `/chats` switches mid-session. Plus a goal loop (`z0g goal` re-runs until a verify command passes) and auto-verify.
- **Project context**: `AGENTS.md` (and `.z0g/context.md`) are auto-loaded into the agent's system prompt on every run, so it follows your conventions and uses your real build/test/run commands. `z0g init` (or `/init`) analyzes the repo and writes an accurate `AGENTS.md` for you.
- **Checkpoints and undo**: every file edit is logged with its before/after content per turn, so `z0g undo` (or `/undo`) reverts the last turn's changes (restoring files, deleting ones it created); `z0g checkpoints` lists what you can step back through.
- Reliability on a decentralized backend: app-level multi-model fallback, retry and backoff, tool-JSON repair, a loop breaker, and model escalation.
- **Parallel subagents**: `spawn_subagents` fans out independent, read-only subtasks (review many files, research, audit, map a codebase) as isolated agents running in parallel, capped by `ZOG_MAX_PARALLEL`. The parent synthesizes the results and each subagent's transcript is saved. With 0G's cheap inference, fanning out to many agents costs cents: massively parallel agents at 0G prices. On by default; toggle with `/subagents on|off` or `--no-subagents`.

**0G-native**
- `z0g models`: a live table from the Router (price in and out per 1M tokens, context, max output, TEE trust tier, savings vs the official API), grouped 0G-native, verifiable, and open, plus an arrow-key `/model` picker.
- Verifiable provenance with `z0g attest`, and a **verifiable session**: `z0g share` (or `/share`) bundles the transcript + provenance and uploads it to **0G Storage**, returning a content root; `z0g share --anchor` writes that hash to **0G Chain** so the snapshot is timestamped and immutable. Verified on 0G mainnet.
- Native on-chain actions, **off by default and opt-in** (enable with `--onchain`, `/onchain on`, or `ZOG_ONCHAIN=on`, plus a funded `ZOG_WALLET_KEY`): `upload_0g_storage` (publish to 0G Storage, returns a content root) and `deploy_0g_chain` (deploy a compiled contract, returns address + tx). When off, the agent is not offered these tools, so it never spends gas without your say-so. Both verified on 0G mainnet.
- Bundled 0G skills the agent reads on demand to write correct 0G code.
- **Media on 0G**: `generate_image` (and `z0g image "<prompt>" [out.png]`) creates PNGs with `z-image-turbo`; `transcribe_audio` (and `z0g transcribe <file>`) turns audio into text with `whisper-large-v3`. Same Router, same key, both private and verifiable on 0G.

**Extensible**
- **User skills** (Claude-Code-style): drop a markdown file with `name` and `description` frontmatter into `~/.z0gcode/skills/<name>.md` (global) or `.z0g/skills/<name>.md` (project, or `<name>/SKILL.md`). z0gcode discovers it, injects the description so the model knows when to use it, and loads the body on demand via `read_skill` (progressive disclosure). Manage with `z0g skills` and `/skills enable|disable <name>`.
- **MCP, both ways**: consume MCP servers (0G or third-party) via `.z0g/mcp.json` (their tools appear as `mcp_<server>__<tool>`), and run `z0g serve --mcp` to expose z0gcode's own 0G tools to other agents (Claude Code, Cursor).

## Running on 0G

- z0gcode points an OpenAI-compatible client at the 0G Compute Router with your 0G key. Default model `0gm-1.0-35b-a3b`; fallbacks `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`.
- The Router fails over across providers of the same model but does **not** switch models on `503`, so z0gcode adds an app-level multi-model fallback, retry and backoff, tool-JSON repair, and a loop breaker. See [src/client.mjs](src/client.mjs) and [src/agent.mjs](src/agent.mjs).

```bash
npm run verify   # calls the Router directly, confirms tool-calling on the 0G coding models
```

`upload_0g_storage` and `deploy_0g_chain` were exercised against 0G **mainnet**. See [docs/PROOF.md](docs/PROOF.md) for a recorded end-to-end run and [docs/MODELS.md](docs/MODELS.md) for the model catalog.

## Roadmap

Shipped: streaming with markdown rendering, multiple chat sessions per project (resume picker with search), planning, slash commands, the goal loop and auto-verify, in-agent `deploy_0g_chain` and `upload_0g_storage` (mainnet-verified, opt-in), the verifiable session (`z0g share` to 0G Storage + `--anchor` on 0G Chain, mainnet-verified), parallel subagents, media on 0G (image + transcription), MCP both ways, the model catalog and arrow-key picker, and user skills.

Next:
- INFT mint (ERC-7857) for the verifiable session snapshot.
- Full TEE-quote verification of the provenance manifest (not just model + response id).
- Publish `z0gcode` to npm; a shareable starter pack of user skills.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together.
- [docs/MODELS.md](docs/MODELS.md): 0G Router model catalog and model choice.
- [docs/PROOF.md](docs/PROOF.md): recorded, reproducible proof.

## Team

Mr Reboot.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
