# z0gcode

**A terminal coding agent whose brain runs on 0G Compute.** Private, verifiable AI for developers, powered by 0G's own coding model, and an expert at building on the 0G stack.

Built by **Andrei & Claude** for the 0G track at ETHGlobal Lisbon (Track 2: Infrastructure & Tooling).

```
█████   ███    ████
   ██  █  /█  █
  ██   █ / █  █  ██   z0gcode v0.2
 ██    █/  █  █   █   coding agent on 0G
█████   ███    ████
  model 0gm-1.0-35b-a3b  ·  https://router-api.0g.ai/v1

→ read_0g_skill chain
  ✓ 0G skill: chain
→ write_file hardhat.config.js
  ✓ wrote hardhat.config.js (674 bytes)

Done. Configured for 0G Chain Mainnet: solidity 0.8.24, evmVersion "cancun"
(required by 0G Chain), chainId 16661, PRIVATE_KEY read from env.
```

The mark is a barred zero: the circle is the `0` of 0G and the violet slash is the `z` of z0g. Logo assets (SVG icon, mark, lockup, favicon) live in [assets/logo/](assets/logo/).

## What it is

z0gcode is a small, self-contained coding agent for the terminal. Two things make it 0G-native, and both carry real weight:

- **Its brain runs on 0G.** Every reasoning step and tool call is served by the [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview), 0G's decentralized, TEE-backed (private and verifiable) inference. The default model is `0gm-1.0-35b-a3b`, 0G's own model optimized for agentic coding. No OpenAI or Anthropic key, no data leaving to Big Tech.
- **It is an expert at building on 0G.** It ships with bundled 0G skills (chain, compute, storage, network, security, testing), so it writes correct 0G code, including the non-obvious requirements. In the demo above it knew, unprompted, that 0G Chain contracts must be compiled with `evmVersion: "cancun"`.

It is not a rebrand of a big framework: the agent loop, tools, and CLI are original and dependency-light (one runtime dep). That keeps it fully ours, clean, and easy to maintain. It is inspired by OpenCode and Claude Code; see [NOTICE](NOTICE).

## Features

- **Agentic loop** with tools: `search_files` (regex + glob), `read_file`, `write_file`, `edit_file`, `list_dir`, `run_bash` (gated by `--auto`), and `read_0g_skill`.
- **Colored diffs**: every file change is shown as a green/red diff, so you can audit exactly what the agent did.
- **Inference HUD**: a footer after each turn with token usage, the answering model, and the `0G Compute (TEE)` marker.
- **Verifiable provenance (`z0g attest`)**: z0gcode records `.z0g/provenance.json` binding each change (before/after hash) to the 0G model and response id that produced it. A closed-provider CLI cannot prove which model wrote which code. Full TEE-quote verification is roadmap.
- **Native 0G action**: `upload_0g_storage` publishes an artifact to 0G Storage and returns its content root hash (behind `--auto` + `ZOG_WALLET_KEY`).
- **Reliability on a decentralized backend**: app-level multi-model fallback, retry/backoff, tool-JSON repair, a loop breaker, and model escalation (a stuck turn escalates to a stronger 0G model instead of looping).
- **Streaming**: the model's output streams token by token, so the agent feels alive.
- **Session memory**: the conversation persists per directory; `--continue` resumes it and the REPL keeps context across prompts.
- **Goal loop + slash commands**: `z0g goal "<objective>"` runs and re-runs until a verify command (e.g. `npm test`) passes; the REPL has `/goal`, `/model`, `/attest`, `/plan`, `/verify`, `/clear`, `/help`, `/exit`.
- **Planning**: on multi-step tasks the agent lays out a visible checklist (`update_plan`), updating it as it works; `/plan` shows it.
- **MCP client**: connect to MCP servers (0G or third-party) via `.z0g/mcp.json`; their tools appear to the agent as `mcp_<server>__<tool>`, turning z0gcode into a hub.

Feature proposals and specs live under [openspec/](openspec/) (OpenSpec, spec-driven).

## Install (from source)

```bash
git clone https://github.com/mr-reb00t/z0gcode
cd z0gcode
npm install
npm link            # optional: puts `z0g` on your PATH
export ZOG_API_KEY=<your 0G Router key from https://pc.0g.ai>
```

Without `npm link` you can run it with `node bin/z0g.mjs`. (An `npm i -g z0gcode` package is on the way.)

## Usage

```bash
z0g "add a /health endpoint to server.js and test it"   # one-shot task
z0g --auto "scaffold a Fastify app and run it"           # --auto allows shell commands
z0g goal --auto "make the failing tests pass"            # iterate until a verify command passes
z0g --continue "now add input validation"                # continue the saved session
z0g                                                      # interactive session (/help for commands)
z0g models                                               # list 0G models on the Router
z0g doctor                                               # check key, connectivity, model
z0g attest                                               # show which 0G model wrote which change
```

In the interactive session, slash commands give direct control: `/goal`, `/model`, `/attest`, `/verify`, `/clear`, `/help`, `/exit`.

Options: `--auto` (allow `run_bash` and on-chain actions), `--continue`, `--model <id>`, `--verify "<cmd>"`, `--max-steps <n>`, `--cwd <dir>`.

## How the brain runs on 0G

- The agent talks to the 0G Compute Router (OpenAI-compatible) with your 0G API key. Default model `0gm-1.0-35b-a3b`; fallbacks `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`.
- The Router fails over across providers of the same model but does **not** switch models on `503`, so z0gcode adds an app-level multi-model fallback, retry/backoff, tool-JSON repair, and a loop breaker. See [src/client.mjs](src/client.mjs) and [src/agent.mjs](src/agent.mjs).

## Verify it runs on 0G

```bash
npm run verify        # calls the Router directly, checks tool-calling on 0G coding models
```

See [docs/PROOF.md](docs/PROOF.md) for a recorded end-to-end run and [docs/MODELS.md](docs/MODELS.md) for the model catalog.

## Roadmap

- Streaming UI, conversation memory / session resume, planning checklist, slash commands (`/goal`, `/deploy`, ...).
- Deeper 0G ops: in-agent deploy to 0G Chain and INFT mint; anchor the provenance manifest on 0G Chain.
- Publish `z0gcode` to npm; contribute an OpenCode setup to `0gfoundation/0g-agent-skills`.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it fits together.
- [docs/MODELS.md](docs/MODELS.md) — 0G Router model catalog and model choice.
- [docs/PROOF.md](docs/PROOF.md) — recorded, reproducible proof of concept.

## Team

Mr Reboot.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
