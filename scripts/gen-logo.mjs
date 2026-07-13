// Generate assets/logo/z0gcode-banner.svg as an exact, flush-cell render of the
// terminal intro logo (the LOGO mask in src/ui.mjs), so the README banner
// matches the console 1:1: solid connected strokes, the z-slash drawn as blocks
// (not a smooth line). Keeps the load shine sweep. Run: node scripts/gen-logo.mjs
import { writeFileSync } from "node:fs";

// Mirrors the LOGO mask in src/ui.mjs. Any non-space char is a lit cell; role
// "V" = violet (the barred zero / z-slash), "W" = foam (the Z and G).
const LOGO = [
  [["█████   ", "W"], ["███", "V"], ["    ████", "W"]],
  [["   ██  ", "W"], ["█  /█", "V"], ["  █", "W"]],
  [["  ██   ", "W"], ["█ / █", "V"], ["  █  ██", "W"]],
  [[" ██    ", "W"], ["█/  █", "V"], ["  █   █", "W"]],
  [["█████   ", "W"], ["███", "V"], ["    ████", "W"]],
];
const VIOLET = "#A78BFF", FOAM = "#F2F1EC";
const CW = 18, CH = 30;           // cell size (terminal char aspect), flush
const W = 600, H = 254;

// Parse the mask into lit cells: { col, row, role }.
const cells = [];
let maxCol = 0;
LOGO.forEach((row, r) => {
  let col = 0;
  for (const [text, role] of row) {
    for (const ch of text) {
      if (ch !== " ") { cells.push({ col, row: r, role }); if (col > maxCol) maxCol = col; }
      col++;
    }
  }
});
const gridW = (maxCol + 1) * CW, gridH = LOGO.length * CH;
const ox = Math.round((W - gridW) / 2), oy = 30;

const rectFor = (c, fill) => `<rect x="${c.col * CW}" y="${c.row * CH}" width="${CW}" height="${CH}" fill="${fill}"/>`;
const foam = cells.filter((c) => c.role !== "V").map((c) => rectFor(c, FOAM)).join("\n    ");
const violet = cells.filter((c) => c.role === "V").map((c) => rectFor(c, VIOLET)).join("\n    ");
const maskCells = cells.map((c) => rectFor(c, "#fff")).join("\n      ");

const sweep = gridW + 2 * (CW * 5);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="z0gcode: coding agent on 0G">
  <defs>
    <linearGradient id="shineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#fff" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="markMask" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${gridW + 40}" height="${gridH + 40}">
      ${maskCells}
    </mask>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="#0d1117" stroke="#21262d"/>
  <g transform="translate(${ox},${oy})"><animate attributeName="opacity" begin="0s" dur="0.5s" from="0" to="1" fill="freeze"/>
    ${foam}
    ${violet}
    <rect x="${-CW * 6}" y="-14" width="${CW * 5}" height="${gridH + 28}" fill="url(#shineGrad)" mask="url(#markMask)">
      <animate attributeName="x" begin="0.7s" dur="4.4s" repeatCount="indefinite" keyTimes="0;0.5;0.78;1" values="${-CW * 6};${-CW * 6};${sweep};${sweep}"/>
    </rect>
  </g>
  <style>
    .sub{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:20px}
    .strap{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:16px;fill:#6B7080}
  </style>
  <text class="sub" x="${W / 2}" y="207" text-anchor="middle"><tspan fill="${FOAM}">z0gcode</tspan><tspan fill="#6B7080"> v0.2  ·  coding agent on 0G</tspan></text>
  <text class="strap" x="${W / 2}" y="234" text-anchor="middle" xml:space="preserve">model 0gm-1.0-35b-a3b  ·  router-api.0g.ai  <tspan fill="${VIOLET}">◈</tspan> TEE</text>
</svg>
`;
writeFileSync(new URL("../assets/logo/z0gcode-banner.svg", import.meta.url), svg);
console.log("wrote logo · cells", cells.length, "· grid", gridW + "x" + gridH, "· offset", ox + "," + oy, "· bytes", svg.length);
