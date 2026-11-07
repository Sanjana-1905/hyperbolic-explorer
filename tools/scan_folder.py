#!/usr/bin/env python3
"""
scan_folder.py (scanner v2) - walk a folder and export its tree, plus per-file code symbols, as JSON.

TREE JSON (backward compatible: the old fields are unchanged, new ones are only added)
    {
      "name": "src",
      "type": "folder",          # or "file"
      "size": 12345,             # bytes; for a folder = sum of everything inside
      "children": [ ...nodes ],  # always present; empty list for files
      # --- new in v2, files only (a field is left out when it does not apply) ---
      "ext": "js",               # lower-case extension without the dot ("" if none)
      "loc": 120,                # number of lines (text files only)
      "hasSymbols": true,        # a symbols file exists for this file (see below)
      "id": 17,                  # file id = name of its symbols file (only when hasSymbols)
      "commits": 42,             # git: number of commits that touched the file   (optional)
      "modified": "2025-03-01"   # git: date of the newest such commit            (optional)
    }
    The root also gets "symbolsDir": the folder holding the symbol files, relative to the folder of the tree file,
    and "sourceDir": the folder holding a verbatim copy of every parsed file as <id>.txt (the viewer's code panel
    reads the lines of the focused symbol from it; --no-source leaves it out), and "linksFile": links.json (Phase 4c),
    the imports and calls resolved to files and symbols, with a confidence each (format: see tools/links.py).

SYMBOLS FILE  <symbols dir>/<id>.json   (loaded lazily by the viewer, only when a file is opened)
    {
      "file": "src/utils/math.js", "lang": "js", "loc": 120,
      "symbols": [   # nested: class > method, function > nested function
        {"kind": "class", "name": "Vec", "startLine": 3, "endLine": 40, "signature": "class Vec extends Base",
         "calls": ["Math.sqrt"],            # names called directly in this symbol's body (left out when empty)
         "children": [ {"kind": "method", ...} ]},  # left out when empty
        ...
      ],
      "imports": [ {"from": "./other.js", "names": ["a", "b as c"], "line": 1} ],   # raw, NOT resolved to files yet
      "calls": ["main"]                     # names called at module level (outside every symbol)
    }
    kind is "class" | "function" | "method". A call name is "foo", or "obj.foo" when obj is a plain identifier.
    Import "from" is the text as written ("./x", "three", ".utils" for Python's "from .utils import ...").

Languages: Python (.py, standard-library `ast`) and JavaScript/TypeScript (.js .jsx .mjs .cjs .ts .tsx .mts .cts,
via tools/parse_js.mjs which uses the free @babel/parser; needs `npm install` once and Node on the PATH).

Ignored: .git, node_modules, and any hidden file or folder (name starts with ".").
Symbolic links are skipped so we never loop forever or leave the folder.

Usage:
    python3 tools/scan_folder.py PATH --out-dir public/data/myrepo     # tree.json + symbols/ (recommended)
    python3 tools/scan_folder.py PATH -o tree.json                      # tree only (no symbol parsing)
    python3 tools/scan_folder.py PATH -o tree.json --symbols-dir DIR    # tree + symbols in a folder you choose
Options: --no-git (skip git history), --no-symbols (tree + loc + git only), --no-source (no copies of the source files)
View it:  /?tree=myrepo/tree.json
"""

import argparse
import ast
import json
import os
import shutil
import subprocess
import sys
import warnings
from datetime import datetime, timezone

# Folder names we never descend into, even though they are not hidden.
IGNORED_NAMES = {"node_modules", ".git", "__pycache__", "venv", "site-packages"}

PY_EXTS = {"py"}
JS_EXTS = {"js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"}

MAX_PARSE_BYTES = 1_000_000  # files bigger than this are not parsed (bundles, generated code)
MAX_SIGNATURE = 140          # signatures are cut to this many characters
BINARY_SNIFF = 8000          # a NUL byte in the first 8000 bytes = binary file

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS_DIR)  # explicit, so `import links` also works under `python3 -I`
import links  # noqa: E402  (Phase 4c: imports/calls -> links)


def is_ignored(name):
    """True if this entry should be left out of the tree."""
    return name in IGNORED_NAMES or name.startswith(".")


# ----------------------------------------------------------------------------- tree

