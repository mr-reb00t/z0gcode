// z0gcode terminal UI. Dependency-free ANSI. One visual system, degrades
// cleanly under NO_COLOR and when piped (non-TTY). No em-dashes anywhere.
import { fmtCtx, orderChatModels, mediaModels } from "./models-info.mjs";

// ---- environment probes (computed once) ---------------------------------
export const useColor = !!process.stdout.isTTY && process.env.NO_COLOR === undefined;
export const uiTTY = !!process.stdout.isTTY;
export const interactive = !!(process.stdin.isTTY && process.stdout.isTTY);
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || "");
export const cols = Math.max(40, Math.min(process.stdout.columns || 80, 100));
const RULE_W = Math.min(cols, 78);

// ---- palette roles (semantic; never emit a raw color at a call site) -----
const sgr = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const strong = sgr("1", "22"); // bold, background-agnostic
export const ok = sgr("32", "39");
export const warn = sgr("33", "39");
export const err = sgr("31", "39");
export const accent = truecolor ? sgr("38;2;167;139;255", "39") : sgr("35", "39"); // brand violet
export const muted = truecolor ? sgr("38;2;107;112;128", "39") : sgr("2", "22"); // chrome
export const body = (s) => String(s);
export const italic = sgr("3", "23");
const underlineFn = sgr("4", "24");
const mdCyan = sgr("36", "39"); // inline code / code blocks
export const reverse = (s) => (useColor ? `\x1b[7m${s}\x1b[27m` : String(s));

// Backward-compatible color map (older call sites).
export const color = {
  dim: muted, bold: strong, cyan: accent, green: ok, yellow: warn,
  red: err, magenta: accent, gray: muted, blue: sgr("34", "39"),
};

// ---- glyph vocabulary (unicode on a TTY, ascii when piped) ---------------
export const GLYPH = uiTTY
  ? { tick: "▍", chevron: "›", seal: "◈", priv: "◆", ver: "◇", open: "·",
      ok: "✓", no: "✗", run: "▶", pending: "○", current: "●", point: "»",
      ellipsis: "…", rule: "─", up: "↑", down: "↓" }
  : { tick: "", chevron: ">", seal: "*", priv: "", ver: "", open: ".",
      ok: "ok", no: "x", run: ">", pending: "o", current: "*", point: ">",
      ellipsis: "...", rule: "-", up: "^", down: "v" };

