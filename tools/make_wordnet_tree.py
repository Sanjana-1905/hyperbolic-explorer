#!/usr/bin/env python3
"""
make_wordnet_tree.py - a SECOND dataset that is not a code repository: the top of the WordNet noun hierarchy.

WordNet (Princeton University, free, permissive licence - see public/data/wordnet_LICENSE.txt) organises English nouns as
"X is a kind of Y": dog -> canine -> carnivore -> placental -> mammal -> vertebrate -> chordate -> animal -> organism ->
living thing -> whole -> object -> physical entity -> entity. That is a tree-like hierarchy of 82,000 nouns, a classic
test case for hyperbolic browsers. We keep a few thousand of the most important nodes.

How the subset is made (deterministic, no randomness):
  1. WordNet is really a DAG (a noun can have several parents). We keep each noun's FIRST hypernym only, which makes a tree.
  2. For every noun count its descendants in the full tree (its "weight").
  3. Start with the root `entity`. Repeatedly take the not-yet-included node whose parent is included and which has the
     most descendants, and include it, until we have N nodes (default 3000). Nodes deeper than MAX_DEPTH are skipped
     (the ball layout runs out of room beyond depth ~9). Every included node's ancestors are included, so it is a tree.
     In effect: the biggest categories first, down to whatever the budget allows.
  4. A node that has children in the subset becomes a "folder", the others become "file" (the viewer's two node types).
     `size` = number of descendants in the FULL WordNet, so the viewer's sizing means "how big a category".
The root carries a few extra fields the viewer understands: "about" (one sentence for the intro card) and "words"
(what to call folders and files in the info card).

Needs nltk and its WordNet data (both free):
    pip install nltk
    python3 -c "import nltk; nltk.download('wordnet')"
Usage:
    python3 tools/make_wordnet_tree.py [-n 3000] [--max-depth 8] [-o public/data/wordnet_tree.json]
View it:  /?tree=wordnet_tree.json
"""

import argparse
import heapq
import json
import os
import sys

from nltk.corpus import wordnet as wn


def display_name(synset):
    """The most common word of the synset, spaces instead of underscores: dog.n.01 -> 'dog'."""
    return synset.lemmas()[0].name().replace("_", " ")


def build_full_tree():
    """Primary-hypernym tree over all nouns: returns (children dict, root synset)."""
    children = {}
    root = wn.synset("entity.n.01")
    for s in wn.all_synsets("n"):
        hypers = s.hypernyms() + s.instance_hypernyms()
        if not hypers:
            continue
        parent = sorted(hypers, key=lambda h: h.name())[0]       # first by name: deterministic
        children.setdefault(parent, []).append(s)
    for kids in children.values():
        kids.sort(key=lambda k: k.name())
    return children, root


def descendant_counts(children, root):
    """Number of descendants of every node (iterative post-order: the tree is deep)."""
    count = {}
    order, stack = [], [root]
    while stack:
        n = stack.pop()
        order.append(n)
        stack.extend(children.get(n, []))
    for n in reversed(order):
        count[n] = sum(1 + count[c] for c in children.get(n, []))
    return count


def select(children, count, root, budget, max_depth):
    """Best-first: always add the biggest not-yet-included child of an included node."""
    included = {root: 0}                       # node -> depth
    heap = []                                  # (-descendants, name, node, depth)
    def push_children(n, depth):
        if depth >= max_depth:
            return
        for c in children.get(n, []):
            heapq.heappush(heap, (-count[c], c.name(), c, depth + 1))
    push_children(root, 0)
    while heap and len(included) < budget:
        _, _, node, depth = heapq.heappop(heap)
        included[node] = depth
        push_children(node, depth)
    return included


def to_json(node, children, included, count):
    kids = [to_json(c, children, included, count) for c in children.get(node, []) if c in included]
    return {"name": display_name(node), "type": "folder" if kids else "file", "size": count.get(node, 0) + 1, "children": kids}


def main():
    parser = argparse.ArgumentParser(description="Make a WordNet noun-hierarchy subset as tree JSON.")
    parser.add_argument("-n", "--nodes", type=int, default=3000)
    parser.add_argument("--max-depth", type=int, default=8)
    parser.add_argument("-o", "--output", default="public/data/wordnet_tree.json")
    args = parser.parse_args()

    children, root = build_full_tree()
    count = descendant_counts(children, root)
    included = select(children, count, root, args.nodes, args.max_depth)
    tree = to_json(root, children, included, count)
    tree["about"] = ("a slice of the WordNet noun hierarchy: every word sits under the more general word it is a kind of "
                     "(dog under canine under carnivore ...)")
    tree["words"] = {"folder": "Category", "file": "Word"}
    tree["license"] = "WordNet 3.0, Princeton University (see wordnet_LICENSE.txt)"

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(tree, f, separators=(",", ":"), ensure_ascii=False)
    depth = max(included.values())
    print(f"Wrote {len(included)} of {len(count) + 1} nouns (depth {depth}) to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
