// On-chain anchoring on 0G: upload a file to 0G Storage and anchor a hash on
// 0G Chain. Needs a funded ZOG_WALLET_KEY (a 0G mainnet private key).
const rpc = () => process.env.ZOG_EVM_RPC || "https://evmrpc.0g.ai";
const indexerUrl = () => process.env.ZOG_STORAGE_INDEXER || "https://indexer-storage-turbo.0g.ai";

function requireKey() {
  const key = process.env.ZOG_WALLET_KEY;
  if (!key) throw new Error("Set ZOG_WALLET_KEY to a funded 0G mainnet private key.");
  return key;
}

// Upload a file to 0G Storage. Returns { rootHash, txHash }.
export async function uploadFileToStorage(absPath) {
  const key = requireKey();
  const { ethers } = await import("ethers");
  const { ZgFile, Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const provider = new ethers.JsonRpcProvider(rpc());
  const wallet = new ethers.Wallet(key, provider);
  const indexer = new Indexer(indexerUrl());
  const file = await ZgFile.fromFilePath(absPath);
  try {
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) throw new Error(String(treeErr));
    const root = tree.rootHash();
    const [res, upErr] = await indexer.upload(file, rpc(), wallet);
    if (upErr) throw new Error(upErr.message || String(upErr));
    return { rootHash: res?.rootHash || root, txHash: res?.txHash || res };
  } finally {
    await file.close();
  }
}

// Anchor a hash on 0G Chain via a small memo transaction. Returns { txHash, block }.
export async function anchorOnChain(hash) {
  const key = requireKey();
  const { ethers } = await import("ethers");
  const provider = new ethers.JsonRpcProvider(rpc());
  const wallet = new ethers.Wallet(key, provider);
  const data = "0x" + Buffer.from("z0gcode session " + hash, "utf8").toString("hex");
  const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n, data });
  const receipt = await tx.wait();
  return { txHash: tx.hash, block: receipt?.blockNumber };
}
