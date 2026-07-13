// Mint a verifiable z0gcode session as an NFT on 0G Chain. Each token records
// the 0G Storage content root of the session bundle, so an AI work session
// becomes an ownable, provable asset. ERC-721 based, ERC-7857-inspired.
// Needs a funded ZOG_WALLET_KEY and on-chain enabled.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const rpc = () => process.env.ZOG_EVM_RPC || "https://evmrpc.0g.ai";

function requireKey() {
  const key = process.env.ZOG_WALLET_KEY;
  if (!key) throw new Error("Set ZOG_WALLET_KEY to a funded 0G mainnet private key.");
  return key;
}

function artifact() {
  const p = new URL("../contracts/Z0gSession.json", import.meta.url);
  return JSON.parse(readFileSync(p, "utf8"));
}

const registryPath = (cwd) => path.join(cwd, ".z0g", "inft.json");

function loadRegistry(cwd) {
  try { return JSON.parse(readFileSync(registryPath(cwd), "utf8")); } catch { return {}; }
}

// Return the deployed contract address for this chain, deploying it once and
// caching it in .z0g/inft.json if needed. Returns { address, chainId, deployed }.
export async function deployOrLoad(cwd) {
  const key = requireKey();
  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(rpc());
  const wallet = new ethers.Wallet(key, provider);
  const chainId = Number((await provider.getNetwork()).chainId);

  const reg = loadRegistry(cwd);
  if (reg.address && reg.chainId === chainId) {
    // Confirm code is present at the cached address; redeploy if not.
    const code = await provider.getCode(reg.address);
    if (code && code !== "0x") return { address: reg.address, chainId, deployed: false };
  }

  const art = artifact();
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction()?.hash || null;
  writeFileSync(registryPath(cwd), JSON.stringify({ address, chainId, deployTx, contract: art.contractName }, null, 2) + "\n");
  return { address, chainId, deployed: true, deployTx };
}

// Mint a session token. Returns { contract, tokenId, txHash, block, deployed, deployTx }.
export async function mintSession(cwd, { root, uri, to }) {
  const key = requireKey();
  const { ethers } = await import("ethers");
  const { address, deployed, deployTx } = await deployOrLoad(cwd);
  const provider = new ethers.JsonRpcProvider(rpc());
  const wallet = new ethers.Wallet(key, provider);
  const art = artifact();
  const c = new ethers.Contract(address, art.abi, wallet);
  const owner = to || wallet.address;
  const tx = await c.mint(owner, root, uri || "");
  const receipt = await tx.wait();

  let tokenId = null;
  const iface = new ethers.Interface(art.abi);
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "Minted") { tokenId = parsed.args.tokenId.toString(); break; }
    } catch { /* not our event */ }
  }
  return { contract: address, tokenId, txHash: tx.hash, block: receipt?.blockNumber, owner, deployed, deployTx };
}

export function inftRegistry(cwd) {
  return existsSync(registryPath(cwd)) ? loadRegistry(cwd) : null;
}
