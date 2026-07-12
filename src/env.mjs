// Load a .env file from the working directory into process.env BEFORE anything
// reads config. Imported first in bin/z0g.mjs so config.mjs sees the vars.
// Dependency-free; does not override variables already set in the environment.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env");
if (existsSync(file)) {
  try {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const keyPart = line.slice(0, eq).replace(/^export\s+/, "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyPart)) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[keyPart] === undefined) process.env[keyPart] = val;
    }
  } catch {
    // ignore a malformed .env
  }
}