def read_text_facts(path):
    """
    Return (loc, text) for a file: loc = number of lines (None for binary files),
    text = decoded source (None if binary or too big to parse).
    """
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None, None
    if b"\0" in data[:BINARY_SNIFF]:
        return None, None
    # A file "a\nb\n" has 2 lines; "a\nb" (no final newline) also has 2.
    loc = data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)
    text = None
    if len(data) <= MAX_PARSE_BYTES:
        text = data.decode("utf-8", errors="replace")
    return loc, text


def scan(path):
    """
    Build the node for `path` (recursively for folders).

    Folders: scan every child first, then size = sum of the children's sizes.
    Doing it bottom-up means each file's size is read exactly once.
    Files also remember their absolute path in "_abs" (removed before the JSON is written).
    """
    name = os.path.basename(os.path.normpath(path)) or path

    if not os.path.isdir(path):
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0  # unreadable file: keep it in the tree but count it as 0
        node = {"name": name, "type": "file", "size": size, "children": []}
        ext = os.path.splitext(name)[1].lstrip(".").lower()
        node["ext"] = ext
        loc, _ = read_text_facts(path)
        if loc is not None:
            node["loc"] = loc
        node["_abs"] = path
        return node

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


def walk_files(node, rel=""):
    """Yield (file node, path relative to the scanned root, using '/') in final tree order."""
    for child in node["children"]:
        child_rel = child["name"] if rel == "" else rel + "/" + child["name"]
        if child["type"] == "file":
            yield child, child_rel
        else:
            yield from walk_files(child, child_rel)


def strip_private(node):
    """Remove the temporary '_abs' keys before writing JSON."""
    node.pop("_abs", None)
    for child in node["children"]:
        strip_private(child)


# ----------------------------------------------------------------------------- git

