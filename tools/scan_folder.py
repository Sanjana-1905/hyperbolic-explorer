#!/usr/bin/env python3
"""
scan_folder.py - walk a folder and export its tree as JSON.

Every node in the output looks like:
    {
      "name": "src",
      "type": "folder",        # or "file"
      "size": 12345,           # bytes; for a folder = sum of everything inside
      "children": [ ...nodes ]  # always present; empty list for files
    }

Ignored: .git, node_modules, and any hidden file or folder (name starts with ".").
Symbolic links are skipped so we never loop forever or leave the folder.

Usage:
    python3 tools/scan_folder.py PATH [-o OUTPUT.json]
Example:
    python3 tools/scan_folder.py ~/code/some-repo -o public/data/tree.json
"""

import argparse
import json
import os
import sys

# Folder names we never descend into, even though they are not hidden.
IGNORED_NAMES = {"node_modules", ".git"}


def is_ignored(name):
    """True if this entry should be left out of the tree."""
    return name in IGNORED_NAMES or name.startswith(".")


def scan(path):
    """
    Build the node for `path` (recursively for folders).

    Folders: scan every child first, then size = sum of the children's sizes.
    Doing it bottom-up means each file's size is read exactly once.
    """
    name = os.path.basename(os.path.normpath(path)) or path

    if not os.path.isdir(path):
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0  # unreadable file: keep it in the tree but count it as 0
        return {"name": name, "type": "file", "size": size, "children": []}

    children = []
    try:
        entries = list(os.scandir(path))
    except OSError:
        entries = []  # e.g. permission denied: show the folder as empty

    for entry in entries:
        if is_ignored(entry.name) or entry.is_symlink():
            continue
        children.append(scan(entry.path))

    # Folders first, then alphabetical (case-insensitive) - easier to read.
    children.sort(key=lambda n: (n["type"] != "folder", n["name"].lower()))

    total = sum(child["size"] for child in children)
    return {"name": name, "type": "folder", "size": total, "children": children}


def count_nodes(node):
    """Number of nodes in the tree (used only for the summary message)."""
    return 1 + sum(count_nodes(c) for c in node["children"])


def main():
    parser = argparse.ArgumentParser(description="Export a folder tree as JSON.")
    parser.add_argument("path", help="folder to scan")
    parser.add_argument("-o", "--output", help="output file (default: print to stdout)")
    args = parser.parse_args()

    if not os.path.isdir(args.path):
        sys.exit(f"Not a folder: {args.path}")

    # Python's default recursion limit (1000) is plenty for real folder depths.
    tree = scan(args.path)

    text = json.dumps(tree, separators=(",", ":"))  # compact: smaller download
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Wrote {count_nodes(tree)} nodes to {args.output}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
