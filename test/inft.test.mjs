import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mintSession, deployOrLoad, inftRegistry } from "../src/inft.mjs";

test("mint helpers refuse clearly without a wallet key", async () => {
  const prev = process.env.ZOG_WALLET_KEY;
  delete process.env.ZOG_WALLET_KEY;
  try {
    const cwd = mkdtempSync(path.join(tmpdir(), "z0ginft-"));
    await assert.rejects(() => deployOrLoad(cwd), /ZOG_WALLET_KEY/);
    await assert.rejects(() => mintSession(cwd, { root: "0xabc" }), /ZOG_WALLET_KEY/);
  } finally {
    if (prev !== undefined) process.env.ZOG_WALLET_KEY = prev;
  }
});

test("inftRegistry is null before any mint", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0ginft-"));
  assert.equal(inftRegistry(cwd), null);
});
