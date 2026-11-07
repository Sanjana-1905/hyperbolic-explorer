// heat.js - "git heat": how hot (many commits) or how fresh (changed recently) every node is. No drawing here.
//
// The scanner gives every file `commits` (how many commits touched it) and `modified` (date of the newest commit).
// We turn those into a number between 0 (cold) and 1 (hot) for every node, once, in two flavours:
//   commits :  heat = ln(1 + commits) / ln(1 + mostCommitsOfAnyFile)          (log scale: 2 vs 20 commits matters more than 200 vs 220)
//     Example: most = 99 -> ln(100) = 4.6. A file with 9 commits: ln(10)/4.6 = 0.5. With 1 commit: 0.15. With 99: 1.
//   recency :  heat = (time − oldest) / (newest − oldest)         (the newest change in the repo = 1, the oldest = 0)
//     Example: oldest 2023-01-01, newest 2026-01-01: a file last changed 2025-01-01 -> 2/3 of the way = 0.67.
// A FOLDER's heat is the AVERAGE heat of the files inside it that have git data (a calm folder with one busy file stays calm;
// with the maximum nearly every big folder would look hot). Example: files with heat 1.0, 0.2, 0.0 -> folder 0.4.
// Averages bunch together (every big folder lands near the middle), so the folders are then RANKED: the heat of a folder is its
// place in the line-up of all folders, lowest 0 .. highest 1, which spreads the colours evenly.
// Example: 5 folders with averages 0.41, 0.44, 0.43, 0.50, 0.47 -> ranks 0, 0.5, 0.25, 1, 0.75.
// Nodes without git data get -1 and stay neutral.
//
// The shader reads the heat from the existing per-instance `aFlag` hook: 0 = no marker, 1 = status ring (reserved),
// 2 + heat (so 2..3) = "heat marker with this heat". encodeHeat / the shader's decode are the two ends of that.

export const HEAT = { OFF: 0, COMMITS: 1, RECENCY: 2 };
export const HEAT_NAMES = ['off', 'commits', 'recency'];

export function encodeHeat(h) { return h < 0 ? 0 : 2 + h; }

// nodes: base tree nodes in pre-order (parents before children, as buildTree makes them).
// Returns { commits: Float32Array, recency: Float32Array, maxCommits, oldest, newest, files }.
export function computeHeat(nodes) {
  const n = nodes.length;
  const commits = new Float32Array(n).fill(-1);
  const recency = new Float32Array(n).fill(-1);
  let maxCommits = 0, oldest = Infinity, newest = -Infinity, files = 0;
  const time = new Float64Array(n).fill(NaN);
  for (const node of nodes) {
    if (node.type !== 'file' || !node.commits || !node.modified) continue;
    const t = Date.parse(node.modified);
    if (Number.isNaN(t)) continue;
    time[node.id] = t;
    files++;
    maxCommits = Math.max(maxCommits, node.commits);
    oldest = Math.min(oldest, t); newest = Math.max(newest, t);
  }
  const span = newest - oldest;
  for (const node of nodes) {
    if (Number.isNaN(time[node.id])) continue;
    commits[node.id] = Math.log(1 + node.commits) / Math.log(1 + maxCommits);
    recency[node.id] = span > 0 ? (time[node.id] - oldest) / span : 1;
  }
  // Folders: the average of the files below. Pre-order means every child comes after its parent, so walk backwards and
  // add each node's (sum, count) into its parent's.
  const sumC = new Float64Array(n), sumR = new Float64Array(n), cnt = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === 'file') {
      if (commits[i] >= 0) { sumC[i] = commits[i]; sumR[i] = recency[i]; cnt[i] = 1; }
    } else if (cnt[i] > 0) {
      commits[i] = sumC[i] / cnt[i];
      recency[i] = sumR[i] / cnt[i];
    }
    const p = node.parent;
    if (p) { sumC[p.id] += sumC[i]; sumR[p.id] += sumR[i]; cnt[p.id] += cnt[i]; }
  }
  for (const arr of [commits, recency]) {
    const folders = [];
    for (let i = 0; i < n; i++) if (nodes[i].type === 'folder' && arr[i] >= 0) folders.push(i);
    folders.sort((x, y) => arr[x] - arr[y] || x - y);
    folders.forEach((i, rank) => { arr[i] = folders.length > 1 ? rank / (folders.length - 1) : 0.5; });
  }
  return { commits, recency, maxCommits, oldest, newest, files };
}
