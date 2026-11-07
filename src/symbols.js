// symbols.js - turn a file's symbol data (from the scanner) into nodes, and load it lazily.
//
// No drawing and no three.js here, so it can be tested from the command line.
//
// A symbol node looks like a folder/file node (same fields the layout and viewer use), plus:
//   type 'symbol', kind 'class' | 'function' | 'method' | 'block', startLine, endLine, signature,
//   calls (names it calls), file (the file node it belongs to), symIndex (its number in links.json, Phase 4c).
// `kindCode` is the number the shader reads from the aKind attribute.

import { THEME } from './theme.js';

// Shader codes of aKind: 0 file, 1 folder (as before), then one per symbol kind.
export const KIND_CODE = { file: 0, folder: 1, class: 2, function: 3, method: 4, block: 5 };

// At most this many symbol nodes per file (breadth first, so top-level symbols always survive).
export const MAX_SYMBOLS_PER_FILE = 400;

// Hue of a symbol = hue of its file's extension (theme.js has the numbers).
// Example: "ts" -> EXT_HUE_TS (azure), "md" -> EXT_HUE_OTHER.
export function extHue(ext) {
  switch ((ext || '').toLowerCase()) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': return THEME.EXT_HUE_JS;
    case 'ts': case 'tsx': case 'mts': case 'cts': return THEME.EXT_HUE_TS;
    case 'py': return THEME.EXT_HUE_PY;
    default: return THEME.EXT_HUE_OTHER;
  }
}

// A deterministic "random" 0..1 per node (an integer hash), so twinkles/breathing are the same every run.
export function hash01(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Build the symbol nodes of `file` from its symbols document (the JSON the scanner wrote).
// Returns the list of ALL new nodes (parents before children). They are NOT yet attached to the file,
// have no `id` (the viewer assigns a buffer slot) and no `pos` (layoutSymbols assigns it).
//
// Size = lines of code: energy 0..1 is the log of a symbol's line count rescaled over this file's symbols,
//   energy = (ln lines − ln fewest) / (ln most − ln fewest)
// Example: symbols with 4, 40 and 400 lines: ln = 1.39, 3.69, 5.99 -> energy 0, 0.5, 1
// (a single symbol, or all equal: 0.5). The shader turns energy into a radius.
export function buildSymbolNodes(file, doc) {
  const hue = extHue(file.ext);
  const all = [];

  // Symbol index (Phase 4c): the position of each symbol in a depth-first PRE-ORDER walk of the nested list
  // (class A = 0, its methods 1, 2, then the next top-level symbol 3 ...). The scanner's links.json names symbols by
  // this index, so it must not depend on the breadth-first order below or on the 400-symbol cut.
  const preIndex = new Map();
  const number = (list) => { for (const s of list || []) { preIndex.set(s, preIndex.size); number(s.children); } };
  number(doc.symbols);

  // Breadth-first so that when we hit the limit, the dropped nodes are the deepest ones.
  const queue = (doc.symbols || []).map((s) => ({ raw: s, parent: file }));
  if ((doc.calls || []).length) {
    // Code that sits outside every function/class: one "block" node covering the whole file.
    queue.push({ raw: { kind: 'block', name: '(top level)', startLine: 1, endLine: Math.max(doc.loc || 1, 1),
      signature: 'top-level code', calls: doc.calls }, parent: file });
  }
  for (let i = 0; i < queue.length && all.length < MAX_SYMBOLS_PER_FILE; i++) {
    const { raw, parent } = queue[i];
    const node = {
      id: -1,                       // buffer slot, assigned by the viewer
      name: raw.name,
      type: 'symbol',
      kind: raw.kind,
      kindCode: KIND_CODE[raw.kind] ?? KIND_CODE.function,
      size: Math.max(1, raw.endLine - raw.startLine + 1), // lines (a folder's `size` is bytes; unused for symbols)
      startLine: raw.startLine, endLine: raw.endLine, signature: raw.signature || raw.name,
      calls: raw.calls || [],
      symIndex: preIndex.has(raw) ? preIndex.get(raw) : -1, // -1 = the "(top level)" block: stands for the file's own code
      parent, children: [], depth: parent.depth + 1, weight: 1,
      file, hue, flag: 0, state: 0, collapsed: false, onPath: false,
      seed: hash01((file.fileId ?? file.id) * 7919 + all.length),
      pos: null,
    };
    parent.children.push(node);
    all.push(node);
    for (const child of raw.children || []) queue.push({ raw: child, parent: node });
  }

  // weight = nodes in the subtree (children first: walk the list backwards)
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].parent !== file) all[i].parent.weight += all[i].weight;
  }

  const lines = all.filter((n) => n.kind !== 'block').map((n) => Math.log(n.size));
  const lo = Math.min(...lines), hi = Math.max(...lines);
  for (const n of all) {
    n.energy = n.kind === 'block' ? THEME.BLOCK_ENERGY : (hi > lo ? (Math.log(n.size) - lo) / (hi - lo) : 0.5);
  }

  // The caller attaches them to the file; detach here so a failed layout leaves the file untouched.
  file.children = [];
  return all;
}

// ---------------------------------------------------------------------------
// Lazy loading with a cache
// ---------------------------------------------------------------------------

// `baseUrl` = folder holding the tree file (ends with "/"); `symbolsDir` / `sourceDir` come from the
// tree JSON (relative to that folder; sourceDir may be missing).
// getDoc(file)    -> Promise of the symbols document, or null if the file has none
// getLines(file)  -> Promise of the file's source as an array of lines, or null if there is no source
export function createSymbolStore(baseUrl, symbolsDir, sourceDir) {
  const docs = new Map();
  const sources = new Map();
  const fetchOnce = (cache, key, url, parse) => {
    if (!cache.has(key)) {
      cache.set(key, fetch(url).then((r) => (r.ok ? parse(r) : null)).catch(() => null));
    }
    return cache.get(key);
  };
  return {
    getDoc(file) {
      if (!file.hasSymbols || symbolsDir == null) return Promise.resolve(null);
      return fetchOnce(docs, file.fileId, `${baseUrl}${symbolsDir}/${file.fileId}.json`, (r) => r.json());
    },
    getLines(file) {
      if (!file.hasSymbols || sourceDir == null) return Promise.resolve(null);
      return fetchOnce(sources, file.fileId, `${baseUrl}${sourceDir}/${file.fileId}.txt`,
        (r) => r.text().then((t) => t.split('\n')));
    },
  };
}
