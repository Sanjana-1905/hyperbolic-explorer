// studylog.js - the data side of study mode (Phase 6d): what a session is, how events are recorded, and how it is exported.
// No DOM here, so it is tested from the command line (tests/study.test.js). study.js builds the screens on top of it.
//
// A SESSION = one participant in one condition ("tree" collapsible list, "2d" hyperbolic disk, "3d" hyperbolic ball):
//   { participant, condition, dataset, started (ISO text), env: {width, height, dpr, touch, agent}, tasks: [record, ...] }
// A task RECORD = what happened during one task:
//   { id, practice, text, target (path of the file to find), result 'found' | 'skipped',
//     correct (true/false for found; null for skipped), finalPath (what was selected when "Found it" was pressed),
//     elapsedMs, startOffsetMs (since the session started),
//     actions     number of FOCUS changes made by the participant (every time the selected/focused node changed; changes the viewer made by itself,
//                 source 'auto', are logged but not counted) = "navigation actions",
//     backtracks  focus changes that went UP the tree (to a shallower node): a rough count of wrong turns,
//     maxDepth    deepest level reached, rawEvents  number of logged events of any kind,
//     events: [{ t (ms since task start), type, ...detail }] }
// Event types: focus {path, source, depth}, click {x, y}, drag, wheel, key {key}, ui {target}, search {query}.

// Depth of a path like "repo/src/utils/math.js" (root = 0) -> 3. A symbol path "repo/a.js › Vec" counts one more.
export function depthOfPath(path) {
  const [file, ...symbol] = path.split(' › ');
  return file.split('/').length - 1 + symbol.length;
}

export function newSession({ participant, condition, dataset, env }) {
  return { participant, condition, dataset, started: new Date().toISOString(), env, tasks: [] };
}

// A task in progress: events are collected here until finishTask turns it into a record.
export function startTask(task, nowMs, sessionStartMs) {
  return { task, startedMs: nowMs, startOffsetMs: nowMs - sessionStartMs, events: [] };
}

export function logEvent(current, nowMs, type, detail = {}) {
  current.events.push({ t: Math.round(nowMs - current.startedMs), type, ...detail });
}

// Is `finalPath` the target? A symbol of the target file counts (you found the file's content).
export function isCorrect(finalPath, target) {
  return finalPath === target || finalPath.startsWith(`${target} › `);
}

// Close a task: compute the numbers and return the record (the caller pushes it into session.tasks).
export function finishTask(current, nowMs, result, finalPath) {
  const events = current.events;
  // Focus changes the viewer makes by itself (source 'auto': e.g. the second step of a link glide) are logged but are not
  // counted as navigation actions of the participant.
  const focuses = events.filter((e) => e.type === 'focus' && e.source !== 'auto');
  let backtracks = 0, maxDepth = 0, prev = null;
  for (const f of focuses) {
    if (prev !== null && f.depth < prev) backtracks++;
    prev = f.depth;
  }
  for (const f of events) if (f.type === 'focus') maxDepth = Math.max(maxDepth, f.depth);   // deepest place shown, even if the viewer got there by itself
  return {
    id: current.task.id, practice: !!current.task.practice, text: current.task.text, target: current.task.target,
    result, correct: result === 'found' ? isCorrect(finalPath, current.task.target) : null, finalPath,
    elapsedMs: Math.round(nowMs - current.startedMs), startOffsetMs: Math.round(current.startOffsetMs),
    actions: focuses.length, backtracks, maxDepth, rawEvents: events.length, events,
  };
}

// ---- export ----
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

// One row per task: the table you analyse (times, correctness, action counts).
export function toCsvTasks(session) {
  const head = ['participant', 'condition', 'dataset', 'task', 'practice', 'result', 'correct', 'elapsed_ms', 'actions', 'backtracks',
    'max_depth', 'raw_events', 'start_offset_ms', 'final_path', 'target', 'text'];
  const rows = session.tasks.map((t) => csvRow([session.participant, session.condition, session.dataset, t.id, t.practice, t.result,
    t.correct, t.elapsedMs, t.actions, t.backtracks, t.maxDepth, t.rawEvents, t.startOffsetMs, t.finalPath, t.target, t.text]));
  return [csvRow(head), ...rows].join('\n') + '\n';
}

// One row per event: the raw log (for replaying what someone did).
export function toCsvEvents(session) {
  const head = ['participant', 'condition', 'task', 't_ms', 'type', 'source', 'path', 'depth', 'detail'];
  const rows = [];
  for (const t of session.tasks) {
    for (const e of t.events) {
      const { t: ms, type, source, path, depth, ...rest } = e;
      rows.push(csvRow([session.participant, session.condition, t.id, ms, type, source, path, depth,
        Object.keys(rest).length ? JSON.stringify(rest) : '']));
    }
  }
  return [csvRow(head), ...rows].join('\n') + '\n';
}

// Mean of a list, and a one-line summary used on the final screen.
export function summarizeSession(session) {
  const scored = session.tasks.filter((t) => !t.practice);
  const found = scored.filter((t) => t.result === 'found');
  const correct = found.filter((t) => t.correct);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    tasks: scored.length, found: found.length, correct: correct.length,
    meanSecondsCorrect: mean(correct.map((t) => t.elapsedMs / 1000)),
    meanActionsCorrect: mean(correct.map((t) => t.actions)),
  };
}
