// Generate assets/demo/z0g-demo.svg: an animated terminal demo with a FIXED
// viewport that auto-scrolls as new content appears, and LOOPS indefinitely
// (a short clear-screen fade + scroll rewind hides the seam). Six labeled
// action sections; the full live 0G model catalog is the hero.
// Run:  node scripts/gen-demo.mjs
import { writeFileSync } from "node:fs";

const C = { bg: "#0d1017", chrome: "#161b22", rule: "#1f2630", text: "#c9d1d9", mut: "#6b7080", grn: "#3fb950", cyn: "#56d4dd", vio: "#a78bff" };
const TIER = { priv: C.vio, ver: C.cyn, open: C.mut };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// viewport / window geometry
const W = 820, VIEW_TOP = 96, VIEW_H = 500, FOOT_H = 40;
const H = VIEW_TOP + VIEW_H + FOOT_H;
const BOTTOM = VIEW_H - 44;   // content-y that should sit near the viewport bottom
// loop timing
const LOOP_TAIL = 2.2;        // pause + clear before the loop restarts (slower, readable)
const STAGGER = 0.34, CHUNK_DUR = 0.4, DIV_DUR = 0.42, SEC_GAP = 0.24;

function txt(x, y, s, o = {}) {
  let a = `x="${x}" y="${y}"`;
  if (o.size) a += ` font-size="${o.size}"`;
  if (o.fill) a += ` fill="${o.fill}"`;
  if (o.bold) a += ` font-weight="700"`;
  if (o.anchor) a += ` text-anchor="${o.anchor}"`;
  if (o.ls != null) a += ` letter-spacing="${o.ls}"`;
  return `<text ${a}>${esc(s)}</text>`;
}
const rect = (x, y, w, h, fill, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${o.rx ? ` rx="${o.rx}"` : ""} fill="${fill}"${o.op != null ? ` opacity="${o.op}"` : ""}/>`;
const line = (x1, y1, x2, y2, stroke, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;
const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

const COL = { dot: 44, model: 60, ctx: 322, max: 402, in: 542, out: 636, save: 742 };

const reveals = [];  // {begin, dur, inner} rendered as looping <g> inside the scroll area
let y = 8;           // content cursor (content-y coords, 0-based)
let t = 1.5;         // reveal-time cursor (after the command starts typing)
const keys = [{ t: 0, y: 0 }]; // scroll keyframes {time, target content-y}

function section({ idx, title, accent, echo, chunks }) {
  const yD = y + 26;
  const hb = yD + 22;
  const railTop = yD + 11;
  const firstRow = yD + 46;
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const lastY = firstRow + (total - 1) * 20;
  const railH = (lastY + 6) - railTop;
  const t0 = t;
  reveals.push({
    begin: t0, dur: DIV_DUR, inner:
      line(24, yD, 60, yD, accent, 2) +
      line(60, yD, 796, yD, C.rule, 1) +
      rect(24, yD + 11, 4, 15, accent, { rx: 1 }) +
      rect(26, railTop, 2, railH, accent, { op: 0.3 }) +
      txt(42, hb, idx, { size: 11, fill: accent, ls: 1 }) +
      txt(62, hb, title, { size: 12.5, fill: C.text, bold: true, ls: 2 }) +
      txt(796, hb, echo, { size: 10.5, fill: C.mut, anchor: "end" }),
  });
  keys.push({ t: t0, y: hb });
  let ry = firstRow, rt = t0 + DIV_DUR;
  for (const chunk of chunks) {
    let inner = "", lastRow = ry;
    for (const rowFn of chunk) { inner += rowFn(ry); lastRow = ry; ry += 20; }
    reveals.push({ begin: rt, dur: CHUNK_DUR, inner });
    keys.push({ t: rt, y: lastRow });
    rt += STAGGER;
  }
  y = lastY + 6 + 26;
  t = rt + SEC_GAP;
}

const lineRow = (spans) => (yy) => spans.map((sp) => txt(sp.x, yy, sp.s, sp)).join("");
const dataRow = (m, zebra) => (yy) => {
  let s = "";
  if (zebra) s += rect(24, yy - 14, 772, 20, C.chrome, { op: 0.55 });
  s += circle(COL.dot, yy - 4, 3.5, TIER[m.tier]);
  s += txt(COL.model, yy, m.id, { size: 12, fill: C.text });
  s += txt(COL.ctx, yy, m.ctx, { size: 12, fill: C.mut, anchor: "end" });
  s += txt(COL.max, yy, m.max, { size: 12, fill: C.mut, anchor: "end" });
  s += txt(COL.in, yy, m.in, { size: 12, fill: C.text, anchor: "end" });
  s += txt(COL.out, yy, m.out, { size: 12, fill: C.text, anchor: "end" });
  s += m.save ? txt(COL.save, yy, m.save, { size: 12, fill: C.grn, anchor: "end" }) : txt(COL.save - 6, yy, "·", { size: 12, fill: C.mut, anchor: "end" });
  return s;
};
const bandRow = (label, color, note) => (yy) => rect(24, yy - 14, 772, 20, C.chrome, { rx: 3 }) +
  circle(34, yy - 4, 4, color) +
  txt(48, yy, label, { size: 10.5, fill: color, ls: 1.5 }) +
  txt(792, yy, note, { size: 9.5, fill: C.mut, anchor: "end" });

// ---------------------------------------------------------------- scene data
const VER = [
  { id: "qwen3-vl-30b", ctx: "256K", max: "32K", in: "$0.019", out: "$0.189", save: "", tier: "ver" },
  { id: "deepseek-v4-flash", ctx: "1M", max: "384K", in: "$0.121", out: "$0.242", save: "-12%", tier: "ver" },
  { id: "qwen3.7-plus", ctx: "1M", max: "64K", in: "$0.221", out: "$0.881", save: "-45%", tier: "ver" },
  { id: "qwen3.6-plus", ctx: "1M", max: "64K", in: "$0.243", out: "$1.453", save: "-50%", tier: "ver" },
  { id: "minimax-m3", ctx: "1M", max: "128K", in: "$0.270", out: "$1.080", save: "-55%", tier: "ver" },
  { id: "glm-5", ctx: "198K", max: "128K", in: "$0.504", out: "$2.270", save: "-40%", tier: "ver" },
  { id: "glm-5.1", ctx: "202K", max: "128K", in: "$0.726", out: "$2.905", save: "-35%", tier: "ver" },
  { id: "kimi-k2.7-code", ctx: "256K", max: "16K", in: "$0.787", out: "$3.268", save: "-18%", tier: "ver" },
  { id: "qwen3.7-max", ctx: "1M", max: "64K", in: "$0.825", out: "$2.475", save: "-60%", tier: "ver" },
  { id: "glm-5.2", ctx: "1.0M", max: "128K", in: "$0.900", out: "$3.000", save: "-30%", tier: "priv" },
  { id: "deepseek-v4-pro", ctx: "1M", max: "384K", in: "$1.452", out: "$2.905", save: "-15%", tier: "ver" },
];
const OPEN = [
  { id: "claude-sonnet-5", ctx: "1M", max: "128K", in: "$1.900", out: "$9.500", save: "", tier: "open" },
  { id: "claude-opus-4-8", ctx: "1M", max: "128K", in: "$4.500", out: "$22.50", save: "-10%", tier: "open" },
  { id: "claude-fable-5", ctx: "1M", max: "128K", in: "$9.000", out: "$45.00", save: "-10%", tier: "open" },
];
const NATIVE = { id: "0gm-1.0-35b-a3b", ctx: "256K", max: "32K", in: "$0.080", out: "$0.480", save: "-50%", tier: "priv" };
let zc = 0;
const zRow = (m) => { const r = dataRow(m, zc % 2 === 1); zc++; return r; };

// ================================================================= sections
section({
  idx: "01", title: "WRITE CODE", accent: C.grn, echo: "write_file · run_bash",
  chunks: [
    [lineRow([{ x: 44, s: "write_file", fill: C.cyn, size: 13 }, { x: 130, s: "src/hero.tsx", fill: C.text, size: 13 }, { x: 250, s: "· 42 lines", fill: C.mut, size: 13 }])],
    [lineRow([{ x: 44, s: "$", fill: C.grn, size: 13 }, { x: 60, s: 'run_bash "npm run build"', fill: C.text, size: 13 }])],
    [lineRow([{ x: 44, s: "✓ build passed", fill: C.grn, size: 13 }])],
    [
      lineRow([{ x: 44, s: "+ export function Hero() {", fill: C.grn, size: 13 }]),
      lineRow([{ x: 44, s: '- <div class="legacy-hero" />', fill: C.mut, size: 13 }]),
    ],
  ],
});
section({
  idx: "02", title: "GENERATE IMAGE", accent: C.vio, echo: "generate_image · z-image-turbo",
  chunks: [
    [lineRow([{ x: 44, s: "generate_image", fill: C.cyn, size: 13 }, { x: 168, s: '"sunset hero, 1536×640"', fill: C.text, size: 13 }])],
    [lineRow([{ x: 44, s: "z-image-turbo · 1 image · 1536×640", fill: C.mut, size: 13 }])],
    [lineRow([{ x: 44, s: "✓ saved public/hero.png", fill: C.grn, size: 13 }, { x: 260, s: "cost ", fill: C.mut, size: 13 }, { x: 296, s: "$0.006", fill: C.text, size: 13 }])],
  ],
});
section({
  idx: "03", title: "TRANSCRIBE AUDIO", accent: C.cyn, echo: "transcribe · whisper-large-v3",
  chunks: [
    [lineRow([{ x: 44, s: "transcribe", fill: C.cyn, size: 13 }, { x: 130, s: "assets/vo.mp3", fill: C.text, size: 13 }])],
    [lineRow([{ x: 44, s: "whisper-large-v3 · 128s of audio", fill: C.mut, size: 13 }])],
    [lineRow([{ x: 44, s: '"welcome to z0gcode, the agent whose brain runs on 0G…"', fill: C.text, size: 13 }])],
    [lineRow([{ x: 44, s: "✓ transcript.txt", fill: C.grn, size: 13 }, { x: 200, s: "cost ", fill: C.mut, size: 13 }, { x: 236, s: "$0.011", fill: C.text, size: 13 }])],
  ],
});
section({
  idx: "04", title: "MODEL CATALOG", accent: C.vio, echo: "z0g models · 15 models · 3 tiers",
  chunks: [
    [lineRow([
      { x: 44, s: "●", fill: C.vio, size: 11 }, { x: 58, s: "priv 0G native", fill: C.mut, size: 11 },
      { x: 190, s: "●", fill: C.cyn, size: 11 }, { x: 204, s: "ver TEE", fill: C.mut, size: 11 },
      { x: 290, s: "●", fill: C.mut, size: 11 }, { x: 304, s: "open proxied", fill: C.mut, size: 11 },
      { x: 792, s: "price per 1M tokens", fill: C.mut, size: 10, anchor: "end" },
    ])],
    [lineRow([
      { x: COL.model, s: "MODEL", fill: C.mut, size: 9.5, ls: 0.5 },
      { x: COL.ctx, s: "CTX", fill: C.mut, size: 9.5, anchor: "end" },
      { x: COL.max, s: "MAX", fill: C.mut, size: 9.5, anchor: "end" },
      { x: COL.in, s: "$IN", fill: C.mut, size: 9.5, anchor: "end" },
      { x: COL.out, s: "$OUT", fill: C.mut, size: 9.5, anchor: "end" },
      { x: COL.save, s: "SAVE", fill: C.mut, size: 9.5, anchor: "end" },
    ])],
    [bandRow("0G NATIVE", C.vio, "in-house model"), zRow(NATIVE)],
    [bandRow("VERIFIABLE · TEE", C.cyn, "TEE attestation on 0G Chain"), ...VER.map(zRow)],
    [bandRow("OPEN · PROXIED", C.mut, "passthrough"), ...OPEN.map(zRow)],
    [lineRow([{ x: 44, s: "media: whisper-large-v3 · z-image-turbo priced per-call (see 02 · 03)", fill: C.mut, size: 9.5 }])],
  ],
});
section({
  idx: "05", title: "PARALLEL SUBAGENTS", accent: C.cyn, echo: "spawn_write_subagents ×3 · git worktrees",
  chunks: [
    [lineRow([{ x: 44, s: "spawn_write_subagents", fill: C.cyn, size: 13 }, { x: 224, s: "3 tasks · isolated worktrees", fill: C.mut, size: 13 }])],
    [(yy) => txt(44, yy, "wt/landing", { size: 13, fill: C.text }) + rect(180, yy - 10, 200, 8, C.chrome, { rx: 2 }) + rect(180, yy - 10, 200, 8, C.grn, { rx: 2 }) + txt(392, yy, "✓", { size: 13, fill: C.grn })],
    [(yy) => txt(44, yy, "wt/api", { size: 13, fill: C.text }) + rect(180, yy - 10, 200, 8, C.chrome, { rx: 2 }) + rect(180, yy - 10, 200, 8, C.cyn, { rx: 2 }) + txt(392, yy, "✓", { size: 13, fill: C.grn })],
    [(yy) => txt(44, yy, "wt/tests", { size: 13, fill: C.text }) + rect(180, yy - 10, 200, 8, C.chrome, { rx: 2 }) + rect(180, yy - 10, 200, 8, C.grn, { rx: 2 }) + txt(392, yy, "✓", { size: 13, fill: C.grn })],
    [lineRow([{ x: 44, s: "✓ 3 branches merged into the working tree", fill: C.grn, size: 13 }])],
  ],
});
section({
  idx: "06", title: "VERIFIABLE ON-CHAIN", accent: C.grn, echo: "share · anchor · attest",
  chunks: [
    [lineRow([{ x: 44, s: "share", fill: C.cyn, size: 13 }, { x: 90, s: "→ 0G Storage", fill: C.text, size: 13 }, { x: 210, s: "root 0xb67f4960…", fill: C.mut, size: 13 }])],
    [lineRow([{ x: 44, s: "anchor", fill: C.cyn, size: 13 }, { x: 100, s: "→ 0G Chain", fill: C.text, size: 13 }, { x: 210, s: "tx 0xa2348022…", fill: C.mut, size: 13 }])],
    [lineRow([{ x: 44, s: "attest", fill: C.cyn, size: 13 }, { x: 100, s: "→ 0G node", fill: C.text, size: 13 }, { x: 210, s: "0x4870Cb…5FE77a4E9", fill: C.text, size: 13 }])],
    [lineRow([{ x: 44, s: "✓ verifiable: model + hash + provider node signed by 0G (TEE)", fill: C.grn, size: 13 }])],
  ],
});

// ------------------------------------------------ loop timeline + transforms
const contentBottom = y;
const tLastReveal = t - SEC_GAP;                 // ~ last chunk begin
const D = tLastReveal + LOOP_TAIL;               // full loop duration
const scrollOf = (cy) => Math.max(0, cy - BOTTOM);
// scroll keyframes: content keys, settle at bottom, hold, then rewind to top (masked by the fade)
keys.push({ t: tLastReveal + 0.5, y: contentBottom });
keys.push({ t: D - 0.3, y: contentBottom });
keys.push({ t: D, y: 0 });
const values = keys.map((k) => `0 ${(VIEW_TOP - scrollOf(k.y)).toFixed(1)}`).join(" ; ");
const keyTimes = keys.map((k) => Math.min(1, k.t / D).toFixed(4)).join(" ; ");
const scroll = `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}" dur="${D.toFixed(2)}s" repeatCount="indefinite"/>`;

