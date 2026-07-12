// 0G skills: accurate, bundled knowledge about building on the 0G stack.
// The detailed pattern docs live in skills/0g/ and are read on demand by the agent.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "0g");

const SKILL_FILES = {
  chain: "CHAIN.md",
  compute: "COMPUTE.md",
  storage: "STORAGE.md",
  network: "NETWORK_CONFIG.md",
  security: "SECURITY.md",
  testing: "TESTING.md",
};

export function listSkills() {
  return Object.keys(SKILL_FILES).filter((k) => existsSync(path.join(SKILLS_DIR, SKILL_FILES[k])));
}

export function readSkill(name) {
  const file = SKILL_FILES[String(name || "").toLowerCase()];
  if (!file) return null;
  const p = path.join(SKILLS_DIR, file);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// Concise, accurate 0G primer injected into every session's system prompt.
export const SYSTEM_0G = `
You are an expert at building on 0G. Key facts (call read_0g_skill for full patterns):

- Your OWN inference runs on the 0G Compute Router (OpenAI-compatible, TEE-backed, private + verifiable). Mainnet: https://router-api.0g.ai/v1. Any app can use it by pointing an OpenAI client at that base_url with a 0G API key.
- 0G Chain: EVM-compatible L1. Mainnet chainId 16661, RPC https://evmrpc.0g.ai, explorer https://chainscan.0g.ai. Testnet "Galileo" chainId 16602, RPC https://evmrpc-testnet.0g.ai. CRITICAL: compile contracts with evmVersion "cancun" and solidity 0.8.24; use ethers v6 (NOT v5). Deploy with Hardhat or Foundry.
- 0G Storage: decentralized storage. SDK @0gfoundation/0g-storage-ts-sdk (ZgFile + Indexer; this is the mainnet-current package, the older @0glabs/0g-ts-sdk reverts on mainnet submit). Upload returns a Merkle root hash; always close the file handle. Mainnet indexer https://indexer-storage-turbo.0g.ai, testnet https://indexer-storage-testnet-turbo.0g.ai.
- 0G Compute (to consume inference from an app): SDK @0glabs/0g-serving-broker with createZGComputeNetworkBroker(wallet), or simply the OpenAI SDK against the Router.
- You can publish an artifact to 0G Storage yourself with the upload_0g_storage tool (needs --auto and a funded ZOG_WALLET_KEY); it returns a content root hash.
- Security: never hardcode private keys; read them from env (PRIVATE_KEY) and keep .env in .gitignore.

Skills available via read_0g_skill: ${Object.keys(SKILL_FILES).join(", ")}.
`.trim();
