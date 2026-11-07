#!/usr/bin/env python3
"""
links.py (Phase 4c) - turn the raw imports and call names of the symbol files into LINKS between files and symbols.

Used by scan_folder.py and make_sample_tree.py (they call build_links), or on its own for an existing scan:
    python3 tools/links.py public/data/NAME          # reads NAME/tree.json + symbols, writes NAME/links.json

WHY IN THE SCANNER (and not in the browser)
    Resolving a call needs the symbols of EVERY file (to know where a name is defined). The browser loads symbol files
    lazily, one per opened file, so it could never do this. Python does it once and writes one compact file.

LINKS FILE  links.json (next to tree.json; the tree root gets "linksFile": its path relative to the tree file's folder)
    {
      "version": 1,
      "links": [[fromFile, fromSym, toFile, toSym, type, conf], ...],
      "names": {"<fileId>": ["A", "A.m", ...]},         # display name of every symbol by index (methods as Class.method),
                                                         # so the viewer can list symbols of files that are not open
      "stats": {...}                                     # how many imports/calls resolved (for the report)
    }
    fromFile / toFile   file id (the number of the file's symbols file)
    fromSym / toSym     SYMBOL INDEX inside that file, or -1 for "the file itself". The symbol index is the position of
                        the symbol in a depth-first PRE-ORDER walk of the file's nested "symbols" list:
                        class A (0) > method m (1), method n (2); function f (3) > nested g (4); ...
                        The viewer (symbols.js) numbers its nodes the same way.
    type                0 = import (file -> file), 1 = call (symbol or file -> symbol)
    conf                confidence in percent (0..100), see the table below

CONFIDENCE (how sure we are that a link is real)
    import, relative path found on disk ("./x", "../y", ".mod")      100
    re-export ("export * from './x'")                                  95
    dynamic import / require / Python absolute module ("pkg.mod")      90   (single-segment Python module: 70)
    call of a name bound by an import (import {f} from './x'; f())     80   (also "ns.f()" with import * as ns)
    call "C.m()" where C is an imported or local class                  70
    call of a name defined in the SAME file (own class member first)   70 / 60
    call whose receiver is unknown ("obj.f()", "this.a.f()") matched
        by name inside this file or a file it imports, unique          40
    call matched by name anywhere in the repo, 1 or 2 candidates        25 / 12 each
    more than MAX_NAME_MATCHES candidates                               -> no link (counted as "ambiguous")
    The last two rows are GUESSES: a name like "update" may mean any of many methods. They are kept only when the
    name is rare, and they are drawn faint. Everything below 80 is approximate (see PROGRESS.md, Phase 4c).
"""

import json
import os
import posixpath
import sys

JS_EXTS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]
# "./x.js" in a TypeScript project usually means the file x.ts (TypeScript's ESM convention).
TS_FOR_JS = {".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"]}

MAX_NAME_MATCHES = 2      # name-only guesses: more candidates than this = ambiguous, no link
MAX_REEXPORT_HOPS = 3     # how far we follow barrel files (index.js re-exporting other files)

IMPORT, CALL = 0, 1

# Names of built-in functions and standard-library methods (JavaScript, the browser, Python). A call such as
# items.map(...) or s.join(...) almost always means the built-in one, so these names are never GUESSED by name
# (a name bound by an import or defined in the calling file is still resolved normally).
BUILTIN_NAMES = set("""
map filter reduce forEach find findIndex some every includes indexOf lastIndexOf push pop shift unshift splice slice
concat join sort reverse fill flat flatMap keys values entries has get set delete clear add size length at from of
isArray toString valueOf toFixed toLowerCase toUpperCase trim split replace replaceAll match matchAll test exec search
startsWith endsWith padStart padEnd charAt charCodeAt substring substr repeat apply call bind then catch finally
resolve reject all race next return throw log warn error info debug assert time timeEnd table dir trace group groupEnd
now parse stringify assign create freeze defineProperty getPrototypeOf hasOwnProperty max min abs floor ceil round
sqrt pow random sin cos tan atan atan2 exp clamp sign hypot addEventListener removeEventListener dispatchEvent
getElementById querySelector querySelectorAll createElement appendChild removeChild setAttribute getAttribute
hasAttribute removeAttribute getContext getBoundingClientRect preventDefault stopPropagation focus blur click
requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval fetch json text
open close write read send emit on off once format require describe it test expect beforeEach afterEach
len print range enumerate zip sorted isinstance issubclass getattr setattr hasattr super str int float list dict
tuple bool type id iter repr hash vars dir input append extend insert remove update copy items lower upper strip
lstrip rstrip encode decode loads dumps exists makedirs listdir
""".split())

