// Dependency-free interactive prompts (raw ANSI). Currently: a single-select
// list navigable with the arrow keys, decoupled from its look via renderFrame.
import readline from "node:readline";

// arrowSelect: navigate a list with the arrow keys, Enter to choose, Esc/Ctrl-C
// to cancel. Resolves to the chosen item, or undefined if cancelled, or
// { __action, item } when an action key fires. Resolves undefined immediately
// when stdin/stdout is not a TTY so the caller can fall back (e.g. a number
// prompt).
//
// Options:
// - renderFrame(items, index, ctx) returns the ENTIRE multi-line frame; each
//   logical line must fit the terminal width (caller truncates), or wrapping
//   breaks the in-place redraw. ctx = { filter, filtering }.
// - filterable: enable type-to-filter. While on, letters/digits build a filter
//   (only the arrow keys navigate; j/k/q/1-9 become filter input); Esc clears
//   the filter, or cancels when it is already empty.
// - filterText(item): the text a filter matches against; return null to always
//   keep the item visible (e.g. a "New chat" entry).
// - onActionKey(key, str): return an action name for a key combo (e.g. ctrl-r);
//   the promise resolves { __action: name, item: highlighted }.
export function arrowSelect({ items, initialIndex = 0, renderFrame, clearOnExit = false, filterable = false, filterText, onActionKey }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || !stdout.isTTY || !items || items.length === 0) {
      resolve(undefined);
      return;
    }

    let index = Math.min(Math.max(initialIndex | 0, 0), items.length - 1);
    let filter = "";
    let prevLines = 0;

    const matches = (it) => {
      if (!filterable || !filter) return true;
      const t = filterText ? filterText(it) : String(it);
      return t == null ? true : String(t).toLowerCase().includes(filter.toLowerCase());
    };
    const visible = () => (filterable ? items.filter(matches) : items);

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
      const vis = visible();
      if (index >= vis.length) index = Math.max(0, vis.length - 1);
      const frame = renderFrame(vis, index, { filter, filtering: filterable });
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
        const vis = visible();
        const len = vis.length;
        if (onActionKey) {
          const a = onActionKey(key, str);
          if (a) {
            finish({ __action: a, item: len ? vis[index] : null });
            return;
          }
        }
        if (key.name === "up" || (!filterable && key.name === "k")) {
          if (len) index = (index - 1 + len) % len;
          draw();
        } else if (key.name === "down" || (!filterable && key.name === "j")) {
          if (len) index = (index + 1) % len;
          draw();
        } else if (key.name === "return" || key.name === "enter") {
          if (len) finish(vis[index]);
        } else if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "d")) {
          finish(undefined);
        } else if (key.name === "escape") {
          if (filterable && filter) {
            filter = "";
            index = 0;
            draw();
          } else finish(undefined);
        } else if (!filterable && key.name === "q") {
          finish(undefined);
        } else if (key.name === "home" || (key.ctrl && key.name === "a")) {
          index = 0;
          draw();
        } else if (key.name === "end" || (key.ctrl && key.name === "e")) {
          index = Math.max(0, len - 1);
          draw();
        } else if (filterable && key.name === "backspace") {
          filter = filter.slice(0, -1);
          index = 0;
          draw();
        } else if (filterable && str && str.length === 1 && str >= " " && !key.ctrl) {
          filter += str;
          index = 0;
          draw();
        } else if (!filterable && str && /^[1-9]$/.test(str)) {
          const n = Number(str) - 1;
          if (n < items.length) {
            index = n;
            draw();
          }
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
