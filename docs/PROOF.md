# Proof of concept (recorded 2026-07-11)

z0gcode runs today. Two recorded end-to-end runs against the live 0G Compute Router (mainnet), with the default model `0gm-1.0-35b-a3b` (0G's own coding model). All reasoning and tool selection was served by 0G.

## Run 1: a real coding task (write + run + verify)

Command (in an empty directory):
```
z0g --auto "Create fib.py that prints the first 10 Fibonacci numbers, then run it with python3 and confirm the output is correct."
```
Transcript:
```
● z0gcode  coding agent · brain on 0G Compute
  model 0gm-1.0-35b-a3b  ·  https://router-api.0g.ai/v1

→ write_file fib.py
  ✓ wrote fib.py (235 bytes)
→ run_bash python3 fib.py
  ✓ bash exit 0

Done. fib.py prints [0, 1, 1, 2, 3, 5, 8, 13, 21, 34], the correct first 10 Fibonacci numbers.
```
The agent wrote the file, ran it, read the output, and confirmed correctness on its own.

## Run 2: 0G expertise (uses a bundled skill)

Command (in an empty directory):
```
z0g "Create a hardhat.config.js to deploy a contract to 0G Chain MAINNET. Follow 0G's specific requirements exactly (read the relevant 0G skill first). Read PRIVATE_KEY from env, never hardcode it."
```
Transcript:
```
  › read_skill chain
    ✓ skill: chain
  › list_dir .
  › write_file hardhat.config.js
    ✓ wrote hardhat.config.js (674 bytes)
  › write_file .env.example
  › write_file .gitignore
```
The generated `hardhat.config.js` correctly set the **non-obvious** 0G requirement `evmVersion: "cancun"`, solidity `0.8.24`, chainId `16661`, RPC `https://evmrpc.0g.ai`, and read `PRIVATE_KEY` from env (never hardcoded). It also created `.env.example` and `.gitignore` without being asked, a security best practice. A model without the 0G skill would typically miss the `cancun` requirement.

## Router / tool-calling check

```
npm run verify
```
calls the Router directly and confirms tool-calling on the 0G coding models (`0gm-1.0-35b-a3b`, `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`) in streaming and non-streaming. All returned valid, parseable tool calls.
