// Compile contracts/Z0gSession.sol into contracts/Z0gSession.json (abi +
// bytecode). solc is a build-time tool only, not a runtime dependency:
//   npm i solc@0.8.24 --no-save && node scripts/compile-contract.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const solc = require("solc");

const source = readFileSync(new URL("../contracts/Z0gSession.sol", import.meta.url), "utf8");
const input = {
  language: "Solidity",
  sources: { "Z0gSession.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun", // 0G Chain requires cancun
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts["Z0gSession.sol"].Z0gSession;
const artifact = {
  contractName: "Z0gSession",
  abi: c.abi,
  bytecode: "0x" + c.evm.bytecode.object,
  solc: solc.version(),
  evmVersion: "cancun",
};
writeFileSync(new URL("../contracts/Z0gSession.json", import.meta.url), JSON.stringify(artifact, null, 2) + "\n");
console.log("wrote contracts/Z0gSession.json ·", solc.version(), "· bytecode", artifact.bytecode.length / 2 - 1, "bytes");
