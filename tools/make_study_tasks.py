#!/usr/bin/env python3
"""
make_study_tasks.py - write the task list for the user study ("find this file") from a tree JSON.

Every task names ONE file and the folder it sits in, e.g.  Find the file "loader.ts" inside the folder "cache72".
Only (folder name, file name) pairs that occur exactly ONCE in the whole tree are used, so the answer is unambiguous.
Tasks are spread over depths: one easy PRACTICE task (not counted), then `--count` scored tasks from shallow to deep.
The choice is seeded, so the same command gives the same tasks (all participants and all three conditions get the same list).

Usage:
    python3 tools/make_study_tasks.py public/data/sample_tree.json -o public/study/tasks_sample.json [--noun file] [--count 6] [--seed 7]
    python3 tools/make_study_tasks.py public/data/wordnet_tree.json -o public/study/tasks_wordnet.json --noun word --folder-noun category
The study page reads  study/tasks_<name>.json  where <name> is the tree file without "_tree.json" (or ?tasks=path).
"""

import argparse
import collections
import json
import os
import random


def walk(node, path, depth, out):
    path = path + [node["name"]]
    out.append((node, "/".join(path), depth, path[-2] if len(path) > 1 else None))
    for child in node["children"]:
        walk(child, path, depth + 1, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tree")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--noun", default="file", help='what to call a leaf in the task text ("file", "word")')
    ap.add_argument("--folder-noun", default="folder", help='what to call a parent in the task text ("folder", "category")')
    ap.add_argument("--count", type=int, default=6)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    tree = json.load(open(args.tree, encoding="utf-8"))
    items = []
    walk(tree, [], 0, items)
    pair_count = collections.Counter((parent, node["name"]) for node, _, _, parent in items)
    leaves = [(node, path, depth, parent) for node, path, depth, parent in items
              if node["type"] == "file" and parent and pair_count[(parent, node["name"])] == 1]
    rng = random.Random(args.seed)
    by_depth = collections.defaultdict(list)
    for item in leaves:
        by_depth[item[2]].append(item)
    depths = sorted(d for d in by_depth if d >= 3)
    chosen = []
    # practice: shallow; then spread the scored tasks over the available depths, shallow -> deep
    practice = rng.choice(by_depth[depths[0]])
    for k in range(args.count):
        d = depths[round(k * (len(depths) - 1) / max(1, args.count - 1))]
        pool = [x for x in by_depth[d] if x is not practice and x not in chosen]
        chosen.append(rng.choice(pool))

    def task(i, item, practice_flag):
        node, path, depth, parent = item
        return {"id": f"p{i}" if practice_flag else f"t{i}", "practice": practice_flag, "depth": depth, "target": path,
                "text": f'Find the {args.noun} "{node["name"]}" inside the {args.folder_noun} "{parent}".'}
    tasks = [task(0, practice, True)] + [task(i + 1, c, False) for i, c in enumerate(chosen)]
    out = {"dataset": os.path.basename(args.tree), "tasks": tasks}
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    json.dump(out, open(args.output, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(tasks)} tasks ({len(leaves)} unambiguous candidates) -> {args.output}")
    for t in tasks:
        print(f'  {t["id"]} depth {t["depth"]}: {t["text"]}')


if __name__ == "__main__":
    main()
