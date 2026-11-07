// codepanel.test.js - the syntax colouring of the code panel (pure text -> HTML, no browser needed).
// Run: node tests/codepanel.test.js
import assert from 'node:assert/strict';
import { highlightLines } from '../src/codepanel.js';

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
console.log('codepanel.js highlighting: all checks passed');
