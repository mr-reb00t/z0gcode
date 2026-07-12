// Dependency-free interactive prompts (raw ANSI). Currently: a single-select
// list navigable with the arrow keys, decoupled from its look via renderFrame.
import readline from "node:readline";

// arrowSelect: navigate `items` with ↑/↓ (or j/k), Enter to choose, Esc/Ctrl-C
// to cancel, 1..9 to jump. Resolves to the chosen item, or undefined if
// cancelled. Resolves undefined immediately when stdin/stdout is not a TTY so
// the caller can fall back (e.g. a numbered prompt).
//
// renderFrame(items, index) must return the ENTIRE multi-line frame as a
// string; each logical line must fit the terminal width (caller truncates),
// otherwise wrapping breaks the in-place redraw.
export function arrowSelect({ items, initialIndex = 0, renderFrame, clearOnExit = false }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || !stdout.isTTY || !items || items.length === 0) {
      resolve(undefined);
      return;
    }

    let index = Math.min(Math.max(initialIndex | 0, 0), items.length - 1);
    let prevLines = 0;

    // Take over keypress handling: detach any existing listeners (e.g. the
    // outer REPL readline) so they don't also react, and restore them on exit.
    readline.emitKeypressEvents(stdin);
    const saved = stdin.listeners("keypress").slice();
    for (const l of saved) stdin.removeListener("keypress", l);

    const wasRaw = !!stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?25l"); // hide cursor

    const clear = () => {
      if (prevLines > 0) {
        readline.moveCursor(stdout, 0, -prevLines);
        readline.cursorTo(stdout, 0);
        readline.clearScreenDown(stdout);
      }
    };
    const draw = () => {
      clear();
      const frame = renderFrame(items, index);
      const body = frame.endsWith("\n") ? frame : frame + "\n";
      stdout.write(body);
      prevLines = (body.match(/\n/g) || []).length;
    };
    const cleanup = () => {
      stdin.removeListener("keypress", onKey);
      if (clearOnExit && prevLines > 0) {
        readline.moveCursor(stdout, 0, -prevLines);
        readline.cursorTo(stdout, 0);
        readline.clearScreenDown(stdout);
      }
      stdout.write("\x1b[?25h"); // show cursor
      try {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      } catch {}
      for (const l of saved) stdin.on("keypress", l); // restore outer listeners
    };
    const finish = (val) => {
      cleanup();
      resolve(val);
    };

    const onKey = (str, key) => {
      try {
        key = key || {};
        if (key.name === "up" || key.name === "k") {
          index = (index - 1 + items.length) % items.length;
          draw();
        } else if (key.name === "down" || key.name === "j") {
          index = (index + 1) % items.length;
          draw();
        } else if (key.name === "return" || key.name === "enter") {
          finish(items[index]);
        } else if (key.name === "escape" || (key.ctrl && key.name === "c") || (key.ctrl && key.name === "d") || key.name === "q") {
          finish(undefined);
        } else if (str && /^[1-9]$/.test(str)) {
          const n = Number(str) - 1;
          if (n < items.length) {
            index = n;
            draw();
          }
        } else if (key.name === "home" || (key.ctrl && key.name === "a")) {
          index = 0;
          draw();
        } else if (key.name === "end" || (key.ctrl && key.name === "e")) {
          index = items.length - 1;
          draw();
        }
      } catch {
        finish(undefined); // never leave the terminal in raw mode on a render error
      }
    };

    try {
      draw();
    } catch {
      finish(undefined);
      return;
    }
    stdin.on("keypress", onKey);
  });
}
