// render_svg.mjs - draws the prototype layouts (from `layout2d_proto.mjs --dump pos.json`) as one HTML page of SVG disks, to LOOK at them.
//   node tools/proto/render_svg.mjs pos.json out.html
// Rows: tree focused on the root, then focused on "syndrome" (the 486-child parent). Columns: production, A, B. Colour = top-level family.
import fs from 'node:fs';
const [, , posFile, outFile] = process.argv;
const pos = JSON.parse(fs.readFileSync(posFile, 'utf8'));
const add = (a, z) => { const nr = a.x + z.x, ni = a.y + z.y, dr = 1 + a.x * z.x + a.y * z.y, di = a.x * z.y - a.y * z.x, k = dr * dr + di * di; return { x: (nr * dr + ni * di) / k, y: (ni * dr - nr * di) / k }; };
const neg = (a) => ({ x: -a.x, y: -a.y });
const PALETTE = ['#7aa2f7', '#bb9af7', '#2ac3de', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64'];
const R = 235;
function panel(nodes, focusName, title) {
  const fi = focusName ? nodes.findIndex((n) => n[4] === focusName) : 0;
  const f = { x: nodes[fi][0], y: nodes[fi][1] };
  const mf = neg(f);
  const P = nodes.map((n) => add(mf, { x: n[0], y: n[1] }));
  const fam = new Array(nodes.length);
  nodes.forEach((n, i) => { fam[i] = n[3] === 0 ? -1 : n[3] === 1 ? i : fam[n[2]]; });
  const famIdx = new Map(); let c = 0; nodes.forEach((n, i) => { if (n[3] === 1) famIdx.set(i, c++); });
  const X = (p) => (R + p.x * R).toFixed(1), Y = (p) => (R - p.y * R).toFixed(1);
  let edges = '', dots = '';
  for (let i = 1; i < nodes.length; i++) {
    const a = P[nodes[i][2]], b = P[i];
    if (Math.hypot(b.x, b.y) > 0.9995 && Math.hypot(a.x, a.y) > 0.9995) continue;
    const col = PALETTE[(famIdx.get(fam[i]) ?? 0) % 8];
    const bl = add(neg(a), b), d = 2 * Math.atanh(Math.min(0.99999, Math.hypot(bl.x, bl.y))), ang = Math.atan2(bl.y, bl.x);
    let pts = '';
    for (let k = 0; k <= 8; k++) { const q = add(a, { x: Math.tanh((d * k) / 16) * Math.cos(ang), y: Math.tanh((d * k) / 16) * Math.sin(ang) }); pts += `${X(q)},${Y(q)} `; }
    edges += `<polyline points="${pts}" stroke="${col}" stroke-opacity="0.35" stroke-width="0.5" fill="none"/>`;
  }
  for (let i = 0; i < nodes.length; i++) {
    const p = P[i], r = Math.hypot(p.x, p.y); if (r > 0.9995) continue;
    const col = i === 0 ? '#fff' : PALETTE[(famIdx.get(fam[i]) ?? 0) % 8];
    dots += `<circle cx="${X(p)}" cy="${Y(p)}" r="${Math.max(0.5, 4.5 * (1 - r * r)).toFixed(2)}" fill="${col}" fill-opacity="0.85"/>`;
  }
  return `<div class="p"><div class="t">${title}</div><svg width="${2 * R}" height="${2 * R}"><circle cx="${R}" cy="${R}" r="${R - 0.5}" fill="#0b0d12" stroke="#445" /><g clip-path="circle(${R - 1}px at ${R}px ${R}px)">${edges}${dots}</g></svg></div>`;
}
const cols = [['base', 'production (today)'], ['A', 'A: adaptive length'], ['B', 'B: staggered rings']];
let html = '<html><body style="margin:0;background:#12141a;color:#ccd;font:13px system-ui"><style>.p{display:inline-block;margin:6px}.t{padding:2px 6px}</style>';
for (const [row, focus] of [['focus: root (whole tree)', null], ['focus: "syndrome" (486 children)', 'syndrome']])
  html += `<div>${cols.map(([k, t]) => panel(pos[k], focus, `${t} · ${row}`)).join('')}</div>`;
fs.writeFileSync(outFile, html + '</body></html>');
