// render_hybrid.mjs - draws the hybrid prototype layouts (from `hybrid.mjs --export pos.json`) for the two widest parents.
//   node tools/proto/render_hybrid.mjs pos.json out.html
// Each panel is the disk with the FOCUS on the wide parent, showing only what is visible in that disclosure state
// (families + their children, the path to the parent, the parent's children; optionally one group or all groups opened).
// Rings = aggregated groups (number = members), dots = real diseases, colour = top-level family.
import fs from 'node:fs';
const [, , posFile, outFile] = process.argv;
const dump = JSON.parse(fs.readFileSync(posFile, 'utf8'));
const add = (a, z) => { const nr = a.x + z.x, ni = a.y + z.y, dr = 1 + a.x * z.x + a.y * z.y, di = a.x * z.y - a.y * z.x, k = dr * dr + di * di; return { x: (nr * dr + ni * di) / k, y: (ni * dr - nr * di) / k }; };
const neg = (a) => ({ x: -a.x, y: -a.y });
const PALETTE = ['#7aa2f7', '#bb9af7', '#2ac3de', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64'];
const R = 180;

function load(label) {
  const raw = dump[label];
  const nodes = raw.map((r, id) => ({ id, x: r[0], y: r[1], parent: r[2], depth: r[3], name: r[4], members: r[5], isGroup: r[5] > 0, children: [] }));
  nodes.forEach((n) => { if (n.parent >= 0) nodes[n.parent].children.push(n); });
  const fam = new Array(nodes.length);
  let c = 0; const idx = new Map();
  nodes.forEach((n) => { if (n.depth === 1) idx.set(n.id, c++); fam[n.id] = n.depth === 0 ? -1 : n.depth === 1 ? n.id : fam[n.parent]; });
  nodes.forEach((n) => { n.famIdx = idx.get(fam[n.id]) ?? 0; });
  return nodes;
}
function visible(nodes, parentName, mode) {
  const parent = nodes.find((n) => n.name === parentName && !n.isGroup);
  const exp = new Set([nodes[0], ...nodes[0].children]);
  for (let a = parent; a; a = nodes[a.parent]) { exp.add(a); if (a.parent < 0) break; }
  exp.add(parent);
  const groups = parent.children.filter((c) => c.isGroup);
  if (mode === 'one' && groups.length) exp.add(groups.reduce((a, b) => (b.members > a.members ? b : a)));
  if (mode === 'all') (function open(n) { for (const c of n.children) if (c.isGroup) { exp.add(c); open(c); } })(parent);
  const vis = [nodes[0]];
  (function walk(n) { if (!exp.has(n)) return; for (const c of n.children) { vis.push(c); walk(c); } })(nodes[0]);
  const big = mode === 'one' && groups.length ? groups.reduce((a, b) => (b.members > a.members ? b : a)) : parent;
  return { parent, focus: big, vis };
}
function panel(label, parentName, mode, title) {
  const nodes = load(label), { parent, focus, vis } = visible(nodes, parentName, mode);
  const mf = neg({ x: focus.x, y: focus.y });
  const P = new Map(vis.map((n) => [n.id, add(mf, { x: n.x, y: n.y })]));
  const X = (p) => (R + p.x * R).toFixed(1), Y = (p) => (R - p.y * R).toFixed(1);
  let edges = '', dots = '', texts = '';
  for (const n of vis) {
    if (n.parent < 0 || !P.has(n.parent)) continue;
    const a = P.get(n.parent), b = P.get(n.id), col = PALETTE[n.famIdx % 8];
    const bl = add(neg(a), b), d = 2 * Math.atanh(Math.min(0.99999, Math.hypot(bl.x, bl.y))), ang = Math.atan2(bl.y, bl.x);
    let pts = '';
    for (let k = 0; k <= 8; k++) { const q = add(a, { x: Math.tanh((d * k) / 16) * Math.cos(ang), y: Math.tanh((d * k) / 16) * Math.sin(ang) }); pts += `${X(q)},${Y(q)} `; }
    edges += `<polyline points="${pts}" stroke="${col}" stroke-opacity="0.4" stroke-width="0.6" fill="none"/>`;
  }
  for (const n of vis) {
    const p = P.get(n.id), r = Math.hypot(p.x, p.y), col = n.id === 0 ? '#fff' : PALETTE[n.famIdx % 8];
    if (r > 0.9995) continue;
    const size = Math.max(0.6, 5 * (1 - r * r));
    if (n.isGroup) { dots += `<circle cx="${X(p)}" cy="${Y(p)}" r="${Math.max(2.5, size * 1.6).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.2"/>`; if (r < 0.93) texts += `<text x="${X(p)}" y="${(R - p.y * R - size * 1.6 - 2).toFixed(1)}" fill="#cde" font-size="8" text-anchor="middle">${n.members}</text>`; }
    else dots += `<circle cx="${X(p)}" cy="${Y(p)}" r="${size.toFixed(2)}" fill="${col}" fill-opacity="0.9"/>`;
  }
  dots += `<circle cx="${X(P.get(focus.id))}" cy="${Y(P.get(focus.id))}" r="4" fill="none" stroke="#fff" stroke-width="1.5"/>`;
  return `<div class="p"><div class="t">${title}<br><span>${vis.length} nodes visible</span></div><svg width="${2 * R}" height="${2 * R}"><circle cx="${R}" cy="${R}" r="${R - 0.5}" fill="#0b0d12" stroke="#445"/><g clip-path="circle(${R - 1}px at ${R}px ${R}px)">${edges}${dots}${texts}</g></svg></div>`;
}
let html = '<html><body style="margin:0;background:#12141a;color:#ccd;font:12px system-ui"><style>.p{display:inline-block;margin:4px;vertical-align:top}.t{padding:2px 6px;height:32px}.t span{color:#8a93b0}</style>';
const S1 = 'S1 B, all children visible', S2 = 'S2 B + static groups K=24', S4 = 'S5 hybrid, list cap 36';
html += `<div>${[panel(S1, 'syndrome', 'children', 'syndrome (486): B, all children visible'), panel(S2, 'syndrome', 'children', 'syndrome: 26 groups, closed'), panel(S2, 'syndrome', 'one', 'syndrome: largest group open, focus ON the group'), panel(S2, 'syndrome', 'all', 'syndrome: every group open')].join('')}</div>`;
html += `<div>${[panel(S1, 'autosomal recessive disease', 'children', 'autosomal recessive disease (1048): B, all visible'), panel(S4, 'autosomal recessive disease', 'children', 'same parent, hybrid: groups closed'), panel(S4, 'autosomal recessive disease', 'one', 'hybrid: largest group open, focus ON the group'), panel(S4, 'autosomal recessive disease', 'all', 'hybrid: every group open')].join('')}</div>`;
fs.writeFileSync(outFile, html + '</body></html>');