// each reveal loops: 0 until its begin, 1 until the clear-screen fade, 0 through the seam
const cFadeStart = (D - 1.0) / D, cFadeEnd = (D - 0.4) / D;
const loopGroup = (r) => {
  const a = (r.begin / D), b = ((r.begin + r.dur) / D);
  return `<g opacity="0"><animate attributeName="opacity" dur="${D.toFixed(2)}s" repeatCount="indefinite" keyTimes="0;${a.toFixed(4)};${b.toFixed(4)};${cFadeStart.toFixed(4)};${cFadeEnd.toFixed(4)};1" values="0;0;1;1;0;0"/>${r.inner}</g>`;
};
const content = reveals.map(loopGroup).join("");

// ---------------------------------------------------------------- assembly
const cmd = "ship a landing page, make a hero image, and prove it on-chain";
const chrome = [
  rect(8, 8, 804, H - 16, C.bg, { rx: 10 }).replace("/>", ` stroke="#30363d"/>`),
  rect(8, 8, 804, 34, C.chrome, { rx: 10 }),
  rect(8, 30, 804, 12, C.chrome),
  circle(28, 25, 6, "#ff5f56"), circle(48, 25, 6, "#ffbd2e"), circle(68, 25, 6, "#27c93f"),
  txt(410, 30, "z0gcode · 0G Compute", { size: 13, fill: C.mut, anchor: "middle" }),
  txt(24, 74, "z0g ›", { size: 14, fill: C.vio, bold: true }),
  `<clipPath id="type"><rect x="72" y="60" width="0" height="20"><animate attributeName="width" begin="0.4s" dur="1.1s" from="0" to="540" fill="freeze"/></rect></clipPath>`,
  `<text x="74" y="74" font-size="14" fill="${C.text}" clip-path="url(#type)">${esc(cmd)}</text>`,
  `<rect x="74" y="62" width="8" height="15" fill="${C.vio}"><animate attributeName="x" begin="0.4s" dur="1.1s" from="74" to="590" fill="freeze"/><animate attributeName="opacity" begin="0.4s" dur="0.7s" values="1;0;1" repeatCount="2"/><animate attributeName="opacity" begin="1.5s" dur="1.1s" values="1;1;0;0;1" repeatCount="indefinite"/></rect>`,
  line(8, 88, 812, 88, "#30363d", 1),
].join("\n  ");

