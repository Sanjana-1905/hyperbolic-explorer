#!/usr/bin/env node
/**
 * parse_js.mjs - extract symbols, imports and called names from JS/TS files.
 *
 * Called by scan_folder.py (you normally never run it by hand).
 *   input  (stdin):  JSON array of absolute file paths
 *   output (stdout): one JSON object per line (NDJSON):
 *       {"path": "...", "ok": true,  "symbols": [...], "imports": [...], "calls": [...]}
 *       {"path": "...", "ok": false, "error": "..."}
 *
 * Parser: @babel/parser (free, handles modern JS, JSX and TypeScript in one go).
 * We walk the AST ourselves, so no other Babel package is needed.
 *
 * What counts as a symbol (kind):
 *   class     class declarations/expressions, TS interface / enum / namespace
 *   function  function declarations, `const f = () => ...`, `Foo.prototype.bar = function ...`
 *   method    functions inside a class body (including the constructor)
 * Symbols nest: class > method, function > nested function.
 * Anonymous callbacks (e.g. `items.map(x => ...)`) are NOT symbols; their calls count for the enclosing symbol.
 *
 * Every symbol: {kind, name, startLine, endLine, signature, calls:[...], children:[...]}
 *   calls = names called directly in that symbol's own body ("foo" or "obj.foo"; nested symbols have their own list).
 */

import fs from 'node:fs';
import { parse } from '@babel/parser';

const MAX_SIGNATURE = 140;

// ---------------------------------------------------------------- parsing

