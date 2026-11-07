// study.js - study mode (Phase 6d). Loaded by main.js when the URL has ?study=1; works on top of ANY of the three viewers
// (?mode=tree collapsible list, ?mode=2d hyperbolic disk, default 3D hyperbolic ball), so all conditions are logged the same way.
//
// What the participant sees: a welcome card (participant id), then for every task a bar at the top with the task text and a timer:
//     [Start]  ->  [Found it] [Skip]   ->  next task ... ->  a final card with the export buttons.
// At task start the view is reset (root focused, tree collapsed), so every task starts from the same place.
//
// What is logged (details in studylog.js): every change of the focused/selected node ("focus", with where the interaction came from:
// click, search, map, toolbar button, panel, breadcrumb, key), plus clicks, drags, wheel turns, keys and toolbar taps. It is observed
// from OUTSIDE: the viewers only expose window.__explorer (nodes, focusNode / focusId()), and this file watches it every frame. So
// the 2D viewer needed no change at all. "Found it" stores the path of the node that is selected at that moment and whether it is
// the target. Nothing tells the participant whether they were right (except on the practice task).
//
// Extras in the URL: &p=P07 (prefill the participant id), &tasks=study/other.json (task file; default study/tasks_<dataset>.json,
// made by tools/make_study_tasks.py), &search=0 (no search in the 3D viewer, no filter in the list).
// Developer text (fps counter, key help line) is hidden while the study runs. The session is saved in localStorage after every
// task, so a reload does not lose data (a Resume button appears).

import { nodePath } from './layout.js';
import { THEME, cssRgb } from './theme.js';
import {
  newSession, startTask, logEvent, finishTask, toCsvTasks, toCsvEvents, summarizeSession, depthOfPath,
} from './studylog.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const condition = mode === 'tree' ? 'tree' : mode === '2d' ? '2d' : '3d';
const CONDITION_NAMES = { tree: 'Collapsible tree', '2d': '2D hyperbolic disk', '3d': '3D hyperbolic ball' };
const treeFile = params.get('tree') || 'sample_tree.json';
const SAVE_KEY = 'hyperbolic-explorer-study';

document.body.classList.add('study');

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------
const css = document.createElement('style');
css.textContent = `
  body.study #fps, body.study #help { display: none !important; }      /* no developer text during a study */
  #study { position: fixed; z-index: 10; top: 0; left: 0; right: 0; box-sizing: border-box; display: none; padding: 6px 12px 8px;
    padding-top: calc(6px + env(safe-area-inset-top, 0px)); background: ${cssRgb(THEME.CODE_BG)}; color: ${cssRgb(THEME.CODE_TEXT)};
    border-bottom: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; font: 14px/1.3 system-ui, sans-serif; }
  #study.open { display: block; }
  #study .s-text { font-weight: 600; margin-bottom: 4px; }
  #study .s-tag { color: ${cssRgb(THEME.CODE_HEADER)}; margin-right: 8px; font-weight: 700; }
  #study .s-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  #study .s-timer { font: 600 18px ui-monospace, Menlo, monospace; min-width: 62px; }
  #study .s-note { font-size: 12px; opacity: 0.75; }
  .s-btn { height: ${THEME.TOOLBAR_BTN_PX}px; min-width: ${THEME.TOOLBAR_BTN_PX}px; padding: 0 16px; border-radius: ${THEME.TOOLBAR_BTN_PX / 2}px;
    cursor: pointer; font: 600 15px system-ui, sans-serif; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)};
    background: ${cssRgb(THEME.CRUMB_BG, 1)}; border: 1px solid ${cssRgb(THEME.CRUMB_COLOR)}; }
  .s-btn.primary { background: ${cssRgb(THEME.UI_ACTIVE_BG, 1)}; }
  #studycard { position: fixed; z-index: 11; left: 50%; top: 50%; transform: translate(-50%, -50%); box-sizing: border-box; display: none;
    width: min(440px, 92vw); max-height: 90vh; overflow: auto; padding: 18px; border-radius: 14px; background: ${cssRgb(THEME.CODE_BG)};
    color: ${cssRgb(THEME.CODE_TEXT)}; border: 2px solid ${cssRgb(THEME.CODE_EDGE, 0.7)}; box-shadow: 0 10px 40px rgba(0,0,0,0.7);
    font: 14px/1.45 system-ui, sans-serif; }
  #studycard.open { display: block; }
  #studycard h2 { margin: 0 0 8px; font-size: 18px; color: ${cssRgb(THEME.CRUMB_LAST_COLOR)}; }
  #studycard input { width: 100%; box-sizing: border-box; height: 44px; margin: 8px 0 12px; padding: 0 12px; border-radius: 8px; font: 16px system-ui, sans-serif;
    color: inherit; background: ${cssRgb(THEME.CRUMB_BG, 1)}; border: 1px solid ${cssRgb(THEME.CRUMB_SEP_COLOR)}; }
  #studycard .s-btn { display: block; width: 100%; margin-top: 8px; }
  #studycard .s-sum { margin: 8px 0; padding: 8px 10px; border-radius: 8px; background: ${cssRgb(THEME.CRUMB_BG, 1)}; }
  #studycard textarea { width: 100%; height: 120px; margin-top: 8px; box-sizing: border-box; font: 11px ui-monospace, monospace; }
  @media (max-height: ${THEME.COMPACT_HEIGHT_PX}px) {
    #study { padding: 3px 10px 4px; font-size: 13px; } #study .s-text { margin-bottom: 2px; }
    #study.open { display: flex; align-items: center; gap: 12px; }    /* sideways phone: task text left, timer and buttons right, one slim row */
    #study .s-text { flex: 1; margin: 0; min-width: 0; } #study .s-row { flex: none; flex-wrap: nowrap; } #study .s-note { display: none; }
    .s-btn { height: 40px; min-width: 40px; padding: 0 12px; } #studycard { padding: 12px; }
  }
`;
document.head.appendChild(css);