const defs = `<defs>
  <clipPath id="view"><rect x="8" y="${VIEW_TOP}" width="804" height="${VIEW_H}"/></clipPath>
  <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></linearGradient>
  <linearGradient id="fadeBot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
</defs>`;
const scrollArea = `<g clip-path="url(#view)"><g transform="translate(0 ${VIEW_TOP})">${scroll}${content}</g></g>`;
const fades =
  `<rect x="9" y="${VIEW_TOP}" width="802" height="22" fill="url(#fadeTop)"/>` +
  `<rect x="9" y="${VIEW_TOP + VIEW_H - 22}" width="802" height="22" fill="url(#fadeBot)"/>`;
const footer =
  line(8, VIEW_TOP + VIEW_H, 812, VIEW_TOP + VIEW_H, "#30363d", 1) +
  txt(24, H - 14, "No OpenAI or Anthropic key. Every token private and verifiable on 0G Compute (TEE).", { size: 11, fill: C.mut });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" role="img" aria-label="z0gcode terminal demo that auto-scrolls through six action sections: write code, generate an image, transcribe audio, the full 0G model catalog, parallel write subagents, and a verifiable on-chain session">
  ${defs}
  ${chrome}
  ${scrollArea}
  ${fades}
  ${footer}
</svg>
`;

writeFileSync(new URL("../assets/demo/z0g-demo.svg", import.meta.url), svg);
console.log("wrote assets/demo/z0g-demo.svg · viewport", W + "x" + H, "· content", contentBottom, "px · loop", D.toFixed(1) + "s · bytes", svg.length);