# Confidence values (percent), see the table above.
CONF_IMPORT = 100
CONF_REEXPORT = 95
CONF_DYNAMIC = 90
CONF_PY_ABSOLUTE = 90
CONF_PY_ABSOLUTE_SHORT = 70
CONF_CALL_IMPORTED = 80
CONF_CALL_CLASS_MEMBER = 70
CONF_CALL_OWN_CLASS = 70
CONF_CALL_LOCAL_TOP = 70
CONF_CALL_LOCAL = 60
CONF_CALL_NEAR_NAME = 40
CONF_CALL_GLOBAL_NAME = 25


# ----------------------------------------------------------------------------- symbol indices

def preorder(symbols):
    """
    Flatten nested symbols in depth-first PRE-ORDER (a symbol, then all of its children, then the next symbol).
    Returns a list of dicts {name, kind, parent, cls}: parent = index of the enclosing symbol (-1 = top level),
    cls = index of the nearest enclosing class (or the symbol itself if it is a class; -1 = none).
    """
    out = []

    def walk(items, parent, cls):
        for s in items:
            idx = len(out)
            my_cls = idx if s.get("kind") == "class" else cls
            out.append({"name": s.get("name", ""), "kind": s.get("kind"), "parent": parent, "cls": cls,
                        "calls": s.get("calls") or []})
            walk(s.get("children") or [], idx, my_cls)

    walk(symbols, -1, -1)
    return out


class FileInfo:
    """Everything the resolver needs to know about one file with symbols."""

    def __init__(self, file_id, rel, doc):
        self.id = file_id
        self.rel = rel
        self.doc = doc
        self.is_py = rel.endswith(".py")
        self.syms = preorder(doc.get("symbols") or [])
        self.top = {}        # name -> [index] of top-level symbols
        self.by_name = {}    # name -> [index] of all symbols in the file
        self.members = {}    # class index -> {name: index} of its direct children
        for i, s in enumerate(self.syms):
            self.by_name.setdefault(s["name"], []).append(i)
            if s["parent"] == -1:
                self.top.setdefault(s["name"], []).append(i)
            elif self.syms[s["parent"]]["kind"] == "class":
                self.members.setdefault(s["parent"], {}).setdefault(s["name"], i)
        self.bindings = {}   # local name -> (file id, imported name) ; imported name None = whole module (namespace)
        self.imported_files = set()
        self.reexport_all = []   # file ids re-exported with "export * from"


# ----------------------------------------------------------------------------- import resolution

def split_alias(name):
    """'b as c' -> ('b', 'c');  'a' -> ('a', 'a');  '* as ns' -> ('*', 'ns')."""
    if " as " in name:
        a, b = name.split(" as ", 1)
        return a.strip(), b.strip()
    return name.strip(), name.strip()


class Resolver:
    """
    files_by_rel: {"path/from/root.ext": FileInfo} for files WITH symbols;
    all_paths: set of every file path in the tree (also .css, .json, ...), to tell "not code" from "missing".
    """

    def __init__(self, infos, all_paths):
        self.infos = infos
        self.by_rel = {f.rel: f for f in infos}
        self.by_id = {f.id: f for f in infos}
        self.all_paths = all_paths
        # Python module index: dotted suffix of every .py file -> set of file ids. "src/pkg/mod.py" is reachable as
        # "src.pkg.mod", "pkg.mod" and "mod"; "pkg/__init__.py" as "pkg". A dotted import matches only if exactly
        # one file has that suffix.
        self.py_modules = {}
        for f in infos:
            if not f.is_py:
                continue
            parts = f.rel[:-3].split("/")
            if parts[-1] == "__init__":
                parts = parts[:-1]
            for k in range(len(parts)):
                self.py_modules.setdefault(".".join(parts[k:]), set()).add(f.id)
        self.global_names = {}   # name -> [(file id, index)] over the whole repo
        for f in infos:
            for name, idxs in f.by_name.items():
                for i in idxs:
                    self.global_names.setdefault(name, []).append((f.id, i))
        self.stats = {"imports": 0, "importsResolved": 0, "importsExternal": 0, "importsNotCode": 0,
                      "importsMissing": 0, "calls": 0, "callsUnresolved": 0, "callsAmbiguous": 0, "callsSelf": 0,
                      "byStrategy": {}}

    # ---- paths
    def first_code_file(self, candidates):
        for c in candidates:
            if c in self.by_rel:
                return self.by_rel[c]
        return None

    def classify_missing(self, candidates):
        if any(c in self.all_paths for c in candidates):
            self.stats["importsNotCode"] += 1      # e.g. "./style.css", "./data.json": a file, but no symbols
        else:
            self.stats["importsMissing"] += 1

    def js_candidates(self, importer_rel, spec):
        """Paths a relative JS/TS specifier may mean, best first: as written, + extension, folder/index.ext,
        and x.ts for "x.js" (TypeScript ESM). Example: importer "src/a/b.js", spec "../c" ->
        src/c, src/c.js, src/c.jsx, ..., src/c/index.js, ... ."""
        base = posixpath.normpath(posixpath.join(posixpath.dirname(importer_rel), spec))
        if base.startswith(".."):
            return []
        out = [base] + [base + e for e in JS_EXTS] + [base + "/index" + e for e in JS_EXTS]
        stem, ext = posixpath.splitext(base)
        out += [stem + e for e in TS_FOR_JS.get(ext, [])]
        return out

    def py_relative_base(self, importer_rel, dots):
        """Folder that a Python relative import starts from: one dot = the importer's folder, each extra dot = one
        level up. Returns None if it would leave the scanned folder."""
        parts = importer_rel.split("/")[:-1]
        up = dots - 1
        if up > len(parts):
            return None
        return parts[:len(parts) - up]

    @staticmethod
    def py_module_paths(folder_parts, dotted):
        path = "/".join(folder_parts + dotted.split(".")) if dotted else "/".join(folder_parts)
        if not path:
            return ["__init__.py"]
        return [path + ".py", path + "/__init__.py"]

    def resolve_imports(self, f):
        """Fill f.bindings / f.imported_files / f.reexport_all and return file-level links [(to id, conf)]."""
        links = {}

        def link(target, conf):
            if target is not None and target.id != f.id:
                links[target.id] = max(links.get(target.id, 0), conf)
                f.imported_files.add(target.id)

        for imp in f.doc.get("imports") or []:
            self.stats["imports"] += 1
            spec = imp.get("from") or ""
            names = imp.get("names") or []
            if f.is_py:
                if self.resolve_py_import(f, spec, names, link):
                    self.stats["importsResolved"] += 1
                continue
            if spec.startswith("."):
                cands = self.js_candidates(f.rel, spec)
                found = [self.by_rel[c] for c in cands if c in self.by_rel]
                if not found:
                    self.classify_missing(cands)
                    continue
                # "./parser" when both parser.js and parser.ts exist: prefer the file that defines the imported names.
                wanted = [split_alias(n)[0] for n in names if split_alias(n)[0] not in ("*", "default")]
                target = max(found, key=lambda g: sum(1 for w in wanted if w in g.top)) if wanted else found[0]
                conf = CONF_REEXPORT if imp.get("reexport") else CONF_DYNAMIC if imp.get("dynamic") else CONF_IMPORT
                link(target, conf)
                for n in names:
                    orig, local = split_alias(n)
                    if imp.get("reexport"):
                        if orig == "*":
                            f.reexport_all.append(target.id)
                        else:
                            f.bindings.setdefault(orig, (target.id, orig))   # lets barrels pass names through
                    elif orig == "*":
                        f.bindings[local] = (target.id, None)                # import * as ns
                    else:
                        f.bindings[local] = (target.id, orig)                # import {orig as local}, default as X
                self.stats["importsResolved"] += 1
            else:
                self.stats["importsExternal"] += 1   # "three", "react", "node:fs", URLs: outside the scanned folder
        return links

    def resolve_py_import(self, f, spec, names, link):
        """Python: "from .mod import a", "from ..pkg import mod", "import pkg.mod as m", "from pkg.mod import a".
        Returns True if at least one file of the scanned folder was found (failures are counted in the stats)."""
        dots = len(spec) - len(spec.lstrip("."))
        dotted = spec[dots:]
        if dots:
            base = self.py_relative_base(f.rel, dots)
            if base is None:
                self.stats["importsMissing"] += 1
                return False
            module = self.first_code_file(self.py_module_paths(base, dotted))
            conf = CONF_IMPORT
            submodule_of = (base + dotted.split(".")) if dotted else base
        else:
            ids = self.py_modules.get(dotted, set())
            if len(ids) != 1:
                self.stats["importsExternal"] += 1   # standard library / pip package, or ambiguous inside the repo
                return False
            module = self.by_id[next(iter(ids))]
            conf = CONF_PY_ABSOLUTE if "." in dotted else CONF_PY_ABSOLUTE_SHORT
            folder = module.rel[:-3].split("/")
            submodule_of = folder[:-1] if folder[-1] == "__init__" else folder
        found_any = module is not None
        if module is not None:
            link(module, conf)
        if not names:
            # "import pkg" binds the first name; only a single-segment module can be called as "pkg.f()".
            if module is not None and "." not in dotted and dotted:
                f.bindings[dotted] = (module.id, None)
        for n in names:
            orig, local = split_alias(n)
            if orig == "*":
                if module is not None:
                    if local != "*":
                        f.bindings[local] = (module.id, None)      # import x.y as z
                    else:
                        f.reexport_all.append(module.id)           # from m import *: names flow through
                continue
            # "from pkg import mod": mod may be a SUBMODULE (a file) rather than a name inside pkg/__init__.py.
            sub = self.first_code_file(self.py_module_paths(submodule_of, orig))
            if sub is not None:
                link(sub, conf)
                f.bindings[local] = (sub.id, None)
                found_any = True
            elif module is not None:
                f.bindings[local] = (module.id, orig)
        if not found_any:
            self.stats["importsMissing"] += 1
        return found_any

    # ---- names inside files
    def find_top(self, file_id, name, hops=0):
        """(file id, symbol index) of the top-level symbol `name` exported by a file, following re-exports
        (barrel files) up to MAX_REEXPORT_HOPS. None if not found."""
        f = self.by_id.get(file_id)
        if f is None or hops > MAX_REEXPORT_HOPS:
            return None
        if name in f.top:
            return (f.id, f.top[name][0])
        if name in f.bindings:
            tid, orig = f.bindings[name]
            if orig is not None and tid != f.id:
                hit = self.find_top(tid, orig, hops + 1)
                if hit:
                    return hit
        for tid in f.reexport_all:
            hit = self.find_top(tid, name, hops + 1)
            if hit:
                return hit
        return None

    def find_default(self, file_id, local):
        """`import X from './f'` (default import): the symbol called X, or one called "default",
        or the file's only top-level class/function."""
        f = self.by_id.get(file_id)
        if f is None:
            return None
        for name in (local, "default"):
            if name in f.top:
                return (f.id, f.top[name][0])
        tops = [i for i, s in enumerate(f.syms) if s["parent"] == -1 and s["kind"] in ("class", "function")]
        return (f.id, tops[0]) if len(tops) == 1 else None

    def resolve_binding(self, f, local):
        tid, orig = f.bindings[local]
        if orig is None:
            return None
        if orig == "default":
            return self.find_default(tid, local)
        return self.find_top(tid, orig)

    # ---- calls
    def resolve_call(self, f, caller, name):
        """
        Return (file id, symbol index, conf, strategy) for one called name, or (None, reason) when no link is made.
        caller = symbol index of the calling symbol, or -1 for module-level code.
        """
        if "." in name:
            obj, prop = name.split(".", 1)
            if obj in f.bindings:
                tid, orig = f.bindings[obj]
                if orig is None:                                   # ns.f() with import * as ns / import mod
                    hit = self.find_top(tid, prop)
                    if hit:
                        return hit + (CONF_CALL_IMPORTED, "namespace")
                else:                                              # C.m() with C an imported class
                    hit = self.resolve_binding(f, obj)
                    if hit:
                        g = self.by_id[hit[0]]
                        member = g.members.get(hit[1], {}).get(prop)
                        if member is not None:
                            return (g.id, member, CONF_CALL_CLASS_MEMBER, "class member")
            elif obj in f.top:                                     # C.m() with C a class of this file
                for ci in f.top[obj]:
                    member = f.members.get(ci, {}).get(prop)
                    if member is not None:
                        return (f.id, member, CONF_CALL_CLASS_MEMBER, "class member")
            return self.guess(f, prop)                             # receiver unknown: only the method name is left

        if name in f.bindings:
            hit = self.resolve_binding(f, name)
            if hit:
                return hit + (CONF_CALL_IMPORTED, "import")
        local = f.by_name.get(name, [])
        if local:
            cls = f.syms[caller]["cls"] if caller >= 0 else -1
            if cls >= 0 and name in f.members.get(cls, {}):
                return (f.id, f.members[cls][name], CONF_CALL_OWN_CLASS, "own class")   # this.m() / self.m()
            tops = f.top.get(name, [])
            if len(tops) == 1:
                return (f.id, tops[0], CONF_CALL_LOCAL_TOP, "same file")
            if len(local) == 1:
                return (f.id, local[0], CONF_CALL_LOCAL, "same file")
            return (None, "ambiguous")
        return self.guess(f, name)

    def guess(self, f, name):
        """Name-only matching, the approximate part. Never for names of standard-library methods (BUILTIN_NAMES:
        "map", "push", "len", ...), which a repo may also define but which usually mean the built-in.
          1. inside this file and the files it imports: any symbol with that name, if exactly one;
          2. anywhere in the repo: a top-level class or function (not a method) with that name, if there are at
             most MAX_NAME_MATCHES of them. ("new Vector3()" in a file that imports from the package name.)"""
        if name in BUILTIN_NAMES:
            return (None, "unresolved")
        near = [(fid, i) for fid in [f.id] + sorted(f.imported_files)
                for i in self.by_id[fid].by_name.get(name, [])]
        if len(near) == 1:
            return near[0] + (CONF_CALL_NEAR_NAME, "name, nearby")
        if len(near) > 1:
            return (None, "ambiguous")
        cands = [(fid, i) for fid, i in self.global_names.get(name, [])
                 if self.by_id[fid].syms[i]["parent"] == -1 and self.by_id[fid].syms[i]["kind"] in ("class", "function")]
        if not cands:
            return (None, "unresolved")
        if len(cands) > MAX_NAME_MATCHES:
            return (None, "ambiguous")
        conf = max(1, round(CONF_CALL_GLOBAL_NAME / len(cands)))
        return [c + (conf, "name, anywhere") for c in cands]


def build_links(files, all_paths):
    """
    files: list of (file id, path relative to the scanned root with '/', symbols doc).
    all_paths: every file path in the tree.
    Returns the links.json object.
    """
    infos = [FileInfo(fid, rel, doc) for fid, rel, doc in files]
    r = Resolver(infos, set(all_paths))
    best = {}   # (fromFile, fromSym, toFile, toSym, type) -> conf

    def add(key, conf):
        if conf > best.get(key, 0):
            best[key] = conf

    for f in infos:   # imports first: calls need the bindings
        for tid, conf in r.resolve_imports(f).items():
            add((f.id, -1, tid, -1, IMPORT), conf)

    st = r.stats
    for f in infos:
        callers = [(i, s["calls"]) for i, s in enumerate(f.syms)] + [(-1, f.doc.get("calls") or [])]
        for caller, names in callers:
            for name in names:
                st["calls"] += 1
                res = r.resolve_call(f, caller, name)
                if isinstance(res, tuple) and res[0] is None:
                    st["callsAmbiguous" if res[1] == "ambiguous" else "callsUnresolved"] += 1
                    continue
                hits = res if isinstance(res, list) else [res]
                made = False
                for tid, ti, conf, strategy in hits:
                    if tid == f.id and ti == caller:
                        continue                      # recursion: a symbol calling itself is not a link
                    add((f.id, caller, tid, ti, CALL), conf)
                    made = True
                    st["byStrategy"][strategy] = st["byStrategy"].get(strategy, 0) + 1
                if not made:
                    st["callsSelf"] += 1

    links = [list(k[:4]) + [k[4], c] for k, c in sorted(best.items())]
    st["links"] = len(links)
    st["importLinks"] = sum(1 for l in links if l[4] == IMPORT)
    st["callLinks"] = len(links) - st["importLinks"]
    # Display names for the viewer's lists: a method is shown with its class ("Vec.len"), so the five "constructor"s of
    # a file can be told apart.
    def display(f, s):
        p = s["parent"]
        return f"{f.syms[p]['name']}.{s['name']}" if p >= 0 and f.syms[p]["kind"] == "class" else s["name"]
    names = {str(f.id): [display(f, s) for s in f.syms] for f in infos}
    return {"version": 1, "links": links, "names": names, "stats": st}


