// study.test.js - study mode data (Phase 6d): event summaries, correctness, CSV export, and the task files. Run: node tests/study.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  depthOfPath, newSession, startTask, logEvent, finishTask, isCorrect, toCsvTasks, toCsvEvents, summarizeSession,
} from '../src/studylog.js';

// depth: root = 0; a symbol is one level below its file.
assert.equal(depthOfPath('repo'), 0);
assert.equal(depthOfPath('repo/src/utils/math.js'), 3);
assert.equal(depthOfPath('repo/src/utils/math.js › Vec'), 4);

// correctness: the file, or one of its symbols
assert.ok(isCorrect('repo/a/b.js', 'repo/a/b.js'));
assert.ok(isCorrect('repo/a/b.js › Vec', 'repo/a/b.js'));
assert.ok(!isCorrect('repo/a/b.json', 'repo/a/b.js'), 'a longer name is not the target');
assert.ok(!isCorrect('repo/a', 'repo/a/b.js'));

// A task: focus 0 -> 2 (down), -> 3, -> 1 (up: a backtrack), -> 4; one 'auto' focus (not counted); some raw events.
const session = newSession({ participant: 'P1', condition: '3d', dataset: 'sample_tree.json', env: { width: 1000 } });
const task = { id: 't1', practice: false, text: 'Find "b.js", with a comma, and "quotes"', target: 'repo/a/b.js' };
const cur = startTask(task, 1000, 0);
logEvent(cur, 1500, 'click', { x: 0.5, y: 0.5 });
logEvent(cur, 2000, 'focus', { path: 'repo/a', depth: 1, source: 'canvas' });
logEvent(cur, 2600, 'focus', { path: 'repo/a/x', depth: 2, source: 'canvas' });
logEvent(cur, 3000, 'focus', { path: 'repo/a/x/y', depth: 3, source: 'search', query: 'y' });
logEvent(cur, 3100, 'focus', { path: 'repo/a/x/y/z', depth: 4, source: 'auto' });
logEvent(cur, 4000, 'focus', { path: 'repo/a', depth: 1, source: 'toolbar:Up' });
logEvent(cur, 5000, 'focus', { path: 'repo/a/b.js', depth: 2, source: 'canvas' });
const rec = finishTask(cur, 6000, 'found', 'repo/a/b.js');
assert.equal(rec.elapsedMs, 5000);
assert.equal(rec.actions, 5, 'auto focus changes are not counted: 5 of 6');
assert.equal(rec.backtracks, 1, 'one move to a shallower node (depth 3 -> 1)');
assert.equal(rec.maxDepth, 4);
assert.equal(rec.rawEvents, 7);
assert.equal(rec.correct, true);
assert.equal(rec.events[0].t, 500, 'event times are relative to the task start');
session.tasks.push(rec);
const skipped = finishTask(startTask({ id: 't2', text: 'x', target: 'repo/q' }, 7000, 0), 9000, 'skipped', 'repo');
assert.equal(skipped.correct, null);
session.tasks.push(skipped);

// CSV: one header + one row per task; commas and quotes are escaped; events CSV has one row per event.
const csv = toCsvTasks(session).trimEnd().split('\n');
assert.equal(csv.length, 3);
assert.ok(csv[0].startsWith('participant,condition,dataset,task'));
assert.ok(csv[1].includes('"Find ""b.js"", with a comma, and ""quotes"""'), 'text is quoted and escaped');
assert.ok(csv[1].startsWith('P1,3d,sample_tree.json,t1,false,found,true,5000,5,1,4,7'));
const ev = toCsvEvents(session).trimEnd().split('\n');
assert.equal(ev.length, 1 + 7, 'header + 7 events');
assert.ok(ev.some((l) => l.includes('search') && l.includes('{""query"":""y""}')), 'extra detail kept as JSON');

const sum = summarizeSession(session);
assert.deepEqual([sum.tasks, sum.found, sum.correct], [2, 1, 1]);
assert.equal(sum.meanSecondsCorrect, 5);

// The committed task files: every target exists exactly once in its dataset, "folder name + file name" is unique, depth spread.
for (const [tasksFile, treeFile] of [['tasks_sample.json', 'sample_tree.json'], ['tasks_wordnet.json', 'wordnet_tree.json']]) {
  const list = JSON.parse(readFileSync(new URL(`../public/study/${tasksFile}`, import.meta.url), 'utf8')).tasks;
  const tree = JSON.parse(readFileSync(new URL(`../public/data/${treeFile}`, import.meta.url), 'utf8'));
  const paths = [];
  (function walk(n, p, parent) { const path = [...p, n.name]; paths.push({ path: path.join('/'), name: n.name, parent, leaf: n.type === 'file' }); n.children.forEach((c) => walk(c, path, n.name)); })(tree, [], null);
  assert.ok(list.length >= 6 && list[0].practice === true && list.slice(1).every((t) => !t.practice), `${tasksFile}: a practice task, then scored ones`);
  for (const t of list) {
    assert.equal(paths.filter((p) => p.path === t.target).length, 1, `${t.id}: target exists once`);
    const me = paths.find((p) => p.path === t.target);
    assert.ok(me.leaf, `${t.id}: target is a leaf`);
    assert.equal(paths.filter((p) => p.name === me.name && p.parent === me.parent).length, 1, `${t.id}: (folder, name) pair is unique`);
    assert.ok(t.text.includes(`"${me.name}"`) && t.text.includes(`"${me.parent}"`), `${t.id}: text names the file and its folder`);
  }
  const depths = list.slice(1).map((t) => t.depth);
  assert.ok(depths[depths.length - 1] > depths[0], `${tasksFile}: tasks get deeper`);
}
console.log('study.test.js: all checks passed');
