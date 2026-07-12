// Provenance manifest: binds every file change to the 0G model that produced it.
// This is the verifiable-provenance differentiator: a closed-provider CLI cannot
// prove which model wrote which code. We capture the model id and response id
// reported by 0G plus the before/after hashes. Full TEE-quote verification is roadmap.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const sha256 = (s) => crypto.createHash("sha256").update(s ?? "", "utf8").digest("hex");

// `dir` is the session directory (.z0g/sessions/<id>) so provenance is per-chat.
const MANIFEST = (dir) => path.join(dir, "provenance.json");

export function makeProvenance(dir) {
  const file = MANIFEST(dir);
  const entries = [];
  return {
    async record({ pathRel, before, after, model, responseId }) {
      entries.push({
        path: pathRel,
        sha256_before: sha256(before),
        sha256_after: sha256(after),
        model: model || "unknown",
        response_id: responseId || null,
        ts: new Date().toISOString(),
      });
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ tool: "z0gcode", provider: "0g-compute", entries }, null, 2), "utf8");
    },
    count() {
      return entries.length;
    },
  };
}

export async function loadProvenance(dir) {
  try {
    return JSON.parse(await fs.readFile(MANIFEST(dir), "utf8"));
  } catch {
    return null;
  }
}
