#!/usr/bin/env python3
"""
make_sample_tree.py - generate a fake repository tree (about 5,000 nodes)
in the same JSON format as scan_folder.py, for testing without a real repo.

The tree is random but *seeded*, so the same command always gives the same
tree (handy for repeatable screenshots and user-study tasks).

Usage:
    python3 tools/make_sample_tree.py [-n 5000] [--seed 42] [-o public/data/sample_tree.json]
"""

import argparse
import json
import os
import random

FOLDER_WORDS = [
    "src", "lib", "core", "utils", "components", "services", "models", "views",
    "api", "tests", "docs", "assets", "config", "scripts", "internal", "plugins",
    "auth", "db", "net", "ui", "render", "math", "io", "cache", "events", "i18n",
]
FILE_STEMS = [
    "index", "main", "helpers", "types", "constants", "store", "router", "client",
    "server", "parser", "loader", "handler", "schema", "format", "logger", "view",
]
EXTENSIONS = [".js", ".ts", ".py", ".json", ".md", ".css", ".html", ".glsl", ".png"]


def make_tree(target, rng):
    """
    Grow a tree breadth-first until it has about `target` nodes.

    We keep a queue of folders that may still receive children. Each folder
    gets a random number of sub-folders and files. Deeper folders get fewer
    sub-folders, so the tree stays bushy near the top like a real repo.
    """
    root = {"name": "sample-repo", "type": "folder", "size": 0, "children": []}
    queue = [(root, 0)]  # (folder node, depth)
    count = 1

    while queue and count < target:
        folder, depth = queue.pop(0)
        if depth < 2:
            n_sub = rng.randint(3, 6)
        elif depth < 5:
            n_sub = rng.randint(1, 4)
        elif depth < 7:
            n_sub = rng.randint(0, 2)
        else:
            n_sub = 0
        n_files = rng.randint(2, 10)

        used = set()  # avoid duplicate names inside one folder
        for _ in range(n_sub):
            if count >= target:
                break
            name = rng.choice(FOLDER_WORDS)
            while name in used:
                name = f"{rng.choice(FOLDER_WORDS)}{rng.randint(2, 99)}"
            used.add(name)
            child = {"name": name, "type": "folder", "size": 0, "children": []}
            folder["children"].append(child)
            queue.append((child, depth + 1))
            count += 1

        for _ in range(n_files):
            if count >= target:
                break
            name = rng.choice(FILE_STEMS) + rng.choice(EXTENSIONS)
            while name in used:
                name = f"{rng.choice(FILE_STEMS)}_{rng.randint(2, 999)}{rng.choice(EXTENSIONS)}"
            used.add(name)
            # Log-normal-ish sizes: mostly small files, a few large ones.
            size = int(rng.lognormvariate(8, 1.5))
            folder["children"].append({"name": name, "type": "file", "size": size, "children": []})
            count += 1

    # Note: with the branching above the queue never runs dry before ~5,000
    # nodes; if you ask for a much larger -n you may get fewer nodes.
    return root, count


def fill_folder_sizes(node):
    """Set every folder's size to the sum of its children (bottom-up)."""
    if node["type"] == "folder":
        node["size"] = sum(fill_folder_sizes(c) for c in node["children"])
        node["children"].sort(key=lambda n: (n["type"] != "folder", n["name"].lower()))
    return node["size"]


def main():
    parser = argparse.ArgumentParser(description="Generate a fake repo tree as JSON.")
    parser.add_argument("-n", "--nodes", type=int, default=5000, help="approximate node count")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument("-o", "--output", default="public/data/sample_tree.json")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    tree, count = make_tree(args.nodes, rng)
    fill_folder_sizes(tree)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(tree, f, separators=(",", ":"))
    print(f"Wrote {count} nodes to {args.output}")


if __name__ == "__main__":
    main()