const bar = document.createElement('div');
bar.id = 'study';
document.body.appendChild(bar);
const card = document.createElement('div');
card.id = 'studycard';
document.body.appendChild(card);

// Tell the rest of the page how tall the bar is (index.html, the info card, the search box ... leave room for it).
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--study-h', bar.classList.contains('open') ? `${bar.offsetHeight}px` : '0px');
}).observe(bar);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let tasks = [];
let taskFile = null;
let session = null;
let sessionStartMs = 0;
let index = 0;                 // which task is next / current
let current = null;            // the running task (studylog.startTask) or null
let timerHandle = 0;
let lastPath = null;           // focus path at the previous frame
let lastInput = { source: 'auto', at: 0 };   // what the participant touched last

const explorer = () => window.__explorer;
function focusPath() {
  const e = explorer();
  if (!e || !e.nodes || !e.nodes.length) return null;
  const n = e.focusNode || e.nodes[e.focusId()];
  if (!n) return null;
  return n.type === 'symbol' ? `${nodePath(n.file)} › ${n.name}` : nodePath(n);
}
const fmtClock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Observing the viewer from outside
// ---------------------------------------------------------------------------
function classify(target) {
  if (!(target instanceof Element)) return 'other';
  if (target.closest('#study, #studycard')) return null;                 // our own buttons are not navigation
  if (target.closest('#search')) return 'search';
  if (target.closest('#map')) return 'map';
  if (target.closest('#tools')) { const b = target.closest('button'); return `toolbar:${b ? (b.title || b.textContent).slice(0, 24) : ''}`; }
  if (target.closest('#code')) return 'panel';
  if (target.closest('#crumbs')) return 'breadcrumb';
  if (target.closest('#tree')) return 'tree';
  if (target.closest('canvas')) return 'canvas';
  return 'other';
}

let downAt = null, lastWheel = 0;
window.addEventListener('pointerdown', (e) => {
  const source = classify(e.target);
  if (source === null) return;
  lastInput = { source, at: performance.now() };
  downAt = { x: e.clientX, y: e.clientY, source };
}, true);
window.addEventListener('pointerup', (e) => {
  const source = classify(e.target);
  if (source === null || !current) { downAt = null; return; }
  lastInput = { source, at: performance.now() };
  const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 0;
  if (source === 'canvas') {
    if (moved > 5) logEvent(current, performance.now(), 'drag');
    else logEvent(current, performance.now(), 'click', { x: +(e.clientX / innerWidth).toFixed(3), y: +(e.clientY / innerHeight).toFixed(3) });
  } else if (source.startsWith('toolbar') || source === 'map' || source === 'search' || source === 'panel' || source === 'breadcrumb') {
    logEvent(current, performance.now(), 'ui', { target: source });
  }
  downAt = null;
}, true);
window.addEventListener('wheel', (e) => {
  const now = performance.now();
  if (!current || classify(e.target) !== 'canvas' || now - lastWheel < 400) return;   // one event per 400 ms of scrolling
  lastWheel = now;
  logEvent(current, now, 'wheel', { dy: Math.sign(e.deltaY) });
}, { capture: true, passive: true });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('#study, #studycard')) return;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  lastInput = { source: `key:${e.key}`, at: performance.now() };
  if (current) logEvent(current, performance.now(), 'key', { key: e.key });
}, true);

// Every frame: did the focused / selected node change? Then log it with the interaction that most likely caused it.
function watch() {
  const path = focusPath();
  if (path !== null && path !== lastPath) {
    if (current && lastPath !== null) {
      const now = performance.now();
      const recent = now - lastInput.at < 1500;
      const detail = { path, depth: depthOfPath(path), source: recent ? lastInput.source : 'auto' };
      const q = document.querySelector('#search input');
      if (detail.source === 'search' && q && q.value) detail.query = q.value;
      logEvent(current, now, 'focus', detail);
    }
    lastPath = path;
  }
  requestAnimationFrame(watch);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function showCard(html) { card.innerHTML = html; card.classList.add('open'); }
function hideCard() { card.classList.remove('open'); }
function showBar(html) { bar.innerHTML = html; bar.classList.add('open'); }

function taskLabel(i) {
  const t = tasks[i];
  return t.practice ? 'Practice' : `Task ${tasks.slice(0, i + 1).filter((x) => !x.practice).length}/${tasks.filter((x) => !x.practice).length}`;
}

function resetView() {
  const e = explorer();
  const search = document.querySelector('#search');
  if (search && search.classList.contains('open')) document.querySelector('#search .s-x').click();
  if (e.reset) e.reset(); else e.focusOn(e.nodes[0], false);
}

function showReady() {
  current = null;
  clearInterval(timerHandle);
  const t = tasks[index];
  showBar(`<div class="s-text"><span class="s-tag">${taskLabel(index)}</span>${esc(t.text)}</div>` +
    `<div class="s-row"><button class="s-btn primary" data-act="start">Start</button><span class="s-note">Read the task, then press Start. The clock runs from then.</span></div>`);
}

function startCurrent() {
  resetView();
  lastPath = focusPath();
  current = startTask(tasks[index], performance.now(), sessionStartMs);
  const t = tasks[index];
  showBar(`<div class="s-text"><span class="s-tag">${taskLabel(index)}</span>${esc(t.text)}</div>` +
    `<div class="s-row"><span class="s-timer">00:00</span><button class="s-btn primary" data-act="found">Found it</button><button class="s-btn" data-act="skip">Skip</button></div>`);
  const timer = bar.querySelector('.s-timer');
  timerHandle = setInterval(() => { timer.textContent = fmtClock(performance.now() - current.startedMs); }, 250);
}

function endCurrent(result) {
  clearInterval(timerHandle);
  const record = finishTask(current, performance.now(), result, focusPath() || '');
  session.tasks.push(record);
  const wasPractice = record.practice;
  current = null;
  save();
  index++;
  const feedback = wasPractice && result === 'found'
    ? `<div class="s-sum">${record.correct ? 'Correct, that was the file.' : `Not quite. The file was <b>${esc(record.target)}</b>.`} (Only the practice task shows this.)</div>` : '';
  if (index >= tasks.length) showDone(feedback);
  else {
    hideCard();
    showReady();
    if (feedback) showCard(`<h2>Practice finished</h2>${feedback}<button class="s-btn primary" data-act="ok">Next task</button>`);
  }
}

function showWelcome() {
  bar.classList.remove('open');
  const saved = loadSaved();
  showCard(`<h2>User study</h2><div>Condition: <b>${CONDITION_NAMES[condition]}</b><br>You will get ${tasks.filter((t) => !t.practice).length} tasks ` +
    `(plus one practice). In each, find one ${/word/.test(tasks[0].text) ? 'word' : 'file'} as quickly as you can, then press <b>Found it</b>.</div>` +
    `<input id="pid" placeholder="Participant id" value="${esc(params.get('p') || '')}" autocomplete="off">` +
    `<button class="s-btn primary" data-act="begin">Begin</button>` +
    (saved ? `<button class="s-btn" data-act="resume">Resume ${esc(saved.session.participant)} (${saved.session.tasks.length} tasks done)</button>` : ''));
}

function showDone(feedback = '') {
  bar.classList.remove('open');
  const sum = summarizeSession(session);
  showCard(`<h2>Finished, thank you!</h2>${feedback}<div class="s-sum">${sum.correct} of ${sum.tasks} tasks correct` +
    `${sum.correct ? ` · mean ${sum.meanSecondsCorrect.toFixed(1)} s, ${sum.meanActionsCorrect.toFixed(1)} actions` : ''}</div>` +
    `<button class="s-btn primary" data-act="json">Export JSON</button><button class="s-btn" data-act="csvtasks">Export tasks CSV</button>` +
    `<button class="s-btn" data-act="csvevents">Export events CSV</button><button class="s-btn" data-act="copy">Copy JSON</button>` +
    `<button class="s-btn" data-act="new">New participant</button><div id="s-out"></div>`);
}

// ---------------------------------------------------------------------------
// Saving and exporting
// ---------------------------------------------------------------------------
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ session, index, taskFile })); } catch { /* private mode: no autosave */ } }
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.session && s.session.condition === condition && s.taskFile === taskFile && s.index < tasks.length ? s : null;
  } catch { return null; }
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportAs(kind) {
  const base = `study_${session.participant}_${session.condition}`;
  if (kind === 'json') download(`${base}.json`, JSON.stringify(session, null, 1), 'application/json');
  else if (kind === 'csvtasks') download(`${base}_tasks.csv`, toCsvTasks(session), 'text/csv');
  else if (kind === 'csvevents') download(`${base}_events.csv`, toCsvEvents(session), 'text/csv');
  else if (kind === 'copy') {
    const text = JSON.stringify(session);
    const out = document.getElementById('s-out');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      () => { out.textContent = 'Copied.'; },
      () => { out.innerHTML = '<textarea readonly></textarea>'; out.firstChild.value = text; out.firstChild.select(); },   // no clipboard permission: show it
    );
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
function beginSession(participant) {
  session = newSession({
    participant: participant || 'anonymous', condition, dataset: treeFile,
    env: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touch: matchMedia('(pointer: coarse)').matches, agent: navigator.userAgent },
  });
  sessionStartMs = performance.now();
  index = 0;
  hideCard();
  showReady();
}