// ---- measuring / padding / formatters ------------------------------------
const STRIP = /\x1b\[[0-9;]*m/g;
export const vlen = (s) => String(s).replace(STRIP, "").length;
export function pad(s, w, align = "left") {
  const l = vlen(s);
  if (l >= w) return s;
  const sp = " ".repeat(w - l);
  return align === "right" ? sp + s : s + sp;
}
export function trunc(s, w) {
  s = String(s);
  return s.length <= w ? s : s.slice(0, w - 1) + GLYPH.ellipsis;
}
// ANSI-aware clip: truncate to w visible columns, preserving color codes.
export function clip(s, w) {
  s = String(s);
  if (vlen(s) <= w) return s;
  let out = "";
  let vis = 0;
  const re = /(\x1b\[[0-9;]*m)|([\s\S])/g;
  let mch;
  while ((mch = re.exec(s))) {
    if (mch[1]) {
      out += mch[1];
      continue;
    }
    if (vis >= w - 1) break;
    out += mch[2];
    vis++;
  }
  return out + GLYPH.ellipsis + (useColor ? "\x1b[0m" : "");
}
export function fmtUsd(perM) {
  if (perM == null) return "";
  return "$" + (perM >= 10 ? perM.toFixed(2) : perM.toFixed(3));
}
export function fmtSave(pct) {
  return pct == null ? "" : "-" + pct + "%";
}
export function host(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "");
}

// ---- layout grammar ------------------------------------------------------
export function rule(w = RULE_W) {
  return "  " + muted(GLYPH.rule.repeat(Math.max(0, w - 2)));
}
// A titled section header: blank line, "▍ Title  · meta", hairline rule.
export function section(title, meta) {
  const tick = GLYPH.tick ? accent(GLYPH.tick + " ") : "";
  const head = tick + strong(title) + (meta ? "  " + muted("· " + meta) : "");
  return "\n" + head + "\n" + rule();
}
export function field(label, value) {
  return "  " + muted(String(label).padEnd(16)) + value;
}

// ---- banner --------------------------------------------------------------
export function banner(model, baseURL) {
  if (useColor && uiTTY) {
    const V = "\x1b[38;2;167;139;255m"; // Violet
    const W = "\x1b[38;2;242;241;236m"; // Foam (banner only)
    const M = "\x1b[38;2;107;112;128m"; // Muted
    const R = "\x1b[0m";
    console.log(`${W}█████   ${V}███${W}    ████${R}`);
    console.log(`${W}   ██  ${V}█  /█${W}  █${R}`);
    console.log(`${W}  ██   ${V}█ / █${W}  █  ██${R}   ${M}z0gcode v0.2${R}`);
    console.log(`${W} ██    ${V}█/  █${W}  █   █${R}   ${M}coding agent on 0G${R}`);
    console.log(`${W}█████   ${V}███${W}    ████${R}`);
  } else {
    console.log("z0gcode v0.2 · coding agent on 0G");
  }
  console.log(
    muted("  model ") + accent(model) + muted("  · " + host(baseURL) + "  ") +
    accent(GLYPH.seal) + muted(" TEE") + "\n"
  );
}

// ---- animated intro ------------------------------------------------------
// The barred-zero logo as a per-cell mask so we can fade + shine it. Each row
// is [text, role] segments; role W = foam, V = violet. Labels sit to the right.
const VIOLET_RGB = [167, 139, 255];
const FOAM_RGB = [242, 241, 236];
const SHINE_RGB = [255, 255, 255];
const LOGO = [
  [["█████   ", "W"], ["███", "V"], ["    ████", "W"]],
  [["   ██  ", "W"], ["█  /█", "V"], ["  █", "W"]],
  [["  ██   ", "W"], ["█ / █", "V"], ["  █  ██", "W"]],
  [[" ██    ", "W"], ["█/  █", "V"], ["  █   █", "W"]],
  [["█████   ", "W"], ["███", "V"], ["    ████", "W"]],
];
const LOGO_LABELS = ["", "", "z0gcode v0.2", "coding agent on 0G", ""];
const LOGO_H = LOGO.length;

const scaleRgb = ([r, g, b], f) => [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
const tcRgb = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const animDisabled = () =>
  !!process.env.Z0G_NO_ANIM || cols < 50 || !truecolor;

function renderLogoLine(rowIdx, brightness, sweepCol) {
  let out = "";
  let col = 0;
  for (const [text, role] of LOGO[rowIdx]) {
    for (const ch of text) {
      if (ch === " ") {
        out += " ";
        col++;
        continue;
      }
      const lit = sweepCol != null && (col === sweepCol || col === sweepCol - 1);
      const rgb = lit ? SHINE_RGB : scaleRgb(role === "V" ? VIOLET_RGB : FOAM_RGB, brightness);
      out += tcRgb(rgb) + ch;
      col++;
    }
  }
  out += "\x1b[0m";
  const label = LOGO_LABELS[rowIdx];
  if (label) out += "   " + muted(label);
  return out + "\x1b[K";
}

// Play the intro, then leave the finished banner + strapline on screen. Falls
// back to the static banner when animation is off (piped, NO_COLOR, narrow,
// no truecolor, or Z0G_NO_ANIM). Never leaves the cursor hidden.
export async function bannerAnimated(model, baseURL) {
  if (!useColor || !uiTTY || animDisabled()) {
    banner(model, baseURL);
    return;
  }
  const drawFrame = (brightness, sweepCol) => {
    let buf = "";
    for (let i = 0; i < LOGO_H; i++) buf += renderLogoLine(i, brightness, sweepCol) + "\n";
    process.stdout.write(buf);
  };
  const redraw = (brightness, sweepCol) => {
    process.stdout.write(`\x1b[${LOGO_H}A`);
    drawFrame(brightness, sweepCol);
  };
  try {
    process.stdout.write("\x1b[?25l"); // hide cursor
    const fades = [0.28, 0.5, 0.74, 1.0];
    drawFrame(fades[0], null);
    for (let k = 1; k < fades.length; k++) {
      await sleep(45);
      redraw(fades[k], null);
    }
    for (let c = 0; c <= 22; c++) {
      await sleep(15);
      redraw(1.0, c);
    }
    redraw(1.0, null);
  } catch {
    // fall through to a clean final state
  } finally {
    process.stdout.write("\x1b[?25h"); // always restore cursor
  }
  console.log(
    muted("  model ") + accent(model) + muted("  · " + host(baseURL) + "  ") +
    accent(GLYPH.seal) + muted(" TEE") + "\n"
  );
}

// ---- agent-run feedback --------------------------------------------------
export function toolCall(name, summary) {
  const room = Math.max(12, cols - 8 - vlen(name));
  const tail = summary ? " " + muted(trunc(summary, room)) : "";
  console.log("  " + accent(GLYPH.chevron) + " " + strong(name) + tail);
}
export function toolResult(success, summary) {
  const mark = success ? ok(GLYPH.ok) : err(GLYPH.no);
  console.log("    " + mark + " " + muted(summary || ""));
}

let spinTimer = null;
let spinFrame = 0;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
export function thinking(model) {
  if (!uiTTY) return;
  clearThinking();
  spinTimer = setInterval(() => {
    const f = SPIN[spinFrame % SPIN.length];
    const dots = ".".repeat(1 + ((spinFrame >> 1) % 3)); // . .. ... cycling
    spinFrame++;
    process.stdout.write("\r\x1b[K" + accent(f) + " " + muted("thinking on 0G · " + model) + accent(dots));
  }, 80);
  if (spinTimer.unref) spinTimer.unref();
}
export function clearThinking() {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
  if (uiTTY) process.stdout.write("\r\x1b[2K");
}

// ---- markdown rendering (terminal) ---------------------------------------
// Inline spans: code, links, bold, italic, strikethrough. Code is protected
// first so its contents are not re-styled.
function styleText(s) {
  s = s.replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => underlineFn(t) + muted(" (" + u + ")"));
  s = s.replace(/\*\*([^*]+?)\*\*/g, (_, x) => strong(x));
  s = s.replace(/__([^_]+?)__/g, (_, x) => strong(x));
  s = s.replace(/\*([^\s*][^*]*?)\*/g, (_, x) => italic(x));
  s = s.replace(/(^|[^\w])_([^\s_][^_]*?)_/g, (_, p, x) => p + italic(x));
  s = s.replace(/~~([^~]+?)~~/g, (_, x) => muted(x));
  return s;
}

function mdInline(s) {
  // Split on backtick code spans (odd segments are code, protected from styling).
  const parts = String(s).split("`");
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 && i < parts.length - 1) out += mdCyan(parts[i]);
    else if (i % 2 === 1) out += "`" + styleText(parts[i]);
    else out += styleText(parts[i]);
  }
  return out;
}

