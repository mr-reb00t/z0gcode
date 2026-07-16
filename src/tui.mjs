// A fixed-bottom TUI shell for the interactive REPL. The input box and a status
// bar stay pinned at the bottom while agent output scrolls above them. The box
// is a small textarea: it grows to a few lines as you type or paste, then
// collapses on submit. Built on a terminal scroll region (DECSTBM) plus a
// raw-mode line editor, so it stays dependency-free and keeps the transcript in
// the terminal (unlike the alternate screen, which would wipe it on exit).
// Degrades to the classic readline prompt when the terminal cannot support it.
// No em-dashes anywhere.
import { StringDecoder } from "node:string_decoder";
import * as ui from "./ui.mjs";

const ESC = "\x1b";
const CSI = ESC + "[";
const MAX_ROWS = 4; // the textarea grows to at most this many input lines
const PASTE_ON = CSI + "?2004h";
const PASTE_OFF = CSI + "?2004l";
const PASTE_START = CSI + "200~";
const PASTE_END = CSI + "201~";

export function tuiCapable() {
  return (
    ui.interactive &&
    typeof process.stdin.setRawMode === "function" &&
    Number(process.stdout.rows) >= 10 &&
    !process.env.Z0G_CLASSIC &&
    !process.env.Z0G_NO_TUI
  );
}

