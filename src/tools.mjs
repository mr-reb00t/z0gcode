// Tools the agent can call. File ops run always; bash and on-chain ops require --auto.
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { listSkills, readSkill } from "./skills.mjs";
import { savePlan } from "./plan.mjs";

const MAX_READ = 200_000; // chars
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".z0g", ".next", "build", "coverage", ".turbo"]);

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file and return its contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the working directory." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search the working directory for a JavaScript regular expression. Prefer this over reading whole files to locate code. Optional glob filters filenames (e.g. *.ts).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A JavaScript regular expression." },
          glob: { type: "string", description: "Optional filename glob, e.g. *.mjs" },
          path: { type: "string", description: "Optional subdirectory to search (default '.')" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Creates parent directories.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace the first exact occurrence of old_string with new_string in a file. old_string must be unique and match exactly.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List entries of a directory (non-recursive).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path (default '.')" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description: "Run a bash command in the working directory and return stdout, stderr and exit code. Only available with --auto.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upload_0g_storage",
      description: "Upload a file from the working directory to 0G Storage (decentralized) and return its content root hash. Writes on-chain: needs --auto and a funded ZOG_WALLET_KEY.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_0g_chain",
      description: "Deploy a compiled contract to 0G Chain mainnet (chainId 16661). Provide { bytecode, abi?, args? } or { artifact } (path to a Hardhat/Foundry JSON with abi+bytecode). Writes on-chain: needs --auto and a funded ZOG_WALLET_KEY.",
      parameters: {
        type: "object",
        properties: {
          bytecode: { type: "string", description: "Contract creation bytecode (0x...)" },
          abi: { type: "array", description: "Contract ABI (optional if no constructor args)" },
          args: { type: "array", description: "Constructor arguments" },
          artifact: { type: "string", description: "Path to a compiled artifact JSON (abi + bytecode)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description: "Lay out or update a checklist for a multi-step task. Call it at the start of non-trivial work and whenever a step's status changes. Keep exactly one step in_progress.",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["step", "status"],
            },
          },
        },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_0g_skill",
      description: "Read a bundled 0G skill doc for accurate SDK patterns. Names: chain, compute, storage, network, security, testing. Call with no name to list them.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    },
  },
];

function safeResolve(cwd, p) {
  const abs = path.resolve(cwd, p || ".");
  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes the working directory: ${p}`);
  }
  return abs;
}

export function makeExecutor({ cwd, allowBash }) {
  return async function execute(name, args) {
    try {
      switch (name) {
        case "read_file": {
          const abs = safeResolve(cwd, args.path);
          const buf = await fs.readFile(abs, "utf8");
          const text = buf.length > MAX_READ ? buf.slice(0, MAX_READ) + "\n… [truncated]" : buf;
          return { ok: true, summary: `read ${args.path} (${buf.length} bytes)`, content: text };
        }
        case "search_files": {
          const res = await searchFiles(cwd, args.query, args.glob, args.path);
          return { ok: true, summary: `search "${args.query}" (${res.count})`, content: res.text };
        }
        case "write_file": {
          const abs = safeResolve(cwd, args.path);
          let before = "";
          try { before = await fs.readFile(abs, "utf8"); } catch { before = ""; }
          await fs.mkdir(path.dirname(abs), { recursive: true });
          const after = args.content ?? "";
          await fs.writeFile(abs, after, "utf8");
          return { ok: true, summary: `wrote ${args.path} (${after.length} bytes)`, content: "OK", change: { path: args.path, before, after } };
        }
        case "edit_file": {
          const abs = safeResolve(cwd, args.path);
          const cur = await fs.readFile(abs, "utf8");
          if (!args.old_string || !cur.includes(args.old_string)) {
            return { ok: false, summary: `edit ${args.path} failed`, content: "old_string not found. Read the file and match exactly." };
          }
          if (cur.indexOf(args.old_string) !== cur.lastIndexOf(args.old_string)) {
            return { ok: false, summary: `edit ${args.path} ambiguous`, content: "old_string is not unique. Include more surrounding context." };
          }
          const next = cur.replace(args.old_string, args.new_string ?? "");
          await fs.writeFile(abs, next, "utf8");
          return { ok: true, summary: `edited ${args.path}`, content: "OK", change: { path: args.path, before: cur, after: next } };
        }
        case "list_dir": {
          const abs = safeResolve(cwd, args.path || ".");
          const entries = await fs.readdir(abs, { withFileTypes: true });
          const lines = entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).sort();
          return { ok: true, summary: `list ${args.path || "."} (${lines.length})`, content: lines.join("\n") || "(empty)" };
        }
        case "run_bash": {
          if (!allowBash) {
            return { ok: false, summary: "bash denied", content: "run_bash is disabled. Re-run z0gcode with --auto to allow shell commands." };
          }
          const out = await runBash(args.command, cwd);
          return { ok: out.code === 0, summary: `bash exit ${out.code}`, content: out.text };
        }
        case "upload_0g_storage": {
          return await uploadToStorage(cwd, args.path, allowBash);
        }
        case "deploy_0g_chain": {
          return await deployToChain(cwd, args, allowBash);
        }
        case "update_plan": {
          const plan = Array.isArray(args.plan) ? args.plan : [];
          await savePlan(cwd, plan);
          const done = plan.filter((p) => p.status === "completed").length;
          return { ok: true, summary: `plan ${done}/${plan.length}`, content: "Plan updated.", plan };
        }
        case "read_0g_skill": {
          if (!args.name) {
            return { ok: true, summary: "list 0G skills", content: "Available 0G skills: " + listSkills().join(", ") };
          }
          const doc = readSkill(args.name);
          if (!doc) return { ok: false, summary: `skill ${args.name} not found`, content: "Unknown skill. Available: " + listSkills().join(", ") };
          return { ok: true, summary: `0G skill: ${args.name}`, content: doc };
        }
        default:
          return { ok: false, summary: `unknown tool ${name}`, content: `No such tool: ${name}` };
      }
    } catch (e) {
      return { ok: false, summary: `${name} error`, content: `ERROR: ${e.message}` };
    }
  };
}

function globToRegExp(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`);
}

