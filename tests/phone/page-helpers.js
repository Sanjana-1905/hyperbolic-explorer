// page-helpers.js - code that audit.mjs injects INTO the page (so it can look at __explorer directly and read pixels).
// Everything lives on window.__T. It never changes the viewer except through __explorer's test hooks.
(() => {
  const E = window.__explorer;

  // ---- which node stands for a link end right now (independent re-implementation of main3d's resolveEnd) ----
  const resolve = (fileId, sym, folder) => {
    const file = E.fileNode(fileId);
    if (!file) return null;
    let n = (sym >= 0 && E.symNode(fileId, sym)) || file;
    while (n && n.state === 1) n = n.parent;               // hidden inside a collapsed folder / class: its "+N" orb
    if (folder) while (n && n.depth > folder.depth + 2) n = n.parent;   // folder focus merges ends two levels below the folder
    return n;
  };

  // ---- rectangles of interface that covers the picture (taps there would hit buttons, not nodes) ----
  const blockers = () => ['#code.open', '#tools', '#map', '#info', '#crumbs', '#card.open', '#legend', '#fps']
    .map((s) => document.querySelector(s)).filter((el) => el && el.offsetParent !== null || (el && getComputedStyle(el).position === 'fixed' && getComputedStyle(el).display !== 'none'))
    .map((el) => el.getBoundingClientRect());
  const blocked = (x, y, pad = 14) => blockers().some((r) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
  const onScreen = (p) => p && p.x > 8 && p.y > 8 && p.x < innerWidth - 8 && p.y < innerHeight - 8;
  const tappable = (p) => onScreen(p) && !blocked(p.x, p.y);

  // ---- arcs: every drawn arc starts and ends at the right node, in the right direction, in the GPU buffers too ----
  function arcAudit() {
    const arcs = E.arcDetails();
    const folder = E.focusNode.type === 'folder' ? E.focusNode : null;
    const problems = [];
    const keys = new Set();
    const close = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 2e-5;
    arcs.forEach((a, i) => {
      if (a.a === a.b) problems.push(`arc ${i}: both ends are node ${a.a} (self link not dropped)`);
      if (keys.has(a.key)) problems.push(`arc ${i}: duplicate arc ${a.key} (not merged)`);
      keys.add(a.key);
      if (a.count !== a.links.length) problems.push(`arc ${i}: count ${a.count} != ${a.links.length} links`);
      for (const [ff, fs, tf, ts] of a.links) {
        const A = resolve(ff, fs, folder), B = resolve(tf, ts, folder);
        if (!A || !B || A.id !== a.a || B.id !== a.b) problems.push(`arc ${i}: link ${ff}.${fs}->${tf}.${ts} resolves to ${A && A.id}->${B && B.id} but the arc is ${a.a}->${a.b}`);
      }
      if (!close(a.gpuP0, a.posA)) problems.push(`arc ${i}: GPU start point is not the source node ${a.a}`);
      if (!close(a.gpuP4, a.posB)) problems.push(`arc ${i}: GPU end point is not the target node ${a.b}`);
      const s0 = E.arcScreenPos(i, 0), s1 = E.arcScreenPos(i, 1), na = E.screenPos(a.a), nb = E.screenPos(a.b);
      if (s0 && na && Math.hypot(s0.x - na.x, s0.y - na.y) > 1.5) problems.push(`arc ${i}: curve starts ${Math.hypot(s0.x - na.x, s0.y - na.y).toFixed(1)} px from node ${a.a}`);
      if (s1 && nb && Math.hypot(s1.x - nb.x, s1.y - nb.y) > 1.5) problems.push(`arc ${i}: curve ends ${Math.hypot(s1.x - nb.x, s1.y - nb.y).toFixed(1)} px from node ${a.b}`);
      if (a.far !== a.a && a.far !== a.b) problems.push(`arc ${i}: far end ${a.far} is neither end of the arc`);
    });
    if (arcs.length > 300) problems.push(`${arcs.length} arcs (limit 300)`);
    const selected = E.selectedLinks;
    const total = arcs.reduce((s, a) => s + a.count, 0);
    if (total > selected) problems.push(`arcs stand for ${total} links but only ${selected} were selected`);
    return { arcs: arcs.length, merged: arcs.filter((a) => a.count > 1).length, links: total, selected, problems };
  }

  // ---- tree edges: what is drawn must be what the CPU predicts, and nothing else ----
  // Draw ONLY the edge layer, read the pixels, and compare with the CPU polylines (same maths as the vertex shader).
  //  stray   = lit pixels not within STRAY_PX of any predicted edge     (an edge that should not be there / is in the wrong place)
  //  missing = predicted edges near the focus that are (mostly) not lit (an edge that is not drawn: dangling node)
  function edgeAudit(nearD = 1.4) {
    E.setLayers({ nodes: false, halos: false, sun: false, dust: false, nebula: false, haze: false, links: false, edges: true });
    const polys = E.edgePolylines();
    const f = E.readFrame();
    E.setLayers({ nodes: true, halos: true, sun: true, dust: true, nebula: true, haze: true, links: true, edges: true });
    const W = f.w, H = f.h, S = E.pixelScale, d = f.data;
    const bg = [d[0], d[1], d[2]];
    const lit = new Uint8Array(W * H);
    let litCount = 0;
    for (let y = 0; y < H; y++) {
      const row = (H - 1 - y) * W * 4;                     // readPixels rows are bottom-up
      for (let x = 0; x < W; x++) {
        const i = row + x * 4;
        if (Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) > 10) { lit[y * W + x] = 1; litCount++; }
      }
    }
    // predicted mask: fat polylines
    const cv = new OffscreenCanvas(W, H);
    const g = cv.getContext('2d');
    g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#fff';
    for (const p of polys) {
      g.beginPath();
      let pen = false;
      for (const q of p.pts) {
        if (!q) { pen = false; continue; }
        if (pen) g.lineTo(q.x * S, q.y * S); else { g.moveTo(q.x * S, q.y * S); pen = true; }
      }
      g.stroke();
    }
    const mk = g.getImageData(0, 0, W, H).data;
    let stray = 0;
    const cells = new Map();
    for (let i = 0; i < W * H; i++) {
      if (lit[i] && mk[i * 4 + 3] < 60) {
        stray++;
        const key = `${Math.floor(((i % W) / S) / 40) * 40},${Math.floor((Math.floor(i / W) / S) / 40) * 40}`;
        cells.set(key, (cells.get(key) || 0) + 1);
      }
    }
    // missing: sample the inside of every near edge
    let checked = 0;
    const missing = [];
    for (const p of polys) {
      if (p.d > nearD) continue;
      let seen = 0, hit = 0;
      for (let k = 3; k <= 9; k++) {
        const q = p.pts[k];
        if (!q) continue;
        const x = Math.round(q.x * S), y = Math.round(q.y * S);
        if (x < 6 || y < 6 || x >= W - 6 || y >= H - 6) continue;
        seen++;
        let found = false;
        for (let dy = -3; dy <= 3 && !found; dy++) for (let dx = -3; dx <= 3; dx++) if (lit[(y + dy) * W + x + dx]) { found = true; break; }
        if (found) hit++;
      }
      if (seen >= 3) { checked++; if (hit / seen < 0.6) missing.push({ child: p.child, parent: p.parent, hit, seen }); }
    }
    return {
      edges: polys.length, near: checked, litPixels: litCount, strayPixels: stray, strayFraction: litCount ? stray / litCount : 0,
      strayCells: [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), missing: missing.slice(0, 6), missingCount: missing.length,
    };
  }

  // Tap-target helpers
  function tappableArcs() {
    const out = [];
    E.arcDetails().forEach((a, i) => {
      const p = E.screenPos(a.far);
      if (a.role === 'focus' && tappable(p) && E.pick(p.x, p.y) === a.far) out.push({ i, far: a.far, x: p.x, y: p.y, a });
    });
    return out;
  }
  // A point on the arc, near its far end, that is not over any node: for "tap the arc itself".
  function arcBodyPoints() {
    const out = [];
    E.arcDetails().forEach((a, i) => {
      if (a.role !== 'focus') return;
      const tFar = a.far === a.b ? 0.8 : 0.2;                // 80 % of the way toward the far end
      const p = E.arcScreenPos(i, tFar);
      if (tappable(p) && E.pick(p.x, p.y) === null) out.push({ i, far: a.far, x: p.x, y: p.y, farIsB: a.far === a.b, a });
    });
    return out;
  }
  // The node a followed arc must land on (independent of main3d): the exact symbol/file at the far end, or the drawn node.
  function expectedTarget(a) {
    if (a.target.node !== undefined) return a.target.node;
    const sym = a.target.sym >= 0 ? E.symNode(a.target.fileId, a.target.sym) : null;
    return (sym || E.fileNode(a.target.fileId)).id;
  }
  const landedOn = (id) => E.focusId() === id && E.shownR(id) < 1e-6;

  window.__T = { E, resolve, blocked, tappable, arcAudit, edgeAudit, tappableArcs, arcBodyPoints, expectedTarget, landedOn };
})();