function mdBlockLine(raw) {
  const h = /^(#{1,6})\s+(.*)$/.exec(raw);
  if (h) return accent(strong(mdInline(h[2])));
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return rule();
  const bq = /^\s*>\s?(.*)$/.exec(raw);
  if (bq) return muted("│ ") + mdInline(bq[1]);
  const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
  if (li) {
    const bullet = /\d/.test(li[2]) ? accent(li[2] + " ") : accent("• ");
    return (li[1] || "") + "  " + bullet + mdInline(li[3]);
  }
  return mdInline(raw);
}

function renderMdTable(rows) {
  const split = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const all = rows.map(split);
  const isSep = (cells) => cells.length && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
  let header = null;
  let bodyRows;
  if (all.length >= 2 && isSep(all[1])) {
    header = all[0];
    bodyRows = all.slice(2);
  } else if (all.length && isSep(all[0])) {
    bodyRows = all.slice(1);
  } else {
    bodyRows = all;
  }
  const ncol = Math.max(...all.map((r) => r.length));
  const disp = header ? [header, ...bodyRows] : bodyRows;
  const rendered = disp.map((r) => Array.from({ length: ncol }, (_, c) => mdInline(r[c] || "")));
  const widths = Array.from({ length: ncol }, (_, c) => Math.max(3, ...rendered.map((r) => vlen(r[c]))));
  const out = [];
  rendered.forEach((r, i) => {
    const isHead = header && i === 0;
    out.push("  " + r.map((cell, c) => pad(isHead ? strong(cell) : cell, widths[c])).join("  "));
    if (isHead) out.push("  " + widths.map((w) => muted(GLYPH.rule.repeat(w))).join("  "));
  });
  return out.map((l) => l.replace(/[ \t]+$/, "")).join("\n") + "\n";
}

// Streaming, line-buffered markdown renderer. Complete lines render as they
// arrive (so it still streams); inline spans and tables need only one line /
// block of context, so chunk boundaries mid-token are handled correctly.
function makeMdRenderer(write) {
  let buffer = "";
  let inFence = false;
  let table = [];
  const flushTable = () => {
    if (table.length) {
      write(renderMdTable(table));
      table = [];
    }
  };
  const doLine = (raw) => {
    if (/^\s*```/.test(raw)) {
      flushTable();
      if (!inFence) {
        inFence = true;
        const info = raw.replace(/^\s*```/, "").trim();
        write(muted("  " + (info || "code")) + "\n");
      } else {
        inFence = false;
      }
      return;
    }
    if (inFence) {
      write("  " + muted("│ ") + mdCyan(raw) + "\n");
      return;
    }
    if (/^\s*\|.*\|/.test(raw)) {
      table.push(raw);
      return;
    }
    flushTable();
    write(mdBlockLine(raw) + "\n");
  };
  return {
    push(text) {
      buffer += String(text);
      let i;
      while ((i = buffer.indexOf("\n")) !== -1) {
        doLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    end() {
      if (buffer.length) {
        doLine(buffer);
        buffer = "";
      }
      flushTable();
      inFence = false;
    },
  };
}

// Full-string render (piped output stays raw, so it remains greppable).
export function renderMarkdown(text) {
  if (!uiTTY) return String(text);
  let out = "";
  const r = makeMdRenderer((s) => {
    out += s;
  });
  r.push(String(text));
  r.end();
  return out.replace(/\n+$/, "");
}

// Live stream for the agent's answer: renders each completed line as markdown.
export function assistantStream() {
  if (!uiTTY) return { push: (t) => process.stdout.write(t), end() {} };
  process.stdout.write("\n");
  return makeMdRenderer((s) => process.stdout.write(s));
}

export function assistant(text) {
  console.log("\n" + renderMarkdown(text) + "\n");
}
export function info(text) {
  console.log(muted(text));
}
export function error(text) {
  console.log(err(text));
}
export function streamChunk(s) {
  process.stdout.write(s);
}

export function hud(model, usage, effort) {
  const i = usage?.prompt_tokens ?? usage?.input_tokens;
  const o = usage?.completion_tokens ?? usage?.output_tokens;
  const toks = i != null || o != null ? `${i ?? "?"} in / ${o ?? "?"} out · ` : "";
  const eff = effort ? "effort " + effort + " · " : "";
  console.log(
    muted("  · " + toks + model + " · " + eff) + accent(GLYPH.seal) + muted(" 0G Compute (TEE)")
  );
}

// Compact plan header (printed repeatedly mid-run, so no rule).
export function renderPlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return;
  const done = plan.filter((p) => p.status === "completed").length;
  const tick = GLYPH.tick ? accent(GLYPH.tick + " ") : "";
  console.log("  " + tick + strong("Plan") + " " + muted(done + "/" + plan.length));
  for (const p of plan) {
    let mark;
    let label;
    if (p.status === "completed") {
      mark = ok(GLYPH.ok);
      label = muted(p.step);
    } else if (p.status === "in_progress") {
      mark = accent(GLYPH.run);
      label = strong(p.step);
    } else {
      mark = muted(GLYPH.pending);
      label = p.step;
    }
    console.log("    " + mark + " " + label);
  }
}