document.addEventListener('click', (e) => {
  const act = e.target instanceof Element && e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null;
  if (!act) return;
  if (act === 'begin') beginSession(document.getElementById('pid').value.trim());
  else if (act === 'resume') {
    const s = loadSaved();
    session = s.session; index = s.index;
    sessionStartMs = performance.now() - ((session.tasks.at(-1) || { startOffsetMs: 0, elapsedMs: 0 }).startOffsetMs + (session.tasks.at(-1) || { elapsedMs: 0 }).elapsedMs);
    hideCard(); showReady();
  } else if (act === 'start') startCurrent();
  else if (act === 'found') endCurrent('found');
  else if (act === 'skip') endCurrent('skipped');
  else if (act === 'ok') hideCard();
  else if (act === 'new') { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } showWelcome(); }
  else exportAs(act);
});

// ---------------------------------------------------------------------------
// Startup: wait for the viewer, load the task list
// ---------------------------------------------------------------------------
async function start() {
  while (!(explorer() && explorer().nodes && explorer().nodes.length)) await new Promise((r) => setTimeout(r, 100));
  const name = treeFile.replace(/_tree\.json$|\.json$/, '').split('/').pop();
  taskFile = params.get('tasks') || `study/tasks_${name}.json`;
  const response = await fetch(`${import.meta.env.BASE_URL}${taskFile}`);
  if (!response.ok) { showCard(`<h2>Study mode</h2>No task file at <b>${esc(taskFile)}</b>. Make one with tools/make_study_tasks.py.`); return; }
  tasks = (await response.json()).tasks;
  lastPath = focusPath();
  requestAnimationFrame(watch);
  showWelcome();
}
start();

// Handy for tests.
window.__study = {
  get state() { return current ? 'running' : bar.classList.contains('open') ? 'ready' : card.classList.contains('open') ? 'card' : 'idle'; },
  get session() { return session; },
  get taskCount() { return tasks.length; },
};
