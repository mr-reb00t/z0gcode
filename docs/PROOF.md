# Proof of concept (recorded 2026-07-13)

z0gcode runs today, end to end, against the live 0G Compute Router and 0G Chain (mainnet), with the default model `0gm-1.0-35b-a3b` (0G's own coding model). All reasoning and tool selection is served by 0G. Every hash and address below is real and on-chain; explorer base is `https://chainscan.0g.ai`.

## 1. A real coding task (write + run + verify)

```
z0g --auto "write an isPrime(n) function in prime.js, then verify it with node"
```
The agent wrote `prime.js` (a 6k+/-1 implementation), ran `node prime.js`, read the output, and confirmed all 13 test cases passed, on its own. Served by `0gm-1.0-35b-a3b` on 0G Compute (TEE).

## 2. 0G expertise (uses a bundled skill)

```
z0g "Create a hardhat.config.js to deploy a contract to 0G Chain MAINNET. Follow 0G's specific requirements exactly (read the relevant 0G skill first). Read PRIVATE_KEY from env, never hardcode it."
```
The generated config correctly set the non-obvious 0G requirement `evmVersion: "cancun"`, solidity `0.8.24`, chainId `16661`, RPC `https://evmrpc.0g.ai`, and read `PRIVATE_KEY` from env. It also created `.env.example` and `.gitignore` unprompted. A model without the 0G skill typically misses `cancun`.

## 3. Verifiable session on 0G (share + anchor)

`z0g share --anchor` bundled a real session (transcript + provenance) and put it on 0G:

- 0G Storage content root: `0xb67f4960f1e07d67fa00de643013e57d238697a1809e48471424e7b0831c5868`
- Storage tx: [`0x06243e1c...c340a07f`](https://chainscan.0g.ai/tx/0x06243e1cd91bfe3108ac3364ef5498f89b23f25aebf1721e123bfe6bc340a07f)
- Anchor tx (root written to 0G Chain, block 38686571): [`0xa2348022...8aa695d7`](https://chainscan.0g.ai/tx/0xa234802221353a12798087ee593fa390c49e9be46f1d453a11a7ef378aa695d7)

### Privacy round-trip (encrypted, only the owner reads it)

The bundle is encrypted client-side before upload, so 0G Storage being public does not expose it. Verified on mainnet with a real encrypted session (root `0x884b3378...2c20736b`):

```
z0g share --onchain            -> 0G Storage root ...2c20736b (encrypted)
z0g pull <root>   (owner)      -> content root verified · decrypted with your wallet · 5 messages
z0g pull <root>   (other key)  -> content root verified · decryption failed: encrypted for a different wallet
```
The non-owner still gets authentic, root-checked bytes; it just cannot read them. That is the point: public storage, private content.

## 4. Session INFT on 0G Chain (z0g mint)

`z0g mint` deployed the session NFT (`contracts/Z0gSession.sol`) and minted a token bound to that Storage root:

- Contract: [`0xF778AFd0e43a83161A121C095a7578d4958D39DE`](https://chainscan.0g.ai/address/0xF778AFd0e43a83161A121C095a7578d4958D39DE)
- Deploy tx: [`0x72609787...50b4335`](https://chainscan.0g.ai/tx/0x72609787e1b5c3b972e78af2fbe27ab014aee12bcd1eaeb5a52af1c9d50b4335)
- Mint tx: [`0x99e39c79...503fabc9`](https://chainscan.0g.ai/tx/0x99e39c7994d122986d8b8fcd174d11d23424229395cfdf5dd83474ab503fabc9)
- Token `#1`, owner `0xd439F6b5fCa7be8d7992Fa2e50C3EF5833f31B8a`

On-chain reads confirm it is a real, standards-compliant NFT that carries the session:

```
name/symbol:  z0gcode Session / Z0GS
ownerOf(1):   0xd439F6b5fCa7be8d7992Fa2e50C3EF5833f31B8a
sessionRoot(1): 0xb67f4960...831c5868   (== the 0G Storage root from step 3)
supportsInterface(0x80ac58cd ERC721): true
```

## 5. Honest TEE provenance (the 0G node that served each change)

Each 0G response carries an `x_0g_trace`. z0gcode records it in the provenance manifest and `z0g attest` shows it, so "TEE" is evidence, not a claim:

```
0G node 0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9   req e14eb716-a3fb-4a49-94ec-643a20026deb
```

## 6. Parallel write subagents (git worktree isolation)

`spawn_write_subagents` split one task into three, each editing in its own git worktree in parallel, then merged the diffs into the working tree:

```
> spawn_write_subagents 3 parallel, write · isolated git worktrees
    ok Create math.js   ok Create str.js   ok Create arr.js
```
All three files landed in the tree, and `z0g undo` (which checkpoints the merged edits) reverted all three.

## Router / tool-calling check

```
npm run verify
```
calls the Router directly and confirms tool-calling on the 0G coding models (`0gm-1.0-35b-a3b`, `deepseek-v4-pro`, `glm-5.2`, `kimi-k2.7-code`) in streaming and non-streaming. All returned valid, parseable tool calls.

Note: the wallet above is a throwaway test wallet; on-chain actions are opt-in and never run without `--onchain` and a funded `ZOG_WALLET_KEY`.