// ---- trust taxonomy (accurate to the API) --------------------------------
// private = TeeML (0G's own + glm-5.2). verifiable = TeeTLS attested. open = none.
export function trustTier(m) {
  if (m.private) return { glyph: GLYPH.priv, short: "priv", long: "private", role: accent };
  if (m.verifiable) return { glyph: GLYPH.ver, short: "ver", long: "verifiable", role: ok };
  return { glyph: GLYPH.open, short: "open", long: "open", role: muted };
}
function trustCell(m) {
  const t = trustTier(m);
  return t.role((t.glyph ? t.glyph + " " : "") + t.short);
}

// ---- `z0g models` table --------------------------------------------------
function bandOf(m) {
  if (String(m.id).startsWith("0gm")) return "0G native";
  if (m.private || m.verifiable) return "Verifiable (TEE)";
  return "Open (proxied)";
}
function modelRow(m, currentId) {
  const cur = m.id === currentId;
  const gutter = cur ? accent(GLYPH.chevron + " ") : "  ";
  const id = trunc(m.id, 20);
  const idCell = pad(cur ? accent(strong(id)) : id, 20);
  const ctx = muted(pad(fmtCtx(m.ctx), 5, "right"));
  const out = muted(pad(m.maxOut ? fmtCtx(m.maxOut) : "-", 5, "right"));
  const pin = muted(pad(fmtUsd(m.inPerM), 7, "right"));
  const pout = muted(pad(fmtUsd(m.outPerM), 7, "right"));
  const save = pad(m.discount != null ? ok(fmtSave(m.discount)) : "", 6, "right");
  const trust = trustCell(m); // last column, no trailing pad
  return gutter + idCell + " " + ctx + " " + out + " " + pin + " " + pout + " " + save + " " + trust;
}
function colHeader() {
  return (
    "  " + pad("MODEL", 20) + " " + pad("CTX", 5, "right") + " " + pad("MAX", 5, "right") +
    " " + pad("$IN", 7, "right") + " " + pad("$OUT", 7, "right") + " " + pad("SAVE", 6, "right") +
    " " + "TRUST"
  );
}
export function renderModelsTable(models, { currentId } = {}) {
  const chat = orderChatModels(models, currentId);
  const media = mediaModels(models);
  const out = [];
  out.push(section("Models", "0G Router · " + models.length));
  out.push(muted(colHeader()));
  let band = null;
  for (const m of chat) {
    const b = bandOf(m);
    if (b !== band) {
      band = b;
      out.push("  " + muted(band));
    }
    out.push(modelRow(m, currentId));
  }
  if (media.length) {
    out.push("");
    out.push("  " + muted("Media models"));
    for (const m of media) {
      const kind = m.type === "speech-to-text" ? "speech" : m.type === "text-to-image" ? "image" : m.type;
      out.push("  " + pad(trunc(m.id, 20), 20) + " " + pad(trustCell(m), 8) + " " + muted(kind));
    }
  }
  out.push("");
  out.push(rule());
  out.push(
    "  " + accent(GLYPH.priv) + " " + muted("private (TEE)  ") + ok(GLYPH.ver) + " " +
    muted("verifiable  ") + muted(GLYPH.open + " open   ") +
    muted("SAVE vs official API · prices per 1M tokens")
  );
  out.push("  " + accent(GLYPH.seal) + " " + muted("all inference runs in a TEE on 0G Compute.  Switch: ") + accent("z0g --model <id>") + muted(" or ") + accent("/model"));
  return out.join("\n");
}