/** Parse source text. Tries JS+JSX first for .js-like files, TS first for .ts-like files. */
function parseSource(code, path) {
  const isTs = /\.(ts|tsx|mts|cts)$/.test(path);
  const attempts = isTs
    ? [['typescript', 'jsx'], ['typescript']]
    : [['jsx'], ['jsx', 'typescript'], ['jsx', 'flow']];
  let lastError;
  for (const plugins of attempts) {
    try {
      return parse(code, {
        sourceType: 'unambiguous', // works for both import/export files and CommonJS
        plugins: [...plugins, 'decorators-legacy', 'classProperties'],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- small helpers

const isFunctionNode = (n) =>
  n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

/** Text of the header: from `start` up to the start of `bodyNode`, whitespace collapsed and shortened. */
function header(code, start, bodyNode) {
  const end = bodyNode ? bodyNode.start : start + MAX_SIGNATURE;
  let text = code.slice(start, end).replace(/\s+/g, ' ').trim();
  text = text.replace(/\s*=>$/, ' =>').replace(/\s*\{$/, '').trim();
  return text.length > MAX_SIGNATURE ? text.slice(0, MAX_SIGNATURE - 1) + '…' : text;
}

/** "a.b.c" for a chain of plain identifiers/this, else null. */
function chainText(n) {
  if (!n) return null;
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
    const left = chainText(n.object);
    return left ? `${left}.${n.property.name}` : null;
  }
  return null;
}

/** Name of what a call calls: "foo", "obj.foo" (obj a plain identifier), or "foo" for this.foo() / a.b.foo(). */
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const prop = callee.property.type === 'Identifier' ? callee.property.name
      : callee.property.type === 'PrivateName' ? callee.property.id.name : null;
    if (!prop) return null;
    if (callee.object.type === 'Identifier') return `${callee.object.name}.${prop}`;
    return prop; // this.foo(), a.b.foo(), foo().bar() -> just "foo"/"bar"
  }
  return null; // computed calls, IIFEs, super(), import(): ignored
}

function keyName(key) {
  if (!key) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateName') return '#' + key.id.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
}

const stringValue = (n) =>
  n && n.type === 'StringLiteral' ? n.value
    : n && n.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null;

// ---------------------------------------------------------------- the walker

function extract(code, ast) {
  const imports = [];
  const rootScope = { calls: new Set(), children: [] };

  const addCall = (scope, name) => { if (name) scope.calls.add(name); };

  /** Make a symbol and walk its body. `headerStart` = where the signature text begins. */
  function makeSymbol(parentScope, kind, name, node, headerStart, bodyNode, bodyVisit) {
    const sym = {
      kind,
      name,
      startLine: node.loc.start.line,
      endLine: node.loc.end.line,
      signature: header(code, headerStart, bodyNode),
    };
    const scope = { calls: new Set(), children: [] };
    bodyVisit(scope);
    if (scope.calls.size) sym.calls = [...scope.calls]; // empty lists are left out to keep files small
    if (scope.children.length) sym.children = scope.children;
    parentScope.children.push(sym);
    return sym;
  }

  function visitFunctionLike(scope, kind, name, fn, headerStart) {
    // Parameter defaults/decorators belong to the function's own scope; walk params + body together.
    makeSymbol(scope, kind, name, fn, headerStart, fn.body, (inner) => {
      for (const p of fn.params || []) visit(p, inner);
      visit(fn.body, inner);
    });
  }

  function visitClass(scope, node, name, headerStart) {
    makeSymbol(scope, 'class', name, node, headerStart, node.body, (inner) => {
      if (node.superClass) visit(node.superClass, inner);
      for (const member of node.body.body) {
        if ((member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') && !member.computed) {
          const mname = keyName(member.key) || '[computed]';
          visitFunctionLike(inner, 'method', mname, member, member.start);
        } else if ((member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty')
          && isFunctionNode(member.value)) {
          // `handle = () => {...}` is a method too
          const mname = keyName(member.key) || '[computed]';
          visitFunctionLike(inner, 'method', mname, member.value, member.start);
        } else {
          visit(member, inner); // static blocks, other properties, computed methods
        }
      }
    });
  }

  function visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;

    switch (node.type) {
      // ---- imports ----
      case 'ImportDeclaration': {
        const names = node.specifiers.map((s) =>
          s.type === 'ImportDefaultSpecifier' ? `default as ${s.local.name}`
            : s.type === 'ImportNamespaceSpecifier' ? `* as ${s.local.name}`
              : (s.imported.name || s.imported.value) === s.local.name ? s.local.name
                : `${s.imported.name || s.imported.value} as ${s.local.name}`);
        imports.push({ from: node.source.value, names, line: node.loc.start.line });
        return;
      }
      case 'ExportAllDeclaration':
        imports.push({ from: node.source.value, names: ['*'], line: node.loc.start.line, reexport: true });
        return;
      case 'ExportNamedDeclaration':
        if (node.source) {
          imports.push({
            from: node.source.value,
            names: node.specifiers.map((s) => (s.local && s.local.name) || '*'),
            line: node.loc.start.line,
            reexport: true,
          });
          return;
        }
        break; // `export function f() {}` -> keep walking into the declaration
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference && node.moduleReference.expression) {
          imports.push({ from: node.moduleReference.expression.value, names: [node.id.name], line: node.loc.start.line });
        }
        return;

      // ---- symbols ----
      case 'FunctionDeclaration':
        visitFunctionLike(scope, 'function', node.id ? node.id.name : 'default', node, node.start);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression':
        visitClass(scope, node, node.id ? node.id.name : 'default', node.start);
        return;
      case 'TSInterfaceDeclaration':
      case 'TSEnumDeclaration':
      case 'TSModuleDeclaration':
        makeSymbol(scope, 'class', node.id.name || node.id.value || '?', node, node.start, node.body, (inner) => {
          if (node.body && node.body.type === 'TSModuleBlock') visit(node.body, inner);
        });
        return;

      case 'VariableDeclarator': {
        // const f = () => {...}   const C = class {...}   const f = function () {...}
        if (node.id.type === 'Identifier' && node.init) {
          if (isFunctionNode(node.init)) {
            visitFunctionLike(scope, 'function', node.id.name, node.init, node.start);
            return;
          }
          if (node.init.type === 'ClassExpression') {
            visitClass(scope, node.init, node.id.name, node.start);
            return;
          }
        }
        break;
      }
      case 'AssignmentExpression': {
        // Foo.prototype.bar = function () {...}   module.exports = function () {...}   exports.f = () => {...}
        const left = chainText(node.left);
        if (left && left !== 'this' && isFunctionNode(node.right) && node.operator === '=') {
          const kind = left.includes('.prototype.') ? 'method' : 'function';
          const name = left.replace(/^(module\.)?exports\.?/, '') || 'exports';
          visitFunctionLike(scope, kind, name, node.right, node.start);
          return;
        }
        break;
      }

      // ---- calls ----
      case 'ImportExpression': { // dynamic import('x') (Babel 8 node type)
        const spec = stringValue(node.source);
        if (spec !== null) imports.push({ from: spec, names: [], line: node.loc.start.line, dynamic: true });
        break;
      }
      case 'CallExpression': {
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'require' && node.arguments.length >= 1) {
          const spec = stringValue(node.arguments[0]);
          if (spec !== null) {
            imports.push({ from: spec, names: [], line: node.loc.start.line });
            return;
          }
        }
        if (callee.type === 'Import') { // dynamic import('x')
          const spec = stringValue(node.arguments[0]);
          if (spec !== null) imports.push({ from: spec, names: [], line: node.loc.start.line, dynamic: true });
          break;
        }
        addCall(scope, calleeName(callee));
        break;
      }
      case 'NewExpression':
        addCall(scope, calleeName(node.callee)); // `new Foo()` calls the class Foo
        break;
      default:
        break;
    }

    // Generic walk over every child node.
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type' || key === 'leadingComments' || key === 'trailingComments'
        || key === 'innerComments' || key === 'extra') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) visit(child, scope);
      else if (value && typeof value.type === 'string') visit(value, scope);
    }
  }

  visit(ast.program, rootScope);
  return { symbols: rootScope.children, imports, calls: [...rootScope.calls] };
}

// ---------------------------------------------------------------- main

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

const paths = JSON.parse(readStdin());
for (const path of paths) {
  try {
    const code = fs.readFileSync(path, 'utf8');
    const ast = parseSource(code, path);
    const result = extract(code, ast);
    process.stdout.write(JSON.stringify({ path, ok: true, ...result }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ path, ok: false, error: String(e.message || e).slice(0, 200) }) + '\n');
  }
}
