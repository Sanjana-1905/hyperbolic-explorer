#!/usr/bin/env python3
"""
make_sample_tree.py - generate a fake repository tree (about 5,000 nodes)
in the same JSON format as scan_folder.py, for testing without a real repo.

The tree is random but *seeded*, so the same command always gives the same
tree (handy for repeatable screenshots and user-study tasks).

Scanner-v2 extras (same formats as scan_folder.py): every file gets ext + loc, fake git info, and every
.js/.ts/.py file gets a fake symbols file (classes, methods, functions, nested functions, imports that point at
real files of this tree, and calls whose names match symbols of the imported files). The extras use their OWN
random generator (seed + 1), so the folder/file structure is identical to the one made before v2 existed.

Usage:
    python3 tools/make_sample_tree.py [-n 5000] [--seed 42] [-o public/data/sample_tree.json]
Symbols go to <folder of -o>/<name of -o without "_tree">/symbols, e.g. public/data/sample/symbols, and a fake
source file for every code file (so the viewer's code panel has something to show) to .../sample/source/<id>.txt.
"""

import argparse
import json
import os
import random
import datetime

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


# ----------------------------------------------------------------------------- fake code (scanner v2)

CODE_EXTS = {".js": "js", ".ts": "ts", ".py": "py"}
VERBS = ["get", "set", "parse", "load", "render", "update", "create", "build", "handle", "validate", "format",
         "find", "init", "reset", "apply", "compute", "merge", "read", "write", "emit", "resolve", "collect"]
NOUNS = ["node", "tree", "item", "config", "event", "cache", "state", "path", "view", "token", "schema", "query",
         "buffer", "user", "layer", "route", "client", "mesh", "record", "stream", "index", "option"]
EXTERNAL_JS = ["map", "push", "console.log", "JSON.parse", "fetch", "Math.max", "Object.keys", "setTimeout"]
EXTERNAL_PY = ["len", "print", "os.path.join", "isinstance", "sorted", "open", "range", "json.loads"]
PARAMS = ["a", "b", "node", "options", "value", "ctx", "items", "key"]


def camel(words):
    return words[0] + "".join(w.capitalize() for w in words[1:])


def fake_name(rng, lang, kind, used):
    """Unique readable name: getNode / get_node for functions, GetNode-style for classes."""
    for _ in range(50):
        words = [rng.choice(VERBS), rng.choice(NOUNS)]
        if kind == "class":
            name = "".join(w.capitalize() for w in rng.sample(NOUNS, 2))
        else:
            name = "_".join(words) if lang == "py" else camel(words)
        if name not in used:
            used.add(name)
            return name
    name = f"{name}{len(used)}"
    used.add(name)
    return name


def fake_signature(rng, lang, kind, name, is_method):
    params = ", ".join(rng.sample(PARAMS, rng.randint(0, 3)))
    if lang == "py":
        if kind == "class":
            return f"class {name}"
        self_arg = "self, " if is_method and params else ("self" if is_method else "")
        return f"def {name}({self_arg}{params})"
    if kind == "class":
        return f"class {name}"
    tail = ": void" if lang == "ts" else ""
    return f"{name}({params}){tail}" if is_method else f"function {name}({params}){tail}"


