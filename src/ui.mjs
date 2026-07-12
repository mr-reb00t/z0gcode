// Minimal ANSI UI helpers. No dependencies.
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const color = {
  dim: wrap("2"),
  bold: wrap("1"),
  cyan: wrap("36"),
  green: wrap("32"),
  yellow: wrap("33"),
  red: wrap("31"),
  magenta: wrap("35"),
  gray: wrap("90"),
  blue: wrap("34"),
};

// Truecolor helpers for the brand palette (LOGO.md).
const tc = (r, g, b) => (useColor ? `\x1b[38;2;${r};${g};${b}m` : "");
const RESET = useColor ? "\x1b[0m" : "";

// "Zero Slash" splash: the barred 0 (circle = 0 of 0G, violet slash = Z of Zog).
export function banner(model, baseURL) {
  const V = tc(167, 139, 255); // Violet 0G  #A78BFF
  const W = tc(242, 241, 236); // Foam       #F2F1EC
  const M = tc(107, 112, 128); // Muted      #6B7080
  const R = RESET;
  console.log(`${W}█████   ${V}███${W}    ████${R}`);
  console.log(`${W}   ██  ${V}█  /█${W}  █${R}`);
  console.log(`${W}  ██   ${V}█ / █${W}  █  ██${R}   ${M}z0gcode v0.2${R}`);
  console.log(`${W} ██    ${V}█/  █${W}  █   █${R}   ${M}coding agent on 0G${R}`);
  console.log(`${W}█████   ${V}███${W}    ████${R}`);
  console.log(color.dim(`\n  model ${model}  ·  ${baseURL}\n`));
}

export function toolCall(name, summary) {
  console.log(`${color.cyan("→")} ${color.bold(name)} ${color.dim(summary || "")}`);
}

export function toolResult(ok, summary) {
  const mark = ok ? color.green("✓") : color.red("✗");
  console.log(`  ${mark} ${color.dim(summary || "")}`);
}

export function thinking(model) {
  if (process.stdout.isTTY) process.stdout.write(color.dim(`  … thinking on 0G (${model})\r`));
}

export function clearThinking() {
  if (process.stdout.isTTY) process.stdout.write(" ".repeat(50) + "\r");
}

export function assistant(text) {
  console.log("\n" + text.trim() + "\n");
}

export function info(text) {
  console.log(color.dim(text));
}

export function error(text) {
  console.log(color.red(text));
}

// Raw incremental write for streamed model output.
export function streamChunk(s) {
  process.stdout.write(s);
}

// Render the agent's checklist.
export function renderPlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return;
  console.log(color.dim("  plan:"));
  for (const p of plan) {
    const mark =
      p.status === "completed" ? color.green("✓") : p.status === "in_progress" ? color.yellow("▶") : color.dim("○");
    const label = p.status === "completed" ? color.dim(p.step) : p.step;
    console.log(`    ${mark} ${label}`);
  }
}

// HUD line after a turn: token usage + answering model + 0G marker.
export function hud(model, usage) {
  const i = usage?.prompt_tokens ?? usage?.input_tokens;
  const o = usage?.completion_tokens ?? usage?.output_tokens;
  const toks = i != null || o != null ? `${i ?? "?"} in / ${o ?? "?"} out tokens · ` : "";
  console.log(color.dim(`  · ${toks}${model} · 0G Compute (TEE)`));
}

// Line-based colored diff. Prints only changed lines (+ green / - red), capped.
export function renderDiff(oldText, newText, { maxLines = 80 } = {}) {
  const a = (oldText || "").split("\n");
  const b = (newText || "").split("\n");
  if (a.length > 2000 || b.length > 2000) {
    return color.dim(`    (diff omitted: ${a.length} → ${b.length} lines)`);
  }
  const ops = diffLines(a, b);
  const out = [];
  for (const op of ops) {
    if (op.t === " ") continue;
    const paint = op.t === "+" ? color.green : color.red;
    out.push("    " + paint(op.t + " " + op.s));
    if (out.length >= maxLines) {
      out.push(color.dim("    … (diff truncated)"));
      break;
    }
  }
  return out.length ? out.join("\n") : color.dim("    (no textual change)");
}

function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "-", s: a[i] });
      i++;
    } else {
      ops.push({ t: "+", s: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: "-", s: a[i++] });
  while (j < m) ops.push({ t: "+", s: b[j++] });
  return ops;
}
