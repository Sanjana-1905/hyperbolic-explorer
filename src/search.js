// search.js - a lightweight name index and fuzzy search over the WHOLE tree (no drawing, no DOM).
//
// What is indexed: every folder and file name of the tree (instantly, from the loaded tree) and every symbol
// name (class / function / method) of every file, added in the background as the symbol files arrive
// (main3d.js fetches them a few at a time, so the page never freezes). Search works at any moment; symbols that
// are not indexed yet simply do not show up until their file has been read.
//
// An entry is stored in parallel arrays (fast to scan, little memory):
//   name        as written ("getNode", "parser.py")
//   lower       lower-case copy, for matching
//   mask        a 32-bit "which letters does it contain" fingerprint (see letterMask), for a very cheap reject
//   kind        0 folder, 1 file, 2 class, 3 function, 4 method
//   path        where it lives: "repo/src/utils", or for a symbol "repo/src/utils/math.js › Vec"
//   baseId      tree node id (folders and files), -1 for symbols
//   fileId      scanner file id of the file the symbol is in (files too), -1 for folders
//   sym         symbol index inside that file (the scanner's pre-order numbering), -1 for files and folders

export const KIND = { folder: 0, file: 1, class: 2, function: 3, method: 4 };

// A "letter fingerprint": bit k is set if the text contains letter k (a-z -> bits 0..25), bit 26 = a digit,
// bit 27 = anything else (the characters _ - . and so on). A query can only be a subsequence of a name if every
// bit of the query is also set in the name, so (queryMask & ~nameMask) !== 0 rejects the name in one operation.
// Example: "abc" -> bits 0,1,2 = 0b111. "cab" has the same mask, "cat" lacks bit 1: rejected at once.
export function letterMask(text) {
  let m = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 97 && c <= 122) m |= 1 << (c - 97);
    else if (c >= 48 && c <= 57) m |= 1 << 26;
    else m |= 1 << 27;
  }
  return m;
}

// Is position i of `name` the start of a "word"? After a separator (_ - . / space), or a capital after a lower-case
// letter (camelCase). Example: in "getNodeName" the word starts are g(0), N(3), N(7).
function wordStart(name, i) {
  if (i === 0) return true;
  const prev = name.charCodeAt(i - 1), cur = name.charCodeAt(i);
  const isLower = (c) => c >= 97 && c <= 122;
  const isUpper = (c) => c >= 65 && c <= 90;
  const isAlnum = (c) => isLower(c) || isUpper(c) || (c >= 48 && c <= 57);
  return !isAlnum(prev) || (isLower(prev) && isUpper(cur));
}

// How well does the lower-case query q match the name? 0 = not at all, bigger = better.
//   1000          the name IS the query
//   900 - extra   the name starts with the query ("pars" in "parser": extra = 2 unused letters)
//   700 - ...     the query starts a word inside the name ("node" in "getNode")
//   500 - ...     the query appears somewhere inside the name
//   <= 300        the letters appear in order, with gaps ("gtnd" in "getNode"): fuzzy match
// "...": minus the position and minus half the unused letters, so earlier and tighter matches win.
// Example: q = "node": "node" -> 1000; "nodes" -> 899; "getNode" -> 700 - 3 - 1.5 = 695.5; "mynodes" -> 500 - 2 - 1.5 = 496.5.
export function scoreName(q, qmask, name, lower, mask) {
  if ((qmask & ~mask) !== 0) return 0;               // missing a letter: cannot match
  if (lower === q) return 1000;
  if (lower.startsWith(q)) return 900 - (lower.length - q.length);
  const at = lower.indexOf(q);
  if (at >= 0) {
    // Prefer an occurrence that starts a word: look at every occurrence, keep the best.
    let best = -1;
    for (let i = at; i >= 0; i = lower.indexOf(q, i + 1)) {
      if (wordStart(name, i)) { best = i; break; }
    }
    if (best >= 0) return 700 - best - (lower.length - q.length) * 0.5;
    return 500 - at - (lower.length - q.length) * 0.5;
  }
  // Fuzzy: walk through the name once, taking the letters of q in order. Gaps cost points, matches at word starts earn some.
  let qi = 0, gaps = 0, bonus = 0, last = -2;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower.charCodeAt(i) === q.charCodeAt(qi)) {
      if (i !== last + 1) gaps++;
      if (wordStart(name, i)) bonus += 15;
      last = i; qi++;
    }
  }
  if (qi < q.length) return 0;
  return Math.max(1, 250 - gaps * 25 + bonus - (lower.length - q.length) * 0.5);
}

