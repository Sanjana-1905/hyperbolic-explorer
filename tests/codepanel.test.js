// codepanel.test.js - the syntax colouring of the code panel (pure text -> HTML, no browser needed).
// Run: node tests/codepanel.test.js
import assert from 'node:assert/strict';
import { highlightLines, trimBlankSourceEdges } from '../src/codepanel.js';

// Whole-file views hide blank edges but retain the original source line numbers.
const sourceWithLeadingBlanks = ['', '', 'import a from "b"', 'const value = 1;', ''];
const visibleRange = trimBlankSourceEdges(sourceWithLeadingBlanks, 1, sourceWithLeadingBlanks.length);
assert.deepEqual(visibleRange, { first: 3, end: 4 });
assert.equal(visibleRange.first, 3, 'the first visible line keeps its source line number');

// JS: keyword, string, number, comment, and HTML in the code is escaped.
let l = highlightLines("const a = 'x<y' + 42; // note", 'js');
assert.equal(l.length, 1);
assert.ok(l[0].includes('<span class="cp-k">const</span>'), 'keyword');
assert.ok(l[0].includes('<span class="cp-s">\'x&lt;y\'</span>'), 'string, escaped');
assert.ok(l[0].includes('<span class="cp-n">42</span>'), 'number');
assert.ok(l[0].includes('<span class="cp-c">// note</span>'), 'comment');

// A block comment over three lines is cut at the line breaks, so every line stays balanced.
l = highlightLines('/* a\n b\n c */\nlet z;', 'js');
assert.equal(l.length, 4);
assert.ok(l[1].startsWith('<span class="cp-c">') && l[1].endsWith('</span>'), 'middle line of a block comment');
assert.ok(l[3].includes('cp-k'), 'code after the comment is coloured again');

// Python: # comments, triple-quoted strings, def/return keywords.
l = highlightLines('def f(x):\n    """doc\n    more"""\n    return x  # done', 'py');
assert.equal(l.length, 4);
assert.ok(l[0].includes('<span class="cp-k">def</span>'));
assert.ok(l[1].includes('cp-s') && l[2].includes('cp-s'), 'docstring over two lines');
assert.ok(l[3].includes('<span class="cp-c"># done</span>'));

// Words that merely CONTAIN a keyword are left alone: "constant" is not "const", "classify" is not "class".
l = highlightLines('constant = classify(1)', 'js');
assert.ok(!l[0].includes('cp-k'), 'no keyword inside identifiers');
// Phase 4d: call names in the `calls` set become tappable tokens; strings, comments, keywords and other names do not.
l = highlightLines('  foo(1); bar(2); // foo(3)\n  const s = "foo(x)"; if (foo) {}', 'js', { calls: new Set(['foo']) });
assert.ok(l[0].includes('<span class="cp-call" data-call="foo">foo</span>('), 'a call in the set is a token');
assert.ok(!l[0].includes('data-call="bar"'), 'a call not in the set is not');
assert.equal((l[0].match(/cp-call/g) || []).length, 1, 'the call inside a comment is not');
assert.ok(!l[1].includes('cp-call'), 'a name inside a string, or used without "(", is not');
// firstLine / skipLines: a line that DEFINES a symbol is never a call
l = highlightLines('function foo(a) {\n  foo(a - 1);\n}', 'js', { calls: new Set(['foo']), firstLine: 10, skipLines: new Set([10]) });
assert.ok(!l[0].includes('cp-call') && l[1].includes('cp-call'), 'definition line (10) skipped, the call on line 11 kept');
// Python and `this.name(` / `new Name(`
l = highlightLines('x = self.run(1) + Helper(2)', 'py', { calls: new Set(['run', 'Helper']) });
assert.equal((l[0].match(/cp-call/g) || []).length, 2);
// Without options nothing changes (the old behaviour).
assert.ok(!highlightLines('foo(1)', 'js')[0].includes('cp-call'));
console.log('codepanel.js highlighting: all checks passed');