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
import links as lk  # noqa: E402

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
    check(tree["linksFile"] == "links.json", "linksFile is relative to the tree file")
    lj = json.load(open(os.path.join(out, "links.json")))
    a_id, b_id = files["a.js"]["id"], files["lib/b.ts"]["id"]
    check([a_id, -1, b_id, -1, 0, 100] in lj["links"], "a.js imports lib/b.ts (extension guessed)")
    check(lj["names"][str(b_id)] == ["B", "B.run"], "symbol names in pre-order (methods as Class.method)")

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

# ---- 4. link resolver (Phase 4c) on a tiny hand-made repo ---------------------------------
def doc(symbols=(), imports=(), calls=()):
    return {"symbols": list(symbols), "imports": list(imports), "calls": list(calls)}


def fn(name, calls=(), children=(), kind="function"):
    s = {"kind": kind, "name": name}
    if calls:
        s["calls"] = list(calls)
    if children:
        s["children"] = list(children)
    return s


repo = [
    (0, "src/app.js", doc([fn("main", ["helper", "util.fmt", "Vec.len", "render", "map", "obj.walk", "rare", "lost"])],
                          [{"from": "./lib/helper", "names": ["helper"], "line": 1},       # extension guessed
                           {"from": "./lib", "names": ["* as util"], "line": 2},           # folder -> lib/index.ts
                           {"from": "./lib/vec.js", "names": ["Vec"], "line": 3},          # .js written, .ts on disk
                           {"from": "three", "names": ["Mesh"], "line": 4},                # bare package: external
                           {"from": "./style.css", "names": [], "line": 5}])),             # a file, but not code
    (1, "src/lib/helper.js", doc([fn("helper"), fn("walk")])),
    (2, "src/lib/index.ts", doc([fn("fmt")])),
    (3, "src/lib/vec.ts", doc([fn("Vec", kind="class", children=[fn("len", ["norm"], kind="method"),
                                                                  fn("norm", kind="method")])])),
    (4, "src/render.js", doc([fn("render"), fn("draw", ["render"])])),
    (5, "other/a.js", doc([fn("rare")])),
    (6, "pkg/__init__.py", doc([fn("init_pkg")], [{"from": ".core", "names": ["run"], "line": 1}])),
    (7, "pkg/core.py", doc([fn("run", ["step", "lost"]), fn("Engine", kind="class",
                                                             children=[fn("step", kind="method"),
                                                                       fn("go", ["step"], kind="method")])])),
    (8, "tools/cli.py", doc([fn("cli", ["run", "core.run", "pkg.init_pkg"])],
                            [{"from": "pkg", "names": ["run"], "line": 1},                 # via pkg/__init__.py re-export
                             {"from": "pkg", "names": [], "line": 2},
                             {"from": "pkg.core", "names": ["* as core"], "line": 3},
                             {"from": "os.path", "names": [], "line": 4}])),               # stdlib: external
    (9, "other/b.js", doc([fn("rare")])),
    (10, "other/c.js", doc([fn("lost")])),
    (11, "other/d.js", doc([fn("lost")])),
    (12, "other/e.js", doc([fn("lost")])),
]
paths = [rel for _, rel, _ in repo] + ["src/style.css"]
res = lk.build_links(repo, paths)
L = {tuple(l[:5]): l[5] for l in res["links"]}
st = res["stats"]
check(L.get((0, -1, 1, -1, 0)) == 100, "import ./lib/helper -> helper.js")
check(L.get((0, -1, 2, -1, 0)) == 100, "import ./lib -> lib/index.ts")
check(L.get((0, -1, 3, -1, 0)) == 100, "import ./lib/vec.js -> vec.ts")
check(st["importsExternal"] == 2 and st["importsNotCode"] == 1, f"external / non-code imports {st}")
check(L.get((0, 0, 1, 0, 1)) == 80, "helper() via the import binding")
check(L.get((0, 0, 2, 0, 1)) == 80, "util.fmt() via import * as util")
check(L.get((0, 0, 3, 1, 1)) == 70, "Vec.len() -> method len of the imported class")
check(L.get((0, 0, 4, 0, 1)) == 25, "render(): not imported, not local -> repo-wide guess, the only candidate -> 25")
check(L.get((0, 0, 1, 1, 1)) == 40, "obj.walk(): unknown receiver, unique 'walk' in an imported file -> 40")
check(L.get((0, 0, 5, 0, 1)) == 12 and L.get((0, 0, 9, 0, 1)) == 12, "rare(): 2 candidates anywhere -> 12 each")
check(not any(k[0] == 0 and k[2] in (10, 11, 12) for k in L), "lost(): 3 candidates -> ambiguous, no link")
check(not any(k[0] == 0 and k[4] == 1 and res["names"][str(k[2])][k[3]] == "map" for k in L),
      "map() is a built-in name: never guessed")
check(L.get((3, 1, 3, 2, 1)) == 70, "norm() inside class Vec -> own class member")
check(L.get((4, 1, 4, 0, 1)) == 70, "draw() calls render() of the same file")
check(L.get((7, 3, 7, 2, 1)) == 70, "self.step() -> step of the own class")
check(L.get((6, -1, 7, -1, 0)) == 100, "python relative import .core")
check(L.get((8, -1, 6, -1, 0)) == 70, "python absolute single-segment 'pkg' -> 70")
check(L.get((8, -1, 7, -1, 0)) == 90, "python absolute pkg.core -> 90")
check(L.get((8, 0, 7, 0, 1)) == 80, "run() imported from pkg, followed through pkg/__init__.py to pkg/core.py")
check(L.get((8, 0, 6, 0, 1)) == 80, "pkg.init_pkg() via import pkg")
check(not any(k[0] == 7 and k[1] == 0 and k[2] in (10, 11, 12) for k in L), "lost() from python: ambiguous")
check(lk.preorder([fn("A", children=[fn("m"), fn("n")]), fn("f", children=[fn("g")])])[3]["name"] == "f",
      "pre-order symbol index: A0 m1 n2 f3 g4")

# ---- 5. links of the committed sample: up to date, and how good the call resolution is -------
# The sample generator draws every call from (a) names defined in the same file, (b) names it imported, or (c) a
# built-in name ("map", "len", ...). So the TRUE target set of a call is known: symbols of that name in the same file
# plus top-level symbols of that name in the files whose import lists the name; built-ins have no target.
sample_links = json.load(open(os.path.join(ROOT, "public/data", tree["linksFile"])))
fresh = lk.links_for_tree(tree, os.path.join(ROOT, "public/data"))
check(fresh["links"] == sample_links["links"], "public/data/sample/links.json is up to date (run make_sample_tree.py)")
infos = []
for node, rel in sf.walk_files(tree):
    if node.get("hasSymbols"):
        infos.append(lk.FileInfo(node["id"], rel, json.load(open(os.path.join(sym_dir, f"{node['id']}.json")))))
rs = lk.Resolver(infos, {rel for _, rel in sf.walk_files(tree)})
for f in infos:
    rs.resolve_imports(f)
by_rel = {f.rel: f for f in infos}
resolved = correct = resolvable = found = unique = 0
naive = 0.0
for f in infos:
    imported = {}  # name -> set of file ids that export it to f
    for imp in f.doc["imports"]:   # the generator only imports names that the target file really defines
        for c in candidates(f.rel, imp["from"]):
            if c in by_rel:
                for n in imp["names"]:
                    if n in by_rel[c].top:
                        imported.setdefault(n, set()).add(by_rel[c].id)
    for caller, s in [(i, s) for i, s in enumerate(f.syms)] + [(-1, {"calls": f.doc.get("calls") or []})]:
        for name in s["calls"]:
            truth = {(f.id, i) for i in f.by_name.get(name, [])}
            truth |= {(g, i) for g in imported.get(name, ()) for i in rs.by_id[g].top.get(name, [])}
            truth.discard((f.id, caller))
            r = rs.resolve_call(f, caller, name)
            hits = r if isinstance(r, list) else ([r[:2]] if r[0] is not None else [])
            hits = [h[:2] for h in hits if tuple(h[:2]) != (f.id, caller)]
            resolved += len(hits)
            correct += sum(1 for h in hits if tuple(h) in truth)
            if truth:
                resolvable += 1
                found += any(tuple(h) in truth for h in hits)
                # The naive alternative: link to a symbol with that name anywhere in the repo, picked at random.
                # Its expected precision is (right candidates) / (all candidates), averaged over the calls.
                everywhere = rs.global_names.get(name, [])
                naive += sum(1 for c in everywhere if tuple(c) in truth) / max(len(everywhere), 1)
                unique += len(everywhere) == 1
precision, recall = correct / max(resolved, 1), found / max(resolvable, 1)
check(precision > 0.99, f"call resolution precision on the sample {precision:.4f}")
check(recall > 0.95, f"call resolution recall on the sample {recall:.4f}")
print(f"sample links: {sample_links['stats']['importLinks']} import + {sample_links['stats']['callLinks']} call;"
      f" call precision {precision:.4f} ({correct}/{resolved}), recall {recall:.4f} ({found}/{resolvable});"
      f" naive name-only matching would be right {naive / max(resolvable, 1):.3f} of the time"
      f" (the name is unique in the repo for only {unique} of {resolvable} calls)")

print(f"scanner tests passed ({checks} checks)")