def write_links(data, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)


def summary(stats):
    s = stats
    by = ", ".join(f"{k} {v}" for k, v in sorted(s["byStrategy"].items(), key=lambda kv: -kv[1]))
    return (f"{s['links']} links ({s['importLinks']} import, {s['callLinks']} call); imports {s['importsResolved']}/"
            f"{s['imports']} resolved, {s['importsExternal']} external, {s['importsNotCode']} non-code, "
            f"{s['importsMissing']} missing; calls {s['calls']}: {s['callsUnresolved']} unresolved, "
            f"{s['callsAmbiguous']} ambiguous, {s['callsSelf']} recursive; resolved by: {by}")


def walk_tree_files(node, rel=""):
    """(file node, relative path) in tree order (same as scan_folder.walk_files)."""
    for child in node.get("children", []):
        child_rel = child["name"] if rel == "" else rel + "/" + child["name"]
        if child["type"] == "file":
            yield child, child_rel
        else:
            yield from walk_tree_files(child, child_rel)


def links_for_tree(tree, tree_dir):
    """Load every symbols file of a written tree and build its links (used by the CLI and make_sample_tree.py)."""
    sym_dir = os.path.join(tree_dir, tree["symbolsDir"])
    files, paths = [], []
    for node, rel in walk_tree_files(tree):
        paths.append(rel)
        if node.get("hasSymbols"):
            with open(os.path.join(sym_dir, f"{node['id']}.json"), encoding="utf-8") as fh:
                files.append((node["id"], rel, json.load(fh)))
    return build_links(files, paths)


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/links.py OUT_DIR   (a folder holding tree.json and symbols/)")
    out_dir = sys.argv[1]
    tree_path = os.path.join(out_dir, "tree.json")
    with open(tree_path, encoding="utf-8") as fh:
        tree = json.load(fh)
    data = links_for_tree(tree, out_dir)
    write_links(data, os.path.join(out_dir, "links.json"))
    tree["linksFile"] = "links.json"
    with open(tree_path, "w", encoding="utf-8") as fh:
        json.dump(tree, fh, separators=(",", ":"))
    print(summary(data["stats"]), file=sys.stderr)


if __name__ == "__main__":
    main()
