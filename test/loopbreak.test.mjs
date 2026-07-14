import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent } from "../src/agent.mjs";

// A fake 0G client that always tells the agent to run_bash with a DIFFERENT
// command but that yields the SAME (empty) result. The exact-args breaker never
// fires (args differ); the no-progress breaker must, well before maxSteps.
function loopingClient() {
  let n = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const i = ++n;
          return (async function* () {
            yield { id: "resp-" + i, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "tc" + i, type: "function", function: { name: "run_bash", arguments: JSON.stringify({ command: "true # " + i }) } }] } }] };
            yield { choices: [{ index: 0, delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
          })();
        },
      },
    },
  };
}

test("no-progress breaker stops a spinning agent well before maxSteps", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "z0gloop-"));
  const res = await runAgent({ client: loopingClient(), task: "spin forever", cwd, quiet: true, preferredMode: "auto" });
  assert.equal(res.ok, false);
  assert.match(res.finalText, /Stopped/i);
  assert.ok(res.steps <= 5, `stopped in ${res.steps} steps, expected <= 5`);
});
