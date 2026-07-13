// Goal loop: run an objective, then a verify command; on failure feed the output
// back and re-run, until it passes or the iteration budget is spent.
import { exec } from "node:child_process";
import { runAgent } from "./agent.mjs";
import { saveMessages } from "./sessions.mjs";
import * as ui from "./ui.mjs";

function runCmd(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, out: `${stdout || ""}${stderr || ""}` });
    });
  });
}

export async function runGoal({ client, objective, cwd, sessionId, sessionDir, allowBash, preferredModel, preferredEffort, preferredSubagents, preferredOnchain, verifyCmd, maxIters = 3, history: historyParam = null }) {
  let history = historyParam ?? null;
  let task = objective;
  for (let iter = 1; iter <= maxIters; iter++) {
    console.log(ui.section("Goal", "iteration " + iter + "/" + maxIters));
    const res = await runAgent({ client, task, cwd, sessionDir, allowBash, preferredModel, preferredEffort, preferredSubagents, preferredOnchain, history });
    history = res.messages;
    if (sessionId && Array.isArray(history)) {
      try { await saveMessages(cwd, sessionId, history); } catch {}
    }

    if (!verifyCmd) {
      ui.info("  no verify command configured; done after one pass.");
      return { ok: !!res.ok, iters: iter };
    }

    console.log("  " + ui.muted("verify: " + verifyCmd));
    const v = await runCmd(verifyCmd, cwd);
    if (v.code === 0) {
      console.log("  " + ui.ok(ui.GLYPH.ok + " passed on iteration " + iter));
      console.log("  " + ui.ok(ui.GLYPH.ok) + "  " + ui.strong("Goal met in " + iter + " iteration" + (iter > 1 ? "s" : "") + "."));
      return { ok: true, iters: iter };
    }
    console.log("  " + ui.warn(ui.GLYPH.no + " failed (exit " + v.code + ") · feeding output back"));
    task = `The verification command \`${verifyCmd}\` failed with output:\n\n${v.out.slice(0, 4000)}\n\nFix the code so this command passes, then stop.`;
  }
  console.log("  " + ui.err(ui.GLYPH.no) + "  " + ui.strong("Goal not met after " + maxIters + " iterations."));
  return { ok: false, iters: maxIters };
}