def fake_symbols(rng, lang, loc, first_line):
    """
    Lay symbols out down the file like real code: each takes a block of lines, in order, one after another.
    Returns (symbols, last line used). Classes hold 3-8 methods; 30 % of functions hold one nested function.
    """
    used = set()
    symbols = []
    line = first_line
    n_top = max(1, min(8, loc // 40))
    for _ in range(n_top):
        if rng.random() < 0.4:  # a class with methods
            name = fake_name(rng, lang, "class", used)
            start = line
            line += 2
            methods = []
            for _ in range(rng.randint(3, 8)):
                m_name = "constructor" if (not methods and lang != "py") else fake_name(rng, lang, "method", used)
                if lang == "py" and not methods:
                    m_name = "__init__"
                length = rng.randint(4, 25)
                methods.append({"kind": "method", "name": m_name, "startLine": line, "endLine": line + length - 1,
                                "signature": fake_signature(rng, lang, "method", m_name, True)})
                line += length + 1
            symbols.append({"kind": "class", "name": name, "startLine": start, "endLine": line - 1,
                            "signature": fake_signature(rng, lang, "class", name, False), "children": methods})
        else:  # a function, sometimes with a nested helper
            name = fake_name(rng, lang, "function", used)
            length = rng.randint(5, 40)
            sym = {"kind": "function", "name": name, "startLine": line, "endLine": line + length - 1,
                   "signature": fake_signature(rng, lang, "function", name, False)}
            if length >= 12 and rng.random() < 0.3:
                inner = fake_name(rng, lang, "function", used)
                sym["children"] = [{"kind": "function", "name": inner, "startLine": line + 2, "endLine": line + 8,
                                    "signature": fake_signature(rng, lang, "function", inner, False)}]
            symbols.append(sym)
            line += length + 1
    return symbols, line


def fake_source(rng, doc):
    """
    Plausible-looking source text whose line numbers match the symbol ranges exactly: imports at the top,
    then for every symbol a header line (its signature), statements that call the names in its `calls`,
    and a closing brace (JS/TS). Children are written after their parent, so they overwrite its lines.
    """
    lang, loc = doc["lang"], doc["loc"]
    py = lang == "py"
    lines = [""] * loc
    for imp in doc["imports"]:
        names = ", ".join(imp["names"])
        lines[imp["line"] - 1] = (f"from {imp['from']} import {names}" if py
                                  else f"import {{ {names} }} from '{imp['from']}';")
    var_names = ["result", "node", "items", "value", "ctx", "out", "state", "next"]

    def statement(call):
        v, w = rng.choice(var_names), rng.choice(var_names)
        if call is None:
            return rng.choice([f"{v} = {w}" if py else f"const {v} = {w};", "# TODO: handle edge cases" if py
                               else "// TODO: handle edge cases", f"return {v}" if py else f"return {v};", ""])
        args = ", ".join(rng.sample(var_names, rng.randint(0, 2)))
        return rng.choice([
            f"{v} = {call}({args})" if py else f"const {v} = {call}({args});",
            f"if {v}: {call}({args})" if py else f"if ({v}) {{ {call}({args}); }}",
            f"{call}({args})" if py else f"{call}({args});",
        ])

    def write(sym, depth):
        pad = "    " * depth if py else "  " * depth
        body_pad = pad + ("    " if py else "  ")
        calls = sym.get("calls") or [None]
        for n in range(sym["startLine"] + 1, sym["endLine"] + 1):
            lines[n - 1] = body_pad + statement(calls[(n - sym["startLine"]) % len(calls)] if rng.random() < 0.6 else None)
        lines[sym["startLine"] - 1] = pad + sym["signature"] + (":" if py else " {")
        if not py and sym["endLine"] > sym["startLine"]:
            lines[sym["endLine"] - 1] = pad + "}"
        for child in sym.get("children", []):
            write(child, depth + 1)

    for sym in doc["symbols"]:
        write(sym, 0)
    return lines


def relative_import(lang, src_rel, dst_rel, rng):
    """The import text a file at src_rel would write to reach dst_rel (both '/'-paths from the root)."""
    src_dir = src_rel.split("/")[:-1]
    dst_dir, dst_file = dst_rel.split("/")[:-1], dst_rel.split("/")[-1]
    stem, ext = os.path.splitext(dst_file)
    common = 0
    while common < min(len(src_dir), len(dst_dir)) and src_dir[common] == dst_dir[common]:
        common += 1
    ups = len(src_dir) - common
    downs = dst_dir[common:]
    if lang == "py":
        # from .mod import x  /  from ..pkg.mod import x   (one dot = same folder, each extra dot = one level up)
        return "." * (ups + 1) + ".".join(downs + [stem])
    parts = ([".."] * ups if ups else ["."]) + downs
    if stem == "index" and rng.random() < 0.5:
        return "/".join(parts)  # import the folder, resolved to its index file
    return "/".join(parts + [stem + (ext if rng.random() < 0.5 else "")])


def flat_symbols(symbols):
    """All symbols in a list, depth first."""
    for s in symbols:
        yield s
        yield from flat_symbols(s.get("children", []))


def add_fake_code(root, seed, symbols_dir, tree_dir):
    """
    Decorate the tree with ext/loc/git and write fake symbol files. Mutates `root`.
    Returns (number of symbol files, number of symbols).
    """
    rng = random.Random(seed + 1)

    # 1) every file: ext, loc (about 30 bytes per line), fake git info
    files = []  # (node, "path/from/root")

    def collect(node, rel):
        for c in node["children"]:
            c_rel = c["name"] if not rel else rel + "/" + c["name"]
            if c["type"] == "file":
                files.append((c, c_rel))
            else:
                collect(c, c_rel)

    collect(root, "")
    start = datetime.date(2023, 1, 1).toordinal()
    end = datetime.date(2026, 10, 31).toordinal()
    for node, rel in files:
        ext = os.path.splitext(node["name"])[1]
        node["ext"] = ext.lstrip(".").lower()
        if ext != ".png":
            node["loc"] = max(3, node["size"] // 30)
        node["commits"] = 1 + int(rng.lognormvariate(1.5, 1.0))
        node["modified"] = datetime.date.fromordinal(rng.randint(start, end)).isoformat()

    # 2) symbols for code files
    docs = {}  # rel path -> symbol file content
    for node, rel in files:
        lang = CODE_EXTS.get(os.path.splitext(node["name"])[1])
        if not lang:
            continue
        # Fake files are exactly as long as their symbols (keeps the committed fake source small).
        symbols, last = fake_symbols(rng, lang, min(node["loc"], 1500), first_line=6)
        node["loc"] = last + 1
        docs[rel] = {"file": rel, "lang": lang, "loc": node["loc"], "symbols": symbols, "imports": [], "calls": []}

    # 3) imports between real files of the tree, then calls that name symbols of the imported files
    by_dir = {}
    for rel in docs:
        by_dir.setdefault(os.path.dirname(rel), []).append(rel)
    all_rel = sorted(docs)

    def family(lang):
        return "py" if lang == "py" else "js"  # .js and .ts files import each other

    for rel in all_rel:
        doc = docs[rel]
        lang = doc["lang"]
        folder = os.path.dirname(rel)
        near = [r for r in by_dir.get(folder, []) + by_dir.get(os.path.dirname(folder), []) if r != rel]
        targets = []
        for _ in range(rng.randint(0, 5)):
            pool = near if (near and rng.random() < 0.7) else all_rel
            cand = rng.choice(pool)
            if cand != rel and family(docs[cand]["lang"]) == family(lang) and cand not in targets:
                targets.append(cand)
        imported_names = []
        for i, dst in enumerate(targets):
            exported = [s["name"] for s in docs[dst]["symbols"]]
            names = rng.sample(exported, rng.randint(1, min(3, len(exported))))
            doc["imports"].append({"from": relative_import(lang, rel, dst, rng), "names": names, "line": i + 1})
            imported_names += names
        local = [s["name"] for s in flat_symbols(doc["symbols"])]
        external = EXTERNAL_PY if lang == "py" else EXTERNAL_JS
        for sym in flat_symbols(doc["symbols"]):
            if sym["kind"] == "class":
                continue
            calls = []
            for _ in range(rng.randint(0, 4)):
                roll = rng.random()
                if roll < 0.3:
                    name = rng.choice(local)
                elif roll < 0.75 and imported_names:
                    name = rng.choice(imported_names)
                else:
                    name = rng.choice(external)
                if name != sym["name"] and name not in calls:
                    calls.append(name)
            if calls:
                sym["calls"] = calls
        if rng.random() < 0.3:
            doc["calls"] = [rng.choice(local)]

    # 4) write files, ids in final tree order
    os.makedirs(symbols_dir, exist_ok=True)
    for old in os.listdir(symbols_dir):
        if old.endswith(".json"):
            os.remove(os.path.join(symbols_dir, old))
    next_id = n_symbols = 0
    for node, rel in files:
        doc = docs.get(rel)
        if doc is None:
            continue
        node["hasSymbols"] = True
        node["id"] = next_id
        with open(os.path.join(symbols_dir, f"{next_id}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"))
        n_symbols += sum(1 for _ in flat_symbols(doc["symbols"]))
        next_id += 1
    root["symbolsDir"] = os.path.relpath(symbols_dir, tree_dir).replace(os.sep, "/")

    # 5) fake source text, one file per symbol file, from a third generator so nothing above changes
    source_dir = os.path.join(os.path.dirname(os.path.normpath(symbols_dir)), "source")
    os.makedirs(source_dir, exist_ok=True)
    for old in os.listdir(source_dir):
        if old.endswith(".txt"):
            os.remove(os.path.join(source_dir, old))
    src_rng = random.Random(seed + 2)
    for node, rel in files:
        doc = docs.get(rel)
        if doc is not None:
            with open(os.path.join(source_dir, f"{node['id']}.txt"), "w", encoding="utf-8") as f:
                f.write("\n".join(fake_source(src_rng, doc)))
    root["sourceDir"] = os.path.relpath(source_dir, tree_dir).replace(os.sep, "/")
    return next_id, n_symbols


def main():
    parser = argparse.ArgumentParser(description="Generate a fake repo tree as JSON.")
    parser.add_argument("-n", "--nodes", type=int, default=5000, help="approximate node count")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument("-o", "--output", default="public/data/sample_tree.json")
    parser.add_argument("--symbols-dir", help="default: <folder of -o>/<name of -o without _tree>/symbols")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    tree, count = make_tree(args.nodes, rng)
    fill_folder_sizes(tree)

    tree_dir = os.path.dirname(os.path.abspath(args.output))
    stem = os.path.splitext(os.path.basename(args.output))[0]
    if stem.endswith("_tree"):
        stem = stem[:-5]
    symbols_dir = args.symbols_dir or os.path.join(tree_dir, stem, "symbols")
    n_files, n_symbols = add_fake_code(tree, args.seed, symbols_dir, tree_dir)

    os.makedirs(tree_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(tree, f, separators=(",", ":"))
    print(f"Wrote {count} nodes to {args.output}, {n_symbols} fake symbols in {n_files} files to {symbols_dir}")


if __name__ == "__main__":
    main()