// Numbered fallback list (non-TTY / piped) for the model picker.
export function renderModelsPickList(models, currentId) {
  const out = [strong("Select a 0G model:")];
  models.forEach((m, i) => {
    const cur = m.id === currentId ? muted("  (current)") : "";
    out.push(
      "  " + pad(String(i + 1) + ")", 4) + " " + pad(trunc(m.id, 20), 20) + " " +
      pad(fmtCtx(m.ctx), 5, "right") + "  " + fmtUsd(m.inPerM) + "/" + fmtUsd(m.outPerM) +
      "  " + trustCell(m) + cur
    );
  });
  out.push(muted("  Type a number or a model id. Anything else cancels."));
  return out.join("\n");
}

// ---- `/model` arrow-key picker frame -------------------------------------
export function modelPickerFrame(items, index, currentId) {
  const W = Math.max(24, Math.min(process.stdout.columns || 80, 100));
  const termRows = process.stdout.rows || 24;
  const lines = [];
  const tick = GLYPH.tick ? accent(GLYPH.tick + " ") : "";
  lines.push(clip(tick + strong("Select model") + muted("   " + GLYPH.up + "/" + GLYPH.down + " move · enter select · esc cancel"), W));
  lines.push("");
  lines.push(clip("  " + muted(pad("MODEL", 20) + " " + pad("TRUST", 8) + " PRICE $/1M in·out"), W));

  // Window to the terminal height: the frame must never exceed the viewport,
  // or arrowSelect's in-place rewind (moveCursor up) desyncs and corrupts it.
  const CHROME = 8; // hint + blank + colheader + 2 "more" rows + blank + 2 detail lines
  const win = Math.max(1, termRows - CHROME - 1); // -1 for arrowSelect's trailing newline
  let start = 0;
  if (items.length > win) start = Math.min(Math.max(0, index - (win >> 1)), items.length - win);
  const end = Math.min(items.length, start + win);

  lines.push(start > 0 ? "  " + muted(GLYPH.up + " " + start + " more") : "");
  for (let i = start; i < end; i++) {
    const m = items[i];
    const sel = i === index;
    const isCur = m.id === currentId;
    let gutter;
    if (sel) gutter = useColor ? accent(GLYPH.chevron + " ") : GLYPH.point + " ";
    else if (isCur) gutter = ok(GLYPH.current + " ");
    else gutter = "  ";
    const t = trustTier(m);
    const price = fmtUsd(m.inPerM) + "/" + fmtUsd(m.outPerM);
    const rowText = pad(trunc(m.id, 20), 20) + " " + pad((t.glyph ? t.glyph + " " : "") + t.short, 8) + " " + price;
    let painted;
    if (sel) painted = useColor ? reverse(rowText + " ") : rowText;
    else if (isCur) painted = strong(rowText);
    else painted = rowText;
    lines.push(clip(gutter + painted, W));
  }
  lines.push(end < items.length ? "  " + muted(GLYPH.down + " " + (items.length - end) + " more") : "");
  lines.push("");

  const m = items[index] || items[0];
  const t = trustTier(m);
  const price = "in " + fmtUsd(m.inPerM) + "  out " + fmtUsd(m.outPerM);
  const disc = m.discount != null ? "  ·  " + m.discount + "% off" : "";
  const idShown = trunc(m.id, Math.max(0, W - 2));
  const nameStr = m.name ? "  ·  " + m.name : "";
  lines.push(clip("  " + strong(idShown) + muted(nameStr), W));
  const plain2 = "  " + price + " /1M  ·  ctx " + fmtCtx(m.ctx) + "  ·  " + t.long + disc;
  lines.push(
    vlen(plain2) <= W
      ? "  " + muted(price + " /1M  ·  ctx " + fmtCtx(m.ctx) + "  ·  ") + t.role(t.long) + muted(disc)
      : clip(muted(plain2), W)
  );
  return lines.join("\n");
}
export function pickConfirm(id) {
  return "  " + ok(GLYPH.ok) + " model set to " + strong(id) + muted("  (saved)");
}

