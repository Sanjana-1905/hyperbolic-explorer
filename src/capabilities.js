// capabilities.js - which optional features does the CURRENT dataset support? No drawing, no DOM: plain data in, plain data out.
//
// Why: the engine (Möbius maths, layout, rendering, search, minimap...) works for ANY tree. Some features only make sense for
// some kinds of data (a code repository has functions, a "Calls" arc and git history; WordNet has none of these). Instead of
// guessing from the data inside main3d.js, every dataset answers one question once: "which of these features do I support?".
// The rest of the app asks `caps.gitHeat`, never "is this a code repo?". A future dataset (e.g. the Disease Ontology) simply
// declares its own list and never has to pretend to be code.
//
// THE SCHEMA (an optional field of the tree JSON):
//     "capabilities": ["symbols", "codePanel", "gitHeat", "dependencies"]
//   symbols      files open into a galaxy of classes / functions (needs symbolsDir and nodes with hasSymbols)
//   codePanel    the source-code side panel (needs symbols and sourceDir)
//   gitHeat      the Heat button: colour by commits / recency (needs file nodes with `commits` and `modified`)
//   dependencies import / call arcs, the Imports / Calls / Dependencies chips, "Imported by" lists (needs symbols and linksFile)
//   A list that is present is the whole truth: a name that is missing is OFF, even if the data seems to be there.
//
// LEGACY DATASETS (no "capabilities" field: the sample repository, WordNet, anything the scanner made before this file existed)
// are INFERRED from the fields they already have, so they behave exactly as before and their JSON files did not have to change.
//
// A declared capability whose ingredients are missing is switched off with a warning (a promise the data cannot keep would
// show dead buttons). Unknown names are ignored with a warning (a typo should be visible, not fatal).

export const CAPABILITY_NAMES = ['symbols', 'codePanel', 'gitHeat', 'dependencies'];

// Walk the raw JSON tree (children arrays) once and report what is inside. Iterative: a deep tree must not overflow the stack.
function scanTree(json) {
  const found = { symbolFiles: 0, gitFiles: 0 };
  const stack = [json];
  while (stack.length) {
    const n = stack.pop();
    if (n.hasSymbols) found.symbolFiles++;
    if (n.type === 'file' && n.commits && n.modified) found.gitFiles++;
    if (n.children) for (const c of n.children) stack.push(c);
  }
  return found;
}

// json: the parsed tree file. Returns { symbols, codePanel, gitHeat, dependencies, source, warnings }.
//   source: 'declared' (the file has a "capabilities" list) or 'inferred' (legacy file).
// Example: the sample repo has symbolsDir, sourceDir, linksFile, hasSymbols files and commit data -> all four true (inferred).
//          WordNet has none of them -> all four false. A file saying "capabilities": ["gitHeat"] gets gitHeat only.
export function deriveCapabilities(json) {
  const warnings = [];
  const found = scanTree(json);
  // What the data can actually back up ("ingredients").
  const can = {
    symbols: !!json.symbolsDir && found.symbolFiles > 0,
    gitHeat: found.gitFiles > 0,
  };
  can.codePanel = can.symbols && !!json.sourceDir;
  can.dependencies = can.symbols && !!json.linksFile;

  const caps = {};
  let source;
  if (Array.isArray(json.capabilities)) {
    source = 'declared';
    const declared = new Set(json.capabilities);
    for (const name of declared) {
      if (!CAPABILITY_NAMES.includes(name)) warnings.push(`unknown capability "${name}" ignored`);
    }
    for (const name of CAPABILITY_NAMES) {
      caps[name] = declared.has(name);
      if (caps[name] && !can[name]) {
        caps[name] = false;
        warnings.push(`capability "${name}" is declared but the dataset has no data for it: switched off`);
      }
    }
  } else {
    source = 'inferred';
    for (const name of CAPABILITY_NAMES) caps[name] = can[name];
  }
  return Object.freeze({ ...caps, source, warnings });
}

// The "no capabilities" value used before a dataset has loaded (so nothing optional flashes on screen).
export const NO_CAPABILITIES = Object.freeze({ symbols: false, codePanel: false, gitHeat: false, dependencies: false, source: 'inferred', warnings: [] });