async function searchFiles(cwd, query, glob, subpath) {
  const root = safeResolve(cwd, subpath || ".");
  let re;
  try {
    re = new RegExp(query);
  } catch {
    return { count: 0, text: `invalid regular expression: ${query}` };
  }
  const globRe = glob ? globToRegExp(glob) : null;
  const results = [];
  const cap = 50;

  async function walk(dir) {
    if (results.length >= cap) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= cap) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (globRe && !globRe.test(e.name)) continue;
      let content;
      try {
        const st = await fs.stat(full);
        if (st.size > 1_000_000) continue;
        content = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\x00")) continue; // binary
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const rel = path.relative(cwd, full);
          results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (results.length >= cap) break;
        }
      }
    }
  }
  await walk(root);
  return { count: results.length, text: results.join("\n") || "(no matches)" };
}

async function uploadToStorage(cwd, relPath, allowBash) {
  if (!allowBash) {
    return { ok: false, summary: "0g upload denied", content: "upload_0g_storage writes on-chain. Re-run z0gcode with --auto to allow it." };
  }
  const key = process.env.ZOG_WALLET_KEY;
  if (!key) {
    return { ok: false, summary: "no wallet", content: "Set ZOG_WALLET_KEY to a funded 0G mainnet private key to upload to 0G Storage." };
  }
  const abs = safeResolve(cwd, relPath);
  const RPC = process.env.ZOG_EVM_RPC || "https://evmrpc.0g.ai";
  const INDEXER = process.env.ZOG_STORAGE_INDEXER || "https://indexer-storage-turbo.0g.ai";
  try {
    const { ethers } = await import("ethers");
    const { ZgFile, Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(key, provider);
    const indexer = new Indexer(INDEXER);
    const file = await ZgFile.fromFilePath(abs);
    try {
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr) throw new Error(String(treeErr));
      const root = tree.rootHash();
      const [res, upErr] = await indexer.upload(file, RPC, wallet);
      if (upErr) throw new Error(upErr.message || String(upErr));
      const txHash = res?.txHash || res;
      const rootHash = res?.rootHash || root;
      return {
        ok: true,
        summary: `uploaded ${relPath} to 0G Storage`,
        content: `0G Storage root: ${rootHash}\ntx: ${txHash}\nexplorer: https://chainscan.0g.ai/tx/${txHash}`,
      };
    } finally {
      await file.close();
    }
  } catch (e) {
    return { ok: false, summary: "0g upload failed", content: `ERROR: ${e.message}. Ensure @0gfoundation/0g-storage-ts-sdk is installed and the wallet is funded.` };
  }
}

async function deployToChain(cwd, args, allowBash) {
  if (!allowBash) {
    return { ok: false, summary: "deploy denied", content: "deploy_0g_chain writes on-chain. Re-run z0gcode with --auto to allow it." };
  }
  const key = process.env.ZOG_WALLET_KEY;
  if (!key) {
    return { ok: false, summary: "no wallet", content: "Set ZOG_WALLET_KEY to a funded 0G mainnet private key to deploy." };
  }
  const RPC = process.env.ZOG_EVM_RPC || "https://evmrpc.0g.ai";
  try {
    const { ethers } = await import("ethers");
    let abi = args.abi || [];
    let bytecode = args.bytecode;
    if (args.artifact) {
      const raw = JSON.parse(await fs.readFile(safeResolve(cwd, args.artifact), "utf8"));
      abi = raw.abi || abi;
      bytecode = raw.bytecode?.object || raw.bytecode || bytecode;
    }
    if (!bytecode) {
      return { ok: false, summary: "no bytecode", content: "Provide 'bytecode' or an 'artifact' path with abi + bytecode." };
    }
    if (typeof bytecode === "string" && !bytecode.startsWith("0x")) bytecode = "0x" + bytecode;
    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(key, provider);
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    const contract = await factory.deploy(...(args.args || []));
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    const tx = contract.deploymentTransaction()?.hash;
    return {
      ok: true,
      summary: `deployed to 0G Chain`,
      content: `contract: ${addr}\ntx: ${tx}\nexplorer: https://chainscan.0g.ai/address/${addr}`,
    };
  } catch (e) {
    return { ok: false, summary: "0g deploy failed", content: `ERROR: ${e.message}. Ensure ethers is installed, the wallet is funded, and contracts are compiled with evmVersion cancun.` };
  }
}

function runBash(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      const text = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n") || "(no output)";
      resolve({ code, text: text.slice(0, MAX_READ) });
    });
  });
}