// ---- session picker ------------------------------------------------------
export function relTime(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d ago";
  const w = Math.floor(d / 7);
  if (w < 5) return w + "w ago";
  return Math.floor(d / 30) + "mo ago";
}

// Items are [{ __new: true }, ...sessions{ id, title, updated, messageCount }].
export function sessionPickerFrame(items, index, ctx = {}) {
  const { filter = "", filtering = false } = ctx;
  const W = Math.max(24, Math.min(process.stdout.columns || 80, 100));
  const termRows = process.stdout.rows || 24;
  const lines = [];
  const tick = GLYPH.tick ? accent(GLYPH.tick + " ") : "";
  lines.push(clip(tick + strong("Sessions") + muted("   " + GLYPH.up + "/" + GLYPH.down + " move · enter open · type to search · ctrl-r rename · ctrl-x delete · esc"), W));
  lines.push("");

  const CHROME = 6; // header + blank + 2 "more" rows + blank + footer
  const win = Math.max(1, termRows - CHROME - 1); // -1 for arrowSelect's trailing newline
  let start = 0;
  if (items.length > win) start = Math.min(Math.max(0, index - (win >> 1)), items.length - win);
  const end = Math.min(items.length, start + win);

  lines.push(start > 0 ? "  " + muted(GLYPH.up + " " + start + " more") : "");
  for (let i = start; i < end; i++) {
    const it = items[i];
    const sel = i === index;
    const gutter = sel ? (useColor ? accent(GLYPH.chevron + " ") : GLYPH.point + " ") : "  ";
    let painted;
    if (it.__new) {
      const t = "+ New chat";
      painted = sel ? (useColor ? reverse(t + " ") : t) : accent(t);
    } else {
      const title = pad(trunc(it.title || "New chat", 40), 40);
      const n = it.messageCount || 0;
      const meta = relTime(it.updated) + " · " + n + " msg" + (n === 1 ? "" : "s");
      painted = sel ? (useColor ? reverse(title + "  " + meta + " ") : title + "  " + meta) : title + muted("  " + meta);
    }
    lines.push(clip(gutter + painted, W));
  }
  lines.push(end < items.length ? "  " + muted(GLYPH.down + " " + (items.length - end) + " more") : "");
  lines.push("");

  const nSessions = items.filter((it) => !it.__new).length;
  const footer = filtering && filter
    ? 'search: "' + filter + '"  ·  ' + nSessions + " match" + (nSessions === 1 ? "" : "es")
    : nSessions + " session" + (nSessions === 1 ? "" : "s");
  lines.push("  " + muted(footer));
  return lines.join("\n");
}

// ---- diff (unchanged behavior, role colors) ------------------------------
export function renderDiff(oldText, newText, { maxLines = 80 } = {}) {
  const a = (oldText || "").split("\n");
  const b = (newText || "").split("\n");
  if (a.length > 2000 || b.length > 2000) {
    return muted(`    (diff omitted: ${a.length} to ${b.length} lines)`);
  }
  const ops = diffLines(a, b);
  const out = [];
  for (const op of ops) {
    if (op.t === " ") continue;
    const paint = op.t === "+" ? ok : err;
    out.push("    " + paint(op.t + " " + op.s));
    if (out.length >= maxLines) {
      out.push(muted("    ... (diff truncated)"));
      break;
    }
  }
  return out.length ? out.join("\n") : muted("    (no textual change)");
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
