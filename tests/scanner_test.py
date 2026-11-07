#!/usr/bin/env python3
"""
Tests for scanner v2 (tools/scan_folder.py, tools/parse_js.mjs) and the fake-symbol sample data.
Run: python3 tests/scanner_test.py     (also part of `npm test`)
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import scan_folder as sf  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
checks = 0


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)


# ---- 1. Python extraction ----------------------------------------------------------------
PY = '''import os
from .utils import helper as h
@deco()
def top(a, b=1):
    def inner():
        return deep()
    return inner() + os.path.join(a) + obj.run()
class K(Base):
    def go(self): self.step(); other()
top(2)
'''
symbols, imports, calls = sf.py_extract(PY)
check([s["name"] for s in symbols] == ["top", "K"], "py top-level symbols")
check(symbols[0]["children"][0]["name"] == "inner", "py nested function")
check(symbols[1]["children"][0]["kind"] == "method", "py method")
check(symbols[0]["startLine"] == 4 and symbols[0]["endLine"] == 7, "py line range")
check(symbols[0]["calls"] == ["inner", "join", "obj.run"], f"py calls {symbols[0]['calls']}")
check(symbols[1]["children"][0]["calls"] == ["step", "other"], "py self.step() -> step")
check(imports[0] == {"from": "os", "names": [], "line": 1}, "py import")
check(imports[1] == {"from": ".utils", "names": ["helper as h"], "line": 2}, "py relative import")
check(calls == ["deco", "top"], f"py module-level calls {calls}")

# ---- 2. whole scan of a tiny folder (JS + Python + binary + git-less) -----------------------
with tempfile.TemporaryDirectory() as tmp:
    src = os.path.join(tmp, "proj")
    os.makedirs(os.path.join(src, "lib"))
    open(os.path.join(src, "a.js"), "w").write("import {f} from './lib/b';\nexport function main() { f(); }\n")
    open(os.path.join(src, "lib", "b.ts"), "w").write("export class B { run(): void { go(); } }\n")
    open(os.path.join(src, "lib", "c.py"), "w").write("def c():\n    pass\n")
    open(os.path.join(src, "broken.py"), "w").write("def (:\n")
    open(os.path.join(src, "notes.md"), "w").write("# hi\n")
    open(os.path.join(src, "img.png"), "wb").write(b"\x89PNG\0\0\0")
    out = os.path.join(tmp, "out")
    sys.argv = ["scan_folder.py", src, "--out-dir", out, "--no-git"]
    sf.main()
    tree = json.load(open(os.path.join(out, "tree.json")))
    check(tree["symbolsDir"] == "symbols", "symbolsDir is relative to the tree file")
    check(tree["sourceDir"] == "source", "sourceDir is relative to the tree file")
    files = dict(((rel), node) for node, rel in sf.walk_files(tree))
    check(files["notes.md"]["ext"] == "md" and files["notes.md"]["loc"] == 1, "ext + loc")
    check("loc" not in files["img.png"], "binary file has no loc")
    check(files["broken.py"].get("hasSymbols") is None, "unparseable file is a plain point")
    check(all("_abs" not in n for n, _ in sf.walk_files(tree)), "no private keys leak")
    ids = sorted(n["id"] for n, _ in sf.walk_files(tree) if n.get("hasSymbols"))
    check(ids == [0, 1, 2], f"ids {ids}")
    b = json.load(open(os.path.join(out, "symbols", f"{files['lib/b.ts']['id']}.json")))
    check(b["lang"] == "ts" and b["symbols"][0]["children"][0]["calls"] == ["go"], "ts file via babel")
    copy = open(os.path.join(out, "source", f"{files['a.js']['id']}.txt")).read()
    check(copy == open(os.path.join(src, "a.js")).read(), "source copy is verbatim")
    a = json.load(open(os.path.join(out, "symbols", f"{files['a.js']['id']}.json")))
    check(a["imports"] == [{"from": "./lib/b", "names": ["f"], "line": 1}], "js import")

# ---- 3. the committed sample data is consistent -----------------------------------------
tree = json.load(open(os.path.join(ROOT, "public/data/sample_tree.json")))
sym_dir = os.path.join(ROOT, "public/data", tree["symbolsDir"])
paths = {rel for _, rel in sf.walk_files(tree)}
seen_ids = set()


def candidates(importer, spec):
    """Minimal import resolver (the real one comes in 4c): file paths a specifier may mean."""
    folder = importer.split("/")[:-1]
    if spec.startswith("."):
        dots = len(spec) - len(spec.lstrip("."))
        if importer.endswith(".py"):  # .mod / ..pkg.mod
            base = folder[:len(folder) - (dots - 1)]
            return ["/".join(base + spec.lstrip(".").split(".")) + ".py"]
        parts = list(folder)
        for p in spec.split("/"):
            if p == "..":
                parts.pop()
            elif p != ".":
                parts.append(p)
        stem = "/".join(parts)
        return [stem, stem + ".js", stem + ".ts", stem + "/index.js", stem + "/index.ts"]
    return []


def check_symbols(symbols, lo, hi, path):
    for s in symbols:
        check(lo <= s["startLine"] <= s["endLine"] <= hi, f"{path}: {s['name']} lines {s['startLine']}-{s['endLine']} outside {lo}-{hi}")
        check(s["kind"] in ("class", "function", "method"), "kind")
        check_symbols(s.get("children", []), s["startLine"], s["endLine"], path)


n_imports = 0
for node, rel in sf.walk_files(tree):
    if not node.get("hasSymbols"):
        check(not rel.endswith((".js", ".ts", ".py")), f"{rel} is code but has no symbols")
        continue
    check(node["id"] not in seen_ids, "unique ids")
    seen_ids.add(node["id"])
    doc = json.load(open(os.path.join(sym_dir, f"{node['id']}.json")))
    check(doc["file"] == rel, "symbol file matches its tree node")
    check_symbols(doc["symbols"], 1, node["loc"], rel)
    src_lines = open(os.path.join(ROOT, "public/data", tree["sourceDir"], f"{node['id']}.txt"), encoding="utf-8").read().split("\n")
    check(len(src_lines) == node["loc"], f"{rel}: fake source has {len(src_lines)} lines, loc says {node['loc']}")
    for sym in doc["symbols"]:  # the signature really is on the symbol's first line
        check(sym["signature"] in src_lines[sym["startLine"] - 1], f"{rel}: {sym['name']} header is not on line {sym['startLine']}")
    for imp in doc["imports"]:
        n_imports += 1
        check(any(c in paths for c in candidates(rel, imp["from"])), f"{rel}: import {imp['from']} resolves to no file")
check(len(seen_ids) > 1000 and n_imports > 1000, "sample has plenty of symbol files and imports")

print(f"scanner tests passed ({checks} checks)")