def git_stats(root):
    """
    One `git log` pass over the whole history -> {relative path: (commit count, newest unix time)}.
    Returns {} when `root` is not inside a git repository (git is optional).
    Renames are not followed (--no-renames), merge commits are not counted twice.
    """
    try:
        inside = subprocess.run(["git", "-C", root, "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True)
        if inside.returncode != 0:
            return {}
        # --relative: paths are relative to `root` even when root is a sub-folder of the repo.
        proc = subprocess.Popen(
            ["git", "-C", root, "-c", "core.quotepath=false", "log", "--no-renames", "--relative",
             "--name-only", "--format=@@%ct", "--", "."],
            stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    except OSError:
        return {}  # git not installed

    stats = {}
    stamp = 0
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("@@"):
            stamp = int(line[2:])          # a new commit begins: remember its time
        elif line:
            count, newest = stats.get(line, (0, 0))
            stats[line] = (count + 1, max(newest, stamp))
    proc.wait()
    return stats


def format_date(unix_time):
    return datetime.fromtimestamp(unix_time, timezone.utc).strftime("%Y-%m-%d")


# ----------------------------------------------------------------------------- Python symbols

def short(text):
    """Collapse whitespace and cut long signatures."""
    text = " ".join(text.split())
    return text if len(text) <= MAX_SIGNATURE else text[:MAX_SIGNATURE - 1] + "…"


def py_call_name(call):
    """'foo' for foo(), 'obj.foo' for obj.foo(), plain 'foo' for self.foo() / a.b.foo()."""
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id not in ("self", "cls"):
            return f"{func.value.id}.{func.attr}"
        return func.attr
    return None


def py_extract(source):
    """
    Parse Python source with `ast` and return (symbols, imports, module-level calls).
    Raises SyntaxError for files that are not valid Python 3.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # old files have invalid escape sequences etc.
        tree = ast.parse(source)

    imports = []

    def new_scope():
        return {"calls": {}, "children": []}  # dict used as an ordered set

    def visit(node, scope, in_class):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Decorators, defaults and annotations run in the OUTER scope.
            for d in node.decorator_list:
                visit(d, scope, False)
            for d in node.args.defaults + [d for d in node.args.kw_defaults if d is not None]:
                visit(d, scope, False)
            prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
            sig = f"{prefix} {node.name}({ast.unparse(node.args)})"
            if node.returns is not None:
                sig += f" -> {ast.unparse(node.returns)}"
            inner = new_scope()
            for stmt in node.body:
                visit(stmt, inner, False)
            add_symbol(scope, "method" if in_class else "function", node, sig, inner)
        elif isinstance(node, ast.ClassDef):
            for d in node.decorator_list + node.bases + [k.value for k in node.keywords]:
                visit(d, scope, False)
            bases = [ast.unparse(b) for b in node.bases] + [f"{k.arg}={ast.unparse(k.value)}" for k in node.keywords]
            sig = f"class {node.name}" + (f"({', '.join(bases)})" if bases else "")
            inner = new_scope()
            for stmt in node.body:
                visit(stmt, inner, True)
            add_symbol(scope, "class", node, sig, inner)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"from": alias.name, "names": [f"* as {alias.asname}"] if alias.asname else [],
                                "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            # "from .utils import x" -> from ".utils";  "from . import x" -> from "."
            source_text = "." * node.level + (node.module or "")
            names = [a.name if not a.asname else f"{a.name} as {a.asname}" for a in node.names]
            imports.append({"from": source_text, "names": names, "line": node.lineno})
        else:
            if isinstance(node, ast.Call):
                name = py_call_name(node)
                if name:
                    scope["calls"][name] = True
            for child in ast.iter_child_nodes(node):
                visit(child, scope, in_class)

    def add_symbol(scope, kind, node, signature, inner):
        sym = {"kind": kind, "name": node.name, "startLine": node.lineno,
               "endLine": node.end_lineno or node.lineno, "signature": short(signature)}
        if inner["calls"]:
            sym["calls"] = list(inner["calls"])
        if inner["children"]:
            sym["children"] = inner["children"]
        scope["children"].append(sym)

    root = new_scope()
    for stmt in tree.body:
        visit(stmt, root, False)
    return root["children"], imports, list(root["calls"])


# ----------------------------------------------------------------------------- JS/TS symbols

def js_extract_batch(paths):
    """
    Run tools/parse_js.mjs once for all JS/TS files. Returns {absolute path: result dict}.
    Returns {} (with a warning) if Node or @babel/parser is not available.
    """
    if not paths:
        return {}
    node = shutil.which("node")
    if node is None or not os.path.isdir(os.path.join(TOOLS_DIR, "..", "node_modules", "@babel", "parser")):
        print("warning: Node.js or @babel/parser missing (run `npm install`): JS/TS files get no symbols",
              file=sys.stderr)
        return {}
    proc = subprocess.run([node, os.path.join(TOOLS_DIR, "parse_js.mjs")], input=json.dumps(paths),
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        print(f"warning: parse_js.mjs failed: {proc.stderr[:300]}", file=sys.stderr)
        return {}
    results = {}
    for line in proc.stdout.splitlines():
        if line.strip():
            item = json.loads(line)
            results[item["path"]] = item
    return results


def looks_minified(text, loc):
    """Very long average line length = bundled/minified code: not worth parsing."""
    return loc is not None and loc > 0 and len(text) / loc > 300


# ----------------------------------------------------------------------------- main pipeline

def extract_symbols(tree, symbols_dir, source_dir=None, collect=None):
    """
    Parse every supported file, write <symbols_dir>/<id>.json (and, if source_dir is given, a copy of the
    file's text as <source_dir>/<id>.txt) and mark the tree nodes (hasSymbols + id). Returns (number of files with symbols, number of symbols, number of failures).
    If `collect` is a list, (id, relative path, symbols doc) is appended for every file (the link resolver needs them).
    """
    py_jobs, js_jobs, texts = [], [], {}
    for node, rel in walk_files(tree):
        ext = node["ext"]
        if ext not in PY_EXTS and ext not in JS_EXTS:
            continue
        _, text = read_text_facts(node["_abs"])
        if text is None or looks_minified(text, node.get("loc")):
            continue
        texts[node["_abs"]] = text
        (py_jobs if ext in PY_EXTS else js_jobs).append((node, rel))

    js_results = js_extract_batch([n["_abs"] for n, _ in js_jobs])

    for folder, suffix in ((symbols_dir, ".json"), (source_dir, ".txt")):
        if folder is None:
            continue
        os.makedirs(folder, exist_ok=True)
        for old in os.listdir(folder):  # start clean so stale ids from a previous scan cannot linger
            if old.endswith(suffix):
                os.remove(os.path.join(folder, old))

    parsed = {}  # absolute path -> (symbols, imports, calls)
    failures = 0
    for node, _ in py_jobs:
        try:
            parsed[node["_abs"]] = py_extract(texts[node["_abs"]])
        except (SyntaxError, ValueError, RecursionError):
            failures += 1
    for node, _ in js_jobs:
        result = js_results.get(node["_abs"])
        if result and result.get("ok"):
            parsed[node["_abs"]] = (result["symbols"], result["imports"], result["calls"])
        else:
            failures += 1

    next_id = 0
    files_with_symbols = 0
    total_symbols = 0
    for node, rel in walk_files(tree):  # final tree order -> ids are stable between runs
        entry = parsed.get(node["_abs"])
        if entry is None:
            continue
        symbols, imports, calls = entry
        if not symbols and not imports:
            continue  # nothing to show: file stays a plain point
        node["hasSymbols"] = True
        node["id"] = next_id
        lang = "py" if node["ext"] in PY_EXTS else ("ts" if node["ext"] in ("ts", "tsx", "mts", "cts") else "js")
        doc = {"file": rel, "lang": lang, "loc": node.get("loc", 0),
               "symbols": symbols, "imports": imports, "calls": calls}
        with open(os.path.join(symbols_dir, f"{next_id}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
        if collect is not None:
            collect.append((next_id, rel, doc))
        if source_dir is not None:
            with open(os.path.join(source_dir, f"{next_id}.txt"), "w", encoding="utf-8", newline="\n") as f:
                f.write(texts[node["_abs"]].replace("\r\n", "\n"))
        next_id += 1
        files_with_symbols += 1
        total_symbols += count_symbols(symbols)
    return files_with_symbols, total_symbols, failures


def count_symbols(symbols):
    return sum(1 + count_symbols(s.get("children", [])) for s in symbols)


def add_git(tree, root):
    """Add commits + modified to files that git knows. Returns how many files got them."""
    stats = git_stats(root)
    hits = 0
    for node, rel in walk_files(tree):
        if rel in stats:
            node["commits"], newest = stats[rel]
            node["modified"] = format_date(newest)
            hits += 1
    return hits


def main():
    parser = argparse.ArgumentParser(description="Export a folder tree (and code symbols) as JSON.")
    parser.add_argument("path", help="folder to scan")
    parser.add_argument("-o", "--output", help="tree JSON file (default: print to stdout)")
    parser.add_argument("--out-dir", help="shortcut: writes OUT_DIR/tree.json and OUT_DIR/symbols/")
    parser.add_argument("--symbols-dir", help="where to write the per-file symbol files (enables symbol parsing)")
    parser.add_argument("--no-git", action="store_true", help="skip git history (commits, modified)")
    parser.add_argument("--no-symbols", action="store_true", help="skip symbol parsing")
    parser.add_argument("--no-source", action="store_true", help="do not copy the source files next to the symbols")
    args = parser.parse_args()

    if not os.path.isdir(args.path):
        sys.exit(f"Not a folder: {args.path}")

    output, symbols_dir = args.output, args.symbols_dir
    if args.out_dir:
        output = output or os.path.join(args.out_dir, "tree.json")
        symbols_dir = symbols_dir or os.path.join(args.out_dir, "symbols")
    if args.no_symbols:
        symbols_dir = None
    if symbols_dir and not output:
        sys.exit("Symbols need a tree file next to them: use -o FILE or --out-dir DIR")

    # Python's default recursion limit (1000) is plenty for real folder depths.
    tree = scan(args.path)

    message = f"{count_nodes(tree)} nodes"
    if not args.no_git:
        message += f", git info for {add_git(tree, args.path)} files"
    if symbols_dir:
        source_dir = None if args.no_source else os.path.join(os.path.dirname(os.path.normpath(symbols_dir)), "source")
        docs = []
        n_files, n_symbols, failures = extract_symbols(tree, symbols_dir, source_dir, collect=docs)
        message += f", {n_symbols} symbols in {n_files} files ({failures} unparseable)"
        # Path from the tree file's folder to the symbols folder, so the viewer can find it.
        tree_dir = os.path.dirname(os.path.abspath(output))
        tree["symbolsDir"] = os.path.relpath(symbols_dir, tree_dir).replace(os.sep, "/")
        # Phase 4c: resolve imports and calls into links.json, next to the symbols folder.
        link_data = links.build_links(docs, [rel for _, rel in walk_files(tree)])
        links_path = os.path.join(os.path.dirname(os.path.normpath(symbols_dir)), "links.json")
        links.write_links(link_data, links_path)
        tree["linksFile"] = os.path.relpath(links_path, tree_dir).replace(os.sep, "/")
        print(f"links: {links.summary(link_data['stats'])}", file=sys.stderr)
        if source_dir:
            tree["sourceDir"] = os.path.relpath(source_dir, tree_dir).replace(os.sep, "/")
    strip_private(tree)

    text = json.dumps(tree, separators=(",", ":"))  # compact: smaller download
    if output:
        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
        with open(output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Wrote {message} to {output}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
