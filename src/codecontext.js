// src/codecontext.js

export function contextRange(from, to, totalLines, contextLines, lines = null) {
  let beforeFrom = Math.max(1, from - contextLines);
  let afterTo = Math.min(totalLines, to + contextLines);

  // Trim leading blank/empty context lines if lines array is available
  if (lines) {
    while (beforeFrom < from && beforeFrom <= totalLines) {
      const lineText = lines[beforeFrom - 1];
      if (lineText === undefined || lineText.trim() === '') {
        beforeFrom++;
      } else {
        break;
      }
    }
    // Trim trailing blank/empty context lines
    while (afterTo > to && afterTo >= 1) {
      const lineText = lines[afterTo - 1];
      if (lineText === undefined || lineText.trim() === '') {
        afterTo--;
      } else {
        break;
      }
    }
  }

  return { beforeFrom, beforeTo: from - 1, afterFrom: to + 1, afterTo };
}

export function neighbours(node) {
  if (!node || node.type !== 'symbol' || !node.parent || !node.parent.children) {
    return { prev: null, next: null };
  }
  const siblings = node.parent.children
    .filter(c => c.type === 'symbol' && c.kind !== 'block')
    .sort((a, b) => a.startLine - b.startLine);

  const idx = siblings.findIndex(s => s === node);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? siblings[idx - 1] : null,
    next: idx < siblings.length - 1 ? siblings[idx + 1] : null
  };
}

export function subtreeIndexes(doc, symIndex) {
  const symbols = doc && Array.isArray(doc.symbols) ? doc.symbols : [];
  if (symbols.some((sym) => Number.isInteger(sym.parentId))) {
    const set = new Set([symIndex]);
    const queue = [symIndex];
    while (queue.length) {
      const parentId = queue.shift();
      symbols.forEach((sym, index) => {
        if (sym.parentId === parentId && !set.has(index)) {
          set.add(index);
          queue.push(index);
        }
      });
    }
    return set;
  }

  const set = new Set();
  let index = 0;
  const visit = (list, include = false) => {
    for (const sym of list || []) {
      const currentIndex = index++;
      const included = include || currentIndex === symIndex;
      if (included) set.add(currentIndex);
      visit(sym.children, included);
    }
  };
  visit(symbols);
  return set;
}

export function callTargets(linkData, fileId, symSet, currentSymIndex) {
  if (!linkData) return new Map();
  const map = new Map();
  const names = linkData.names || {};
  const remember = (sourceFile, sourceSym, targetFile, targetSym, type, conf) => {
    if (sourceFile !== fileId || type !== 1 || targetSym < 0) return;
    if ((symSet && !symSet.has(sourceSym)) || sourceSym === currentSymIndex) return;
    const name = names[String(targetFile)]?.[targetSym] || '';
    const callName = name.split('.').pop();
    if (!callName) return;
    const previous = map.get(callName);
    if (!previous || conf > previous.conf) map.set(callName, { fileId: targetFile, sym: targetSym, name, conf });
  };

  if (linkData.fromFile) {
    for (let i = 0; i < linkData.count; i++) {
      remember(linkData.fromFile[i], linkData.fromSym[i], linkData.toFile[i], linkData.toSym[i],
        linkData.type[i], linkData.conf[i]);
    }
  } else {
    (linkData.links || []).forEach((link) => {
      if (link.source && link.target) {
        remember(link.source.fileId, link.source.sym, link.target.fileId, link.target.sym, link.type, link.conf || 0);
      }
    });
  }
  return map;
}

function normalizePath(path) {
  const parts = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function stripExtension(path) {
  return path.replace(/\.(?:[cm]?[jt]sx?|py)$/i, '');
}

export function resolveSpec(spec, importer) {
  if (typeof spec !== 'string' || typeof importer !== 'string') return { path: '', relative: false };
  const normalizedImporter = importer.replace(/\\/g, '/');
  const directory = normalizedImporter.includes('/') ? normalizedImporter.slice(0, normalizedImporter.lastIndexOf('/')) : '';

  if (normalizedImporter.endsWith('.py')) {
    const match = spec.match(/^\.+/);
    if (match) {
      const base = directory.split('/').filter(Boolean);
      for (let i = 1; i < match[0].length; i++) base.pop();
      const modulePath = spec.slice(match[0].length).replace(/\./g, '/');
      return { path: normalizePath([...base, modulePath].filter(Boolean).join('/')), relative: true };
    }
    const modulePath = spec.replace(/\./g, '/');
    return { path: normalizePath(modulePath), relative: false };
  }

  const relative = spec.startsWith('./') || spec.startsWith('../');
  const path = normalizePath(relative ? `${directory}/${spec}` : spec);
  let resolved = stripExtension(path);
  if (resolved.endsWith('/index')) resolved = resolved.slice(0, -6);
  return { path: resolved, relative };
}

function matchesPath(path, candidatePath) {
  const candidate = stripExtension(normalizePath(candidatePath || ''));
  const indexless = candidate.endsWith('/index') ? candidate.slice(0, -6) : candidate;
  return candidate === path || indexless === path;
}

export function matchImport(spec, importer, candidates) {
  if (!Array.isArray(candidates)) return null;
  const resolved = resolveSpec(spec, importer);
  if (!resolved.path) return null;
  if (resolved.relative) return candidates.find((candidate) => matchesPath(resolved.path, candidate.path)) || null;
  return candidates.find((candidate) => {
    const candidatePath = stripExtension(normalizePath(candidate.path || ''));
    const indexless = candidatePath.endsWith('/index') ? candidatePath.slice(0, -6) : candidatePath;
    return candidatePath === resolved.path || indexless === resolved.path ||
      candidatePath.endsWith(`/${resolved.path}`) || indexless.endsWith(`/${resolved.path}`);
  }) || null;
}

export function importTargets(imports, relFilePath, candidates) {
  const map = new Map();
  if (!imports) return map;
  imports.forEach(imp => {
    const spec = imp.from || imp.path;
    const match = matchImport(spec, relFilePath, candidates);
    if (match) {
      map.set(imp.line, { fileId: match.fileId, sym: -1, spec });
    }
  });
  return map;
}

export function definitionLines(doc) {
  const lines = new Set();
  const visit = (symbols) => {
    for (const symbol of symbols || []) {
      if (symbol.startLine) lines.add(symbol.startLine);
      visit(symbol.children);
    }
  };
  if (doc) visit(doc.symbols);
  return lines;
}