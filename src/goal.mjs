// Goal loop: run an objective, then a verify command; on failure feed the output
// back and re-run, until it passes or the iteration budget is spent.
import { exec } from "node:child_process";
import { runAgent } from "./agent.mjs";
import * as ui from "./ui.mjs";

function runCmd(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ code, out: `${stdout || ""}${stderr || ""}` });
    });
  });
}

export async function runGoal({ client, objective, cwd, allowBash, preferredModel, verifyCmd, maxIters = 3 }) {
  let history = null;
  let task = objective;
  for (let iter = 1; iter <= maxIters; iter++) {
    ui.info(`\n[goal] iteration ${iter}/${maxIters}`);
    const res = await runAgent({ client, task, cwd, allowBash, preferredModel, history });
    history = res.messages;

    if (!verifyCmd) {
      ui.info("[goal] no verify command configured; done after one pass.");
      return { ok: !!res.ok, iters: iter };
    }

    ui.info(`[goal] verifying: ${verifyCmd}`);
    const v = await runCmd(verifyCmd, cwd);
    if (v.code === 0) {
      ui.info(`[goal] verification passed on iteration ${iter}.`);
      return { ok: true, iters: iter };
    }
    ui.info(`[goal] verification failed (exit ${v.code}); feeding the output back.`);
    task = `The verification command \`${verifyCmd}\` failed with output:\n\n${v.out.slice(0, 4000)}\n\nFix the code so this command passes, then stop.`;
  }
  ui.error(`[goal] not met after ${maxIters} iterations.`);
  return { ok: false, iters: maxIters };
}
