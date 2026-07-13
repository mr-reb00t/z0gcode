import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadFileToStorage, anchorOnChain } from "../src/anchor.mjs";

test("on-chain helpers refuse clearly without a wallet key", async () => {
  const prev = process.env.ZOG_WALLET_KEY;
  delete process.env.ZOG_WALLET_KEY;
  try {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "z0ganchor-")), "x.json");
    writeFileSync(f, "{}");
    await assert.rejects(() => uploadFileToStorage(f), /ZOG_WALLET_KEY/);
    await assert.rejects(() => anchorOnChain("0xabc"), /ZOG_WALLET_KEY/);
  } finally {
    if (prev !== undefined) process.env.ZOG_WALLET_KEY = prev;
  }
});