function escName(seq) {
  switch (seq) {
    case CSI + "A": case ESC + "OA": return "up";
    case CSI + "B": case ESC + "OB": return "down";
    case CSI + "C": case ESC + "OC": return "right";
    case CSI + "D": case ESC + "OD": return "left";
    case CSI + "H": case ESC + "OH": case CSI + "1~": case CSI + "7~": return "home";
    case CSI + "F": case ESC + "OF": case CSI + "4~": case CSI + "8~": return "end";
    case CSI + "3~": return "delete";
    case CSI + "Z": return "shifttab";
    default: return null;
  }
}
const CSI_RE = /^\x1b(\[[0-9;?]*[@-~]|O[A-Za-z])/;

export function createTui({ promptStr, statusProvider, onModeCycle, completer }) {
  const out = process.stdout;
  const w = (s) => out.write(s);
  const rule = ui.GLYPH.rule;
  const promptVis = ui.vlen(promptStr);
  const decoder = new StringDecoder("utf8");

  let H = 24, W = 80, regionBottom = 21, footerTop = 22, resizeTimer = null;
  let buffer = "", pos = 0;
  let state = "idle"; // idle | input | running | suspended
  let prevState = "idle";
  let resolveLine = null;
  let onInterrupt = null;
  let cursorShown = true;
  let started = false;
  let pasting = false, pasteBuf = "", pending = "";
  let curScreen = { row: 0, col: 0 };

  const histArr = [];
  let histIdx = -1;
  let stash = "";

  const measure = () => {
    H = Number(out.rows) || 24;
    W = Math.max(24, Number(out.columns) || 80);
  };
  const setRegion = () => w(`${CSI}1;${regionBottom}r`);
  const clearRegion = () => w(`${CSI}r`);
  const park = () => w(`${CSI}${regionBottom};1H`);
  const showCursor = (on) => { if (on !== cursorShown) { cursorShown = on; w(on ? `${CSI}?25h` : `${CSI}?25l`); } };
  const resetInput = () => { pasting = false; pasteBuf = ""; pending = ""; };
  const cap = () => Math.max(4, W - 3 - promptVis); // wrap width (prompt / indent reserved)

  // ---- footer rendering --------------------------------------------------
  const S = (plain, fn) => ({ plain, s: fn ? fn(plain) : plain });
  const borderLine = (lc, rc, left, right) => {
    let lseg = left, rseg = right;
    let lp = lseg.map((x) => x.plain).join("");
    let rp = rseg.map((x) => x.plain).join("");
    const fixedOf = (a, b) => 1 + (a ? a.length + 2 : 0) + (b ? b.length + 2 : 0) + 1;
    if (fixedOf(lp, rp) > W - 1) { rseg = []; rp = ""; }
    if (fixedOf(lp, "") > W - 1 && lp) { const room = Math.max(0, W - 1 - 4); lp = lp.slice(0, room); lseg = [S(lp, ui.muted)]; }
    const dashes = Math.max(1, W - fixedOf(lp, rp));
    let s = ui.muted(lc);
    s += lp ? " " + lseg.map((x) => x.s).join("") + " " : "";
    s += ui.muted(rule.repeat(dashes));
    s += rp ? " " + rseg.map((x) => x.s).join("") + " " : "";
    s += ui.muted(rc);
    return s;
  };

  // Wrap the buffer (which may contain hard newlines) into visual rows, and
  // locate the cursor within them. Each row wraps at `cap()` columns.
  const layout = () => {
    const c = cap();
    const rows = [];
    const pushLogical = (start, text) => {
      if (text.length === 0) { rows.push({ start, text: "" }); return; }
      for (let s = 0; s < text.length; s += c) rows.push({ start: start + s, text: text.slice(s, s + c) });
    };
    let start = 0;
    for (let k = 0; k <= buffer.length; k++) {
      if (k === buffer.length || buffer[k] === "\n") { pushLogical(start, buffer.slice(start, k)); start = k + 1; }
    }
    if (rows.length === 0) rows.push({ start: 0, text: "" });
    let cr = 0, cc = 0;
    for (let r = 0; r < rows.length; r++) {
      const rs = rows[r].start, re = rs + rows[r].text.length;
      if (pos >= rs && pos <= re) { cr = r; cc = pos - rs; }
    }
    return { rows, cr, cc };
  };

  const renderFooter = () => {
    measure();
    const st = (statusProvider && statusProvider()) || {};
    const { rows, cr, cc } = state === "input" ? layout() : { rows: [{ start: 0, text: "" }], cr: 0, cc: 0 };
    const total = rows.length;
    const inputRows = Math.min(MAX_ROWS, Math.max(1, total));
    let winStart = 0;
    if (total > inputRows) {
      winStart = cr;
      if (cr >= inputRows) winStart = cr - inputRows + 1;
      winStart = Math.max(0, Math.min(winStart, total - inputRows));
    }
    const newTop = H - inputRows - 1; // top border row
    regionBottom = Math.max(1, newTop - 1);
    // clear the old + new footer band (handles the box shrinking after submit)
    const clearFrom = Math.max(1, Math.min(footerTop, newTop));
    for (let r = clearFrom; r <= H; r++) w(`${CSI}${r};1H${CSI}2K`);
    footerTop = newTop;
    setRegion();

    const topRight = [];
    if (st.tokens != null) topRight.push(S(ui.fmtTok(st.tokens) + " tok", ui.muted));
    if (st.cost != null) topRight.push(S("  ·  ~$" + st.cost.toFixed(st.cost < 0.01 ? 4 : 3), ui.muted));
    w(`${CSI}${newTop};1H` + borderLine("╭", "╮", [], topRight));

    for (let vr = 0; vr < inputRows; vr++) {
      const idx = winStart + vr;
      const row = rows[idx] || { text: "" };
      const prefix = idx === 0 ? promptStr : " ".repeat(promptVis);
      const used = 2 + promptVis + row.text.length;
      const pad = " ".repeat(Math.max(0, W - 1 - used));
      w(`${CSI}${newTop + 1 + vr};1H` + ui.muted("│ ") + prefix + row.text + pad + ui.muted("│"));
    }

    const left = [];
    if (st.model) left.push(S(st.model, ui.accent));
    if (st.mode) left.push(S("  ·  " + st.mode, ui.muted));
    if (st.approve) left.push(S("  ·  " + st.approve, ui.muted));
    const right = st.running
      ? [S("running", ui.warn), S("  ·  Ctrl+C stop", ui.muted)]
      : [S("Shift+Tab mode", ui.muted), S("  ·  Ctrl+C stop", ui.muted)];
    w(`${CSI}${H};1H` + borderLine("╰", "╯", left, right));

    curScreen = { row: newTop + 1 + (cr - winStart), col: Math.min(W - 1, 3 + promptVis + cc) };
  };

  const positionCursor = () => { if (state === "input") w(`${CSI}${curScreen.row};${curScreen.col}H`); };
  const focusInput = () => { renderFooter(); showCursor(true); positionCursor(); };
  const refreshRunning = () => { renderFooter(); showCursor(false); park(); };
  const redraw = () => { renderFooter(); positionCursor(); };

  // ---- editor operations -------------------------------------------------
  const histTouch = () => { histIdx = -1; };
  const insertText = (text) => {
    if (!text) return;
    buffer = buffer.slice(0, pos) + text + buffer.slice(pos);
    pos += text.length; histTouch(); redraw();
  };
  const applyPaste = (text) => {
    // multi-line box: keep newlines (they become extra rows), drop other control
    // bytes, and never submit (the user presses Enter when ready)
    insertText(text.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ""));
  };
  const historyPrev = () => {
    if (!histArr.length) return;
    if (histIdx === -1) { stash = buffer; histIdx = histArr.length; }
    if (histIdx > 0) histIdx--;
    buffer = histArr[histIdx] ?? ""; pos = buffer.length; redraw();
  };
  const historyNext = () => {
    if (histIdx === -1) return;
    histIdx++;
    if (histIdx >= histArr.length) { histIdx = -1; buffer = stash; } else buffer = histArr[histIdx];
    pos = buffer.length; redraw();
  };
  // Up/Down move between visual rows inside a multi-line entry, and fall through
  // to history recall at the top/bottom edges.
  const moveVertical = (dir) => {
    const { rows, cr, cc } = layout();
    if (dir < 0 && cr === 0) return historyPrev();
    if (dir > 0 && cr === rows.length - 1) return historyNext();
    const target = rows[cr + dir];
    pos = target.start + Math.min(cc, target.text.length);
    redraw();
  };
  const handleKey = (name) => {
    switch (name) {
      case "up": return moveVertical(-1);
      case "down": return moveVertical(1);
      case "left": if (pos > 0) pos--; return redraw();
      case "right": if (pos < buffer.length) pos++; return redraw();
      case "home": pos = 0; return redraw();
      case "end": pos = buffer.length; return redraw();
      case "delete": buffer = buffer.slice(0, pos) + buffer.slice(pos + 1); histTouch(); return redraw();
      case "shifttab": if (onModeCycle) onModeCycle(); return redraw();
    }
  };
  // Print something into the scroll region above the box (e.g. a Tab-completion
  // menu), then repaint the box and put the cursor back in it.
  const printAbove = (text) => {
    showCursor(false);
    park();
    w((text.endsWith("\n") ? text : text + "\n"));
    renderFooter();
    showCursor(true);
    positionCursor();
  };
  // Tab completion (slash commands): complete to the single match or the longest
  // common prefix; when it cannot extend further, list the candidates above.
  const doComplete = () => {
    if (!completer) return;
    const res = completer(buffer) || {};
    const matches = res.matches || [];
    if (matches.length === 0) return;
    if (matches.length === 1) { buffer = matches[0] + " "; pos = buffer.length; histTouch(); return redraw(); }
    let lcp = matches[0];
    for (const m of matches) { let k = 0; while (k < lcp.length && lcp[k] === m[k]) k++; lcp = lcp.slice(0, k); }
    if (lcp.length > buffer.length) { buffer = lcp; pos = buffer.length; histTouch(); redraw(); }
    else if (res.menu) printAbove(res.menu);
  };
  const backspace = () => { if (pos > 0) { buffer = buffer.slice(0, pos - 1) + buffer.slice(pos); pos--; } histTouch(); redraw(); };
  const killToStart = () => { buffer = buffer.slice(pos); pos = 0; histTouch(); redraw(); };
  const killToEnd = () => { buffer = buffer.slice(0, pos); histTouch(); redraw(); };
  const killWord = () => { const l = buffer.slice(0, pos).replace(/[^\s]*\s*$/, ""); buffer = l + buffer.slice(pos); pos = l.length; histTouch(); redraw(); };

  const submit = () => {
    const line = buffer;
    if (line.trim() && histArr[histArr.length - 1] !== line) histArr.push(line);
    showCursor(false);
    buffer = ""; pos = 0; histIdx = -1; stash = "";
    state = "idle";
    renderFooter(); // collapse the box to one empty row (fixes regionBottom)
    park();
    for (const [k, l] of line.split("\n").entries()) w(`${CSI}2K` + (k === 0 ? promptStr : " ".repeat(promptVis)) + l + "\n");
    park();
    const r = resolveLine; resolveLine = null;
    if (r) r(line);
  };
  const finish = (val) => {
    buffer = ""; pos = 0; state = "idle";
    const r = resolveLine; resolveLine = null;
    if (r) r(val);
  };

  // ---- raw-byte input parser (owns paste, so pasted newlines never submit) --
  const onData = (chunk) => {
    let s = pending + decoder.write(chunk);
    pending = "";
    if (state === "running") { if (s.includes("\x03") && onInterrupt) onInterrupt(); return; }
    if (state !== "input") return;

    let i = 0;
    while (i < s.length) {
      if (pasting) {
        const end = s.indexOf(PASTE_END, i);
        if (end === -1) {
          const tail = s.slice(i);
          let keep = 0;
          for (let k = Math.min(tail.length, PASTE_END.length - 1); k > 0; k--) { if (PASTE_END.startsWith(tail.slice(tail.length - k))) { keep = k; break; } }
          pasteBuf += tail.slice(0, tail.length - keep);
          pending = tail.slice(tail.length - keep);
          return;
        }
        pasteBuf += s.slice(i, end);
        i = end + PASTE_END.length;
        pasting = false;
        applyPaste(pasteBuf); pasteBuf = "";
        continue;
      }
      const ch = s[i];
      if (ch === ESC) {
        const rest = s.slice(i);
        if (rest === ESC) { i += 1; continue; }                                  // lone Esc key
        if (rest[1] === "\r" || rest[1] === "\n") { insertText("\n"); i += 2; continue; } // Alt+Enter
        if (rest.startsWith(PASTE_START)) { pasting = true; i += PASTE_START.length; continue; }
        if (rest.startsWith(PASTE_END)) { i += PASTE_END.length; continue; }
        if (PASTE_START.startsWith(rest)) { pending = rest; return; }            // partial paste marker
        const m = CSI_RE.exec(rest);
        if (!m) { if (rest[1] === "[" || rest[1] === "O") { pending = rest; return; } i += 1; continue; }
        const name = escName(m[0]);
        if (name) handleKey(name);
        i += m[0].length; continue;
      }
      const code = s.charCodeAt(i);
      if (ch === "\r" || ch === "\n") { submit(); return; }
      if (code === 9) { doComplete(); i++; continue; } // Tab: complete slash commands
      if (code === 127 || code === 8) { backspace(); i++; continue; }
      if (code === 3) { if (buffer) { buffer = ""; pos = 0; histTouch(); redraw(); } else finish(null); return; }
      if (code === 4) { if (!buffer) { finish(null); return; } i++; continue; }
      if (code === 1) { pos = 0; redraw(); i++; continue; }
      if (code === 5) { pos = buffer.length; redraw(); i++; continue; }
      if (code === 21) { killToStart(); i++; continue; }
      if (code === 11) { killToEnd(); i++; continue; }
      if (code === 23) { killWord(); i++; continue; }
      if (code < 32) { i++; continue; }
      let j = i;
      while (j < s.length) { const cj = s.charCodeAt(j); if (s[j] === ESC || cj < 32 || cj === 127) break; j++; }
      insertText(s.slice(i, j));
      i = j;
    }
  };

  // ---- lifecycle ---------------------------------------------------------
  const start = () => {
    if (started) return;
    started = true;
    measure();
    footerTop = H - 2; regionBottom = H - 3;
    try { process.stdin.setRawMode(true); } catch {}
    process.stdin.resume();
    process.stdin.on("data", onData);
    w(PASTE_ON);
    // Clean slate so the intro and every turn hug the bottom (just above the box)
    // instead of stranding a banner at the top with a big gap below it.
    clearRegion();
    w(`${CSI}2J${CSI}H`);
    renderFooter();
    park();
    process.stdout.on("resize", onResize);
  };
  const doResize = () => {
    resizeTimer = null;
    if (!started || state === "suspended") return;
    measure();
    clearRegion();
    w(`${CSI}2J${CSI}H`); // full clear: no reflowed footer can survive
    footerTop = H - 2;
    renderFooter();
    if (state === "input") { showCursor(true); positionCursor(); } else { showCursor(false); park(); }
  };
  const onResize = () => {
    if (!started || state === "suspended") return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(doResize, 60);
    if (resizeTimer.unref) resizeTimer.unref();
  };
  const stop = () => {
    if (!started) return;
    started = false;
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    process.stdin.removeListener("data", onData);
    process.stdout.removeListener("resize", onResize);
    w(PASTE_OFF);
    clearRegion();
    showCursor(true);
    w(`${CSI}${H};1H\n`);
    try { process.stdin.setRawMode(false); } catch {}
    try { process.stdin.pause(); } catch {}
  };

  const readLine = () => new Promise((resolve) => {
    resolveLine = resolve;
    buffer = ""; pos = 0; histIdx = -1; stash = ""; resetInput();
    state = "input";
    focusInput();
  });

  const setRunning = (on, cb) => {
    onInterrupt = on ? cb : null;
    state = on ? "running" : "idle";
    refreshRunning();
  };

  const suspend = (opts = {}) => {
    prevState = state === "suspended" ? prevState : state;
    state = "suspended";
    process.stdin.removeListener("data", onData);
    w(PASTE_OFF);
    resetInput();
    clearRegion();
    if (opts.modal) w(`${CSI}2J${CSI}H`);
    else { for (let r = footerTop; r <= H; r++) w(`${CSI}${r};1H${CSI}2K`); w(`${CSI}${footerTop};1H`); }
    showCursor(true);
    try { process.stdin.setRawMode(false); } catch {}
  };
  const resume = (opts = {}) => {
    try { process.stdin.setRawMode(true); } catch {}
    process.stdin.resume();
    process.stdin.on("data", onData);
    w(PASTE_ON);
    measure();
    // Reset the scroll region BEFORE clearing: some terminals (VSCode) limit an
    // erase to the active region, which would leave the old footer as a ghost.
    if (opts.modal) { clearRegion(); w(`${CSI}2J${CSI}H`); }
    footerTop = H - 2; regionBottom = H - 3;
    state = prevState === "input" ? "idle" : prevState;
    if (state === "running") refreshRunning();
    else { renderFooter(); park(); }
  };

  return {
    start, stop, readLine, setRunning, suspend, resume,
    refresh: () => (state === "input" ? focusInput() : refreshRunning()),
  };
}