// Small bonus so that, between equally good name matches, files and classes come before folders and methods.
const KIND_BONUS = [4, 6, 5, 3, 1];

export function createIndex() {
  const names = [], lowers = [], paths = [], pathLowers = [];
  const masks = [], kinds = [], baseIds = [], fileIds = [], syms = [], depths = [];
  let symbolFilesIndexed = 0;

  function add(name, kind, path, baseId, fileId, sym, depth) {
    names.push(name);
    const lower = name.toLowerCase();
    lowers.push(lower);
    masks.push(letterMask(lower));
    kinds.push(kind);
    paths.push(path);
    pathLowers.push(null);          // filled in only if a multi-word query needs it
    baseIds.push(baseId); fileIds.push(fileId); syms.push(sym); depths.push(depth);
  }

  return {
    get size() { return names.length; },
    get symbolFilesIndexed() { return symbolFilesIndexed; },

    // Folders and files of the loaded tree. `nodes` = the base tree nodes, `pathOf(node)` = their path text.
    addTree(nodes, pathOf) {
      for (const n of nodes) {
        if (n.type === 'folder' && !n.parent) continue;                     // the root has nothing to jump to
        add(n.name, n.type === 'folder' ? KIND.folder : KIND.file, pathOf(n.parent), n.id,
          n.hasSymbols ? n.fileId : -1, -1, n.depth);
      }
    },

    // The symbols of one file, from its symbols document. `file` = the file's tree node, `filePath` its path text.
    // Symbol numbering is the scanner's: pre-order position in the nested list (container first, then its children).
    addFileSymbols(file, filePath, doc) {
      let index = 0;
      const walk = (list, trail) => {
        for (const s of list) {
          const here = index++;
          const kind = s.kind === 'class' ? KIND.class : s.kind === 'method' ? KIND.method : KIND.function;
          add(s.name, kind, trail ? `${filePath} › ${trail}` : filePath, -1, file.fileId, here, file.depth + 1 + trail.split('.').filter(Boolean).length);
          if (s.children && s.children.length) walk(s.children, trail ? `${trail}.${s.name}` : s.name);
        }
      };
      walk(doc.symbols || [], '');
      symbolFilesIndexed++;
    },

    // Best `limit` matches for the text. Words are separated by spaces: the FIRST word is matched against the name;
    // every further word must appear in the name or in the path ("api client" = something called client under api).
    search(text, limit = 10) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const q = words[0], qmask = letterMask(q);
      const extra = words.slice(1);
      const hits = [];                       // { i, score }
      let worst = -Infinity;                 // score of the weakest kept hit once we hold `limit` of them
      for (let i = 0; i < names.length; i++) {
        let s = scoreName(q, qmask, names[i], lowers[i], masks[i]);
        if (s === 0) continue;
        if (extra.length) {
          let ok = true;
          for (const w of extra) {
            if (lowers[i].includes(w)) continue;
            if (pathLowers[i] === null) pathLowers[i] = paths[i].toLowerCase();
            if (!pathLowers[i].includes(w)) { ok = false; break; }
          }
          if (!ok) continue;
        }
        s += KIND_BONUS[kinds[i]] - depths[i] * 0.01;      // tie-breakers: kind, then nearer the top
        if (hits.length === limit && s <= worst) continue;
        hits.push({ i, score: s });
        if (hits.length > limit * 4) { hits.sort((a, b) => b.score - a.score); hits.length = limit; }
        if (hits.length >= limit) { worst = hits.length === limit ? Math.min(...hits.map((h) => h.score)) : worst; }
      }
      hits.sort((a, b) => b.score - a.score || names[a.i].length - names[b.i].length || a.i - b.i);
      return hits.slice(0, limit).map((h) => this.describe(h.i, h.score));
    },

    describe(i, score = 0) {
      return { name: names[i], kind: kinds[i], path: paths[i], baseId: baseIds[i], fileId: fileIds[i], sym: syms[i], score };
    },
  };
}
