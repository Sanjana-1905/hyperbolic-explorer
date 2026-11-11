#!/usr/bin/env python3
"""
make_disease_tree.py - Phase 1 of the Hyperbolic Disease Atlas: turn the official Disease Ontology into viewer data.

SOURCE (official, nothing hand-made): the Human Disease Ontology (DOID), OBO Foundry, CC0 1.0 licence.
  default release URL (a fixed release, so the result is reproducible):
    https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/<tag>/src/ontology/doid.obo
  The OBO Foundry PURL http://purl.obolibrary.org/obo/doid.obo redirects to the newest file of that repository;
  `--tag latest` asks GitHub for the newest release tag. The licence text is downloaded from the same tag.

WHAT IT WRITES (public/data/):
  disease_tree.json      the PRIMARY HIERARCHY: a plain tree (every disease has exactly one parent) in the format the existing
                         viewer already reads. Each node: name, type, size, doid, children.  capabilities = [] (no code features)
  disease_edges.json     EVERY is_a edge of the ACTIVE ontology, multiple parents included: [child, parent] pairs of DOIDs.
  disease_terms.json     per-disease details for the info card / search (loaded later, not by the layout): definition, synonyms,
                         cross-references (ICD, MeSH, ...), alternative ids, name.
  disease_metadata.json  provenance, licence, counts, parsing statistics, validation results, the primary-parent rule.
  disease_LICENSE.txt    the licence text.

RULES
  * Active terms = [Term] stanzas with a DOID: id that are not `is_obsolete: true`. Obsolete terms are removed.
  * An is_a edge pointing at an obsolete term is re-pointed to that term's `replaced_by` target when it has exactly one active
    replacement (counted as a "replacement resolved"). Obsolete terms with no replacement simply lose their edges (counted). Obsolete
    ids and their replacements are kept in the metadata so an old id can still be looked up.
  * Nothing is invented: definitions, synonyms, xrefs come from the file; a missing field stays missing.
  * Only `is_a` is used as a hierarchy relation. (Other OBO relation lines, if any, are counted in the metadata but not used.)

PRIMARY-PARENT RULE (deterministic) for a disease with several parents:
  1. Compute every disease's SHORTEST distance to the root DOID:4 ("disease") through is_a edges (breadth-first search).
  2. The primary parent is the parent with the smallest such distance (keeps the tree as shallow as possible: the Poincare ball
     has limited room for depth).
  3. Ties: the parent with the smaller numeric DOID.
  So a disease's depth in the tree equals its shortest distance to the root. Children of a node are ordered by numeric DOID.
  Every other parent link stays in disease_edges.json (nothing is thrown away).

`size` of a node = number of distinct diseases below it in the FULL graph (all is_a edges), plus itself: "how big a category is".
Node type: has primary children -> "folder", else "file" (the viewer's two node types; words say "Disease group" / "Disease").

Usage:   python3 tools/make_disease_tree.py [--tag v2026-10-29 | latest] [--obo local.obo] [--out public/data]
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

REPO = "DiseaseOntology/HumanDiseaseOntology"
DEFAULT_TAG = "v2026-10-29"
ROOT_ID = "DOID:4"
HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"          # downloaded files (git-ignored)


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return data


def latest_tag():
    with urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/releases/latest", timeout=60) as r:
        return json.load(r)["tag_name"]


# ---------------------------------------------------------------------------
# OBO parsing
# ---------------------------------------------------------------------------
def unescape(s):
    # OBO escapes: \" \\ \, \: \n etc. -> the character itself ("\n" -> newline)
    return re.sub(r"\\(.)", lambda m: "\n" if m.group(1) == "n" else m.group(1), s)


QUOTED = re.compile(r'^"((?:[^"\\]|\\.)*)"\s*(.*)$')


def split_stanzas(text):
    """Yield (stanza type, [(tag, value), ...]) for every [Stanza]; the header is ('Header', ...)."""
    kind, lines = "Header", []
    for raw in text.split("\n"):
        line = raw.rstrip()
        if line.startswith("[") and line.endswith("]"):
            yield kind, lines
            kind, lines = line[1:-1], []
        elif line and not line.startswith("!") and ":" in line:
            tag, _, value = line.partition(":")
            lines.append((tag.strip(), value.strip()))
    yield kind, lines


def strip_modifiers(value):
    """'ICD10CM:A00 {source="x"}' -> 'ICD10CM:A00' ; is_a 'DOID:1 ! name' -> 'DOID:1'."""
    value = re.sub(r"\s+!\s.*$", "", value)
    value = re.sub(r"\s*\{[^}]*\}\s*$", "", value)
    return value.strip()


def parse_term(lines):
    t = {"id": None, "name": None, "obsolete": False, "def": None, "defRefs": [], "synonyms": [], "xrefs": [], "alt": [],
         "is_a": [], "replaced_by": [], "consider": [], "other_relations": 0}
    for tag, value in lines:
        if tag == "id":
            t["id"] = value
        elif tag == "name":
            t["name"] = value
        elif tag == "is_obsolete":
            t["obsolete"] = value == "true"
        elif tag == "def":
            m = QUOTED.match(value)
            if m:
                t["def"] = unescape(m.group(1))
                refs = re.sub(r"^\[|\]\s*$", "", m.group(2).strip())
                t["defRefs"] = [r.strip() for r in re.split(r"(?<!\\),", refs) if r.strip()] if refs else []
                t["defRefs"] = [unescape(r) for r in t["defRefs"]]
        elif tag == "synonym":
            m = QUOTED.match(value)
            if m:
                scope = (m.group(2).split() or ["RELATED"])[0]
                t["synonyms"].append([unescape(m.group(1)), scope])
        elif tag == "xref":
            x = strip_modifiers(value)
            if x:
                t["xrefs"].append(x)
        elif tag == "alt_id":
            t["alt"].append(value)
        elif tag == "is_a":
            t["is_a"].append(strip_modifiers(value))
        elif tag == "replaced_by":
            t["replaced_by"].append(strip_modifiers(value))
        elif tag == "consider":
            t["consider"].append(strip_modifiers(value))
        elif tag in ("relationship", "intersection_of", "union_of"):
            t["other_relations"] += 1
    return t


def header_value(lines, tag):
    for t, v in lines:
        if t == tag:
            return v
    return None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default=DEFAULT_TAG, help="release tag of the GitHub repository, or 'latest'")
    ap.add_argument("--obo", help="use this local doid.obo instead of downloading (provenance then says so)")
    ap.add_argument("--out", default=str(HERE.parent / "public" / "data"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # ---- 1. download (official release) ------------------------------------------------------------------
    tag = latest_tag() if args.tag == "latest" else args.tag
    obo_url = f"https://raw.githubusercontent.com/{REPO}/{tag}/src/ontology/doid.obo"
    licence_url = f"https://raw.githubusercontent.com/{REPO}/{tag}/LICENSE"
    if args.obo:
        data = Path(args.obo).read_bytes()
        source_note = f"local file {Path(args.obo).name} (not downloaded by this run)"
    else:
        data = fetch(obo_url, CACHE / f"doid-{tag}.obo")
        source_note = "downloaded by tools/make_disease_tree.py"
    licence_text = fetch(licence_url, CACHE / f"doid-LICENSE-{tag}.txt").decode("utf-8")
    sha256 = hashlib.sha256(data).hexdigest()
    download_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    text = data.decode("utf-8")

    # ---- 2. parse ----------------------------------------------------------------------------------------
    header, terms = [], []
    typedefs = 0
    for kind, lines in split_stanzas(text):
        if kind == "Header":
            header = lines
        elif kind == "Term":
            terms.append(parse_term(lines))
        elif kind == "Typedef":
            typedefs += 1
    version = header_value(header, "data-version")
    version_info = next((v.split('"')[1] for t, v in header if t == "property_value" and v.startswith("owl:versionInfo")), None)
    licence_iri = next((v.split()[1] for t, v in header if t == "property_value" and v.startswith("terms:license")), None)
    onto_title = next((v.split('"')[1] for t, v in header if t == "property_value" and v.startswith("dc:title")), None)

    # ---- 3. duplicates, active / obsolete ----------------------------------------------------------------
    id_counts = Counter(t["id"] for t in terms)
    duplicate_ids = sorted(i for i, c in id_counts.items() if c > 1)
    by_id = {}
    for t in terms:
        by_id.setdefault(t["id"], t)           # first wins; duplicates are reported (and fail validation)
    non_doid = [t["id"] for t in terms if not t["id"].startswith("DOID:")]
    active = {i: t for i, t in by_id.items() if not t["obsolete"] and i.startswith("DOID:")}
    obsolete = {i: t for i, t in by_id.items() if t["obsolete"]}
    missing_name = sorted(i for i, t in active.items() if not t["name"])

    # ---- 4. is_a edges, replacements resolved ------------------------------------------------------------
    replacement_of = {}                         # obsolete id -> active replacement id (only when exactly one active one)
    for i, t in obsolete.items():
        reps = [r for r in t["replaced_by"] if r in active]
        if len(reps) == 1:
            replacement_of[i] = reps[0]
    edges, edges_via_replacement, edges_dropped_obsolete, edges_dangling = set(), 0, [], []
    raw_edge_count = 0
    for i, t in active.items():
        for p in t["is_a"]:
            raw_edge_count += 1
            if p in obsolete:
                if p in replacement_of:
                    edges.add((i, replacement_of[p]))
                    edges_via_replacement += 1
                else:
                    edges_dropped_obsolete.append([i, p])
            elif p in active:
                edges.add((i, p))
            else:
                edges_dangling.append([i, p])    # parent id exists nowhere: a missing parent reference
    duplicate_edges = raw_edge_count - len(edges) - len(edges_dropped_obsolete) - len(edges_dangling)
    num = lambda doid: int(doid.split(":")[1])
    edge_list = sorted(edges, key=lambda e: (num(e[0]), num(e[1])))
    parents, children = defaultdict(list), defaultdict(list)
    for c, p in edge_list:
        parents[c].append(p)
        children[p].append(c)

    # ---- 5. validation: cycles, roots, shortest depth ------------------------------------------------------
    problems = []
    if duplicate_ids:
        problems.append(f"duplicate ids: {duplicate_ids[:5]}")
    if ROOT_ID not in active:
        problems.append("root DOID:4 missing")
    if edges_dangling:
        problems.append(f"{len(edges_dangling)} parent references to unknown terms: {edges_dangling[:3]}")
    # Cycle check by Kahn's algorithm: repeatedly remove terms without remaining parents; leftovers are in or below a cycle.
    indeg = {i: len(parents[i]) for i in active}
    queue = deque(sorted((i for i in active if indeg[i] == 0), key=num))
    topo = []
    while queue:
        i = queue.popleft()
        topo.append(i)
        for c in children[i]:
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)
    cyclic = sorted(set(active) - set(topo), key=num)
    if cyclic:
        problems.append(f"cycle(s): {len(cyclic)} terms in/below a cycle, e.g. {cyclic[:5]}")
    parentless = sorted((i for i in active if not parents[i] and i != ROOT_ID), key=num)
    if parentless:
        problems.append(f"{len(parentless)} terms without a parent other than the root: {parentless[:5]}")
    # Shortest distance to the root (BFS downwards along is_a edges).
    depth = {ROOT_ID: 0}
    bfs = deque([ROOT_ID])
    while bfs:
        i = bfs.popleft()
        for c in children[i]:
            if c not in depth:
                depth[c] = depth[i] + 1
                bfs.append(c)
    disconnected = sorted((i for i in active if i not in depth), key=num)
    if disconnected:
        problems.append(f"{len(disconnected)} terms not reachable from the root, e.g. {disconnected[:5]}")

    # ---- 6. primary parent (documented rule) and the tree --------------------------------------------------
    primary = {}
    for i in active:
        if i == ROOT_ID or i not in depth:
            continue
        primary[i] = min(parents[i], key=lambda p: (depth[p], num(p)))
    tree_children = defaultdict(list)
    for c, p in primary.items():
        tree_children[p].append(c)
    for p in tree_children:
        tree_children[p].sort(key=num)
    # Incorrect primary-parent assignment checks: it is a real is_a parent, and the tree depth equals the shortest distance.
    bad_primary = [c for c, p in primary.items() if p not in parents[c] or depth[c] != depth[p] + 1]
    if bad_primary:
        problems.append(f"{len(bad_primary)} wrong primary parents, e.g. {bad_primary[:5]}")
    # Number of distinct descendants in the full DAG (bitsets over the reverse topological order).
    index = {i: k for k, i in enumerate(topo)}
    below = {}
    for i in reversed(topo):
        bits = 0
        for c in children[i]:
            bits |= below[c] | (1 << index[c])
        below[i] = bits
    full_size = {i: bin(below[i]).count("1") + 1 for i in topo} if not cyclic else {i: 1 for i in active}

    def node(i):
        kids = tree_children.get(i, [])
        return {"name": active[i]["name"], "type": "folder" if kids else "file", "size": full_size[i], "doid": i,
                "children": [node(k) for k in kids]}

    # Iterative depth is small (max ~ 20) so plain recursion is safe here.
    tree = node(ROOT_ID)
    tree_nodes = 1 + len(primary)
    in_tree = {ROOT_ID, *primary}
    if in_tree != set(active) - set(disconnected):
        problems.append("tree does not contain every reachable active term")
    tree["about"] = ("the complete Disease Ontology (DOID): every disease sits under the more general disease it is a kind of. "
                     "Diseases with several parents appear under one of them here; all other links are kept in the data")
    tree["words"] = {"folder": "Disease group", "file": "Disease"}
    tree["license"] = f"Disease Ontology {version_info or version}, CC0 1.0 (see disease_LICENSE.txt)"
    tree["capabilities"] = []

    # ---- 7. per-term details -----------------------------------------------------------------------------
    details = {}
    for i in sorted(active, key=num):
        t = active[i]
        d = {"n": t["name"]}
        if t["def"]:
            d["def"] = t["def"]
            if t["defRefs"]:
                d["defRefs"] = t["defRefs"]
        if t["synonyms"]:
            d["syn"] = t["synonyms"]
        if t["xrefs"]:
            d["xref"] = t["xrefs"]
        if t["alt"]:
            d["alt"] = t["alt"]
        details[i] = d

    # ---- 8. statistics -----------------------------------------------------------------------------------
    n_parents = Counter(len(parents[i]) for i in active if i != ROOT_ID)
    multi = sum(c for k, c in n_parents.items() if k > 1)
    top_level = sorted(children[ROOT_ID], key=num)
    xref_prefix = Counter(x.split(":")[0] for t in active.values() for x in t["xrefs"])
    max_depth = max(depth.values())
    deepest_via_any_path = None   # longest path is not used by the tree; only reported for information
    longest = {}
    for i in topo:
        longest[i] = 0 if not parents[i] else 1 + max(longest[p] for p in parents[i])
    deepest_via_any_path = max(longest.values()) if not cyclic else None
    depth_hist = Counter(depth.values())
    stats = {
        "total_term_stanzas": len(terms),
        "typedef_stanzas": typedefs,
        "non_DOID_terms": len(non_doid),
        "obsolete_terms_removed": len(obsolete),
        "obsolete_with_replaced_by": sum(1 for t in obsolete.values() if t["replaced_by"]),
        "replacements_resolved": len(replacement_of),
        "edges_redirected_to_replacement": edges_via_replacement,
        "edges_dropped_obsolete_without_replacement": len(edges_dropped_obsolete),
        "edges_to_unknown_terms": len(edges_dangling),
        "duplicate_is_a_lines_merged": duplicate_edges,
        "active_terms": len(active),
        "active_terms_in_primary_tree": tree_nodes,
        "is_a_edges_in_source_for_active_terms": raw_edge_count,
        "is_a_edges_preserved": len(edge_list),
        "multi_parent_diseases": multi,
        "parent_count_histogram": {str(k): v for k, v in sorted(n_parents.items())},
        "max_hierarchy_depth_primary_tree": max_depth,
        "max_hierarchy_depth_longest_path": deepest_via_any_path,
        "nodes_per_depth": {str(k): v for k, v in sorted(depth_hist.items())},
        "top_level_branches": [{"id": i, "name": active[i]["name"], "descendants": full_size[i] - 1} for i in top_level],
        "primary_tree_leaves": sum(1 for i in in_tree if not tree_children.get(i)),
        "missing_definition": sum(1 for t in active.values() if not t["def"]),
        "missing_synonyms": sum(1 for t in active.values() if not t["synonyms"]),
        "missing_xrefs": sum(1 for t in active.values() if not t["xrefs"]),
        "missing_name": len(missing_name),
        "terms_with_alt_ids": sum(1 for t in active.values() if t["alt"]),
        "xref_counts_by_source": dict(xref_prefix.most_common()),
        "terms_with_ICD_xref": sum(1 for t in active.values() if any(x.startswith("ICD") for x in t["xrefs"])),
        "terms_with_MeSH_xref": sum(1 for t in active.values() if any(x.startswith("MESH:") for x in t["xrefs"])),
        "other_relation_lines_ignored": sum(t["other_relations"] for t in active.values()),
    }
    validation = {
        "duplicate_ids": len(duplicate_ids), "missing_parent_references": len(edges_dangling), "cycles": len(cyclic),
        "disconnected_terms": len(disconnected), "terms_without_parent_besides_root": len(parentless),
        "wrong_primary_parents": len(bad_primary), "tree_matches_active_terms": in_tree == set(active) - set(disconnected),
        "problems": problems,
    }
    obsolete_map = {i: {"replacedBy": t["replaced_by"], "consider": t["consider"]}
                    for i, t in sorted(obsolete.items(), key=lambda kv: num(kv[0])) if t["replaced_by"] or t["consider"]}
    metadata = {
        "dataset": "Disease Ontology (DOID)",
        "ontology_title": onto_title,
        "source": {"url": obo_url, "obo_foundry_purl": "http://purl.obolibrary.org/obo/doid.obo", "repository": f"https://github.com/{REPO}",
                   "release_tag": tag, "ontology_version": version_info, "data_version": version,
                   "file_date": header_value(header, "date"), "sha256": sha256, "bytes": len(data), "obtained": source_note},
        "download_date": download_date,
        "license": {"name": "Creative Commons Zero v1.0 Universal (CC0 1.0)", "url": licence_iri, "text_file": "disease_LICENSE.txt",
                    "text_source": licence_url},
        "primary_parent_rule": ("For a disease with several is_a parents the primary parent is the one with the smallest shortest-path "
                                "distance to the root DOID:4; ties go to the smaller numeric DOID. All other is_a edges are kept in disease_edges.json."),
        "root": ROOT_ID,
        "counts": {"active_terms": len(active), "obsolete_removed": len(obsolete), "is_a_edges": len(edge_list), "tree_nodes": tree_nodes},
        "parsing_statistics": stats,
        "validation": validation,
        "obsolete_replacements": obsolete_map,
        "files": {"tree": "disease_tree.json", "edges": "disease_edges.json", "terms": "disease_terms.json"},
        "disclaimer": "Educational and exploratory use only; not a diagnostic or medical-advice system.",
    }
    edges_doc = {"source": f"Disease Ontology {version_info} ({tag})", "relation": "is_a", "primaryParentRule": metadata["primary_parent_rule"],
                 "count": len(edge_list), "edges": [[c, p] for c, p in edge_list]}

    # ---- 9. write ----------------------------------------------------------------------------------------
    def dump(name, obj, indent=None):
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":") if indent is None else None, indent=indent) + "\n", encoding="utf-8")
    dump("disease_tree.json", tree)
    dump("disease_edges.json", edges_doc)
    dump("disease_terms.json", {"source": f"Disease Ontology {version_info}", "terms": details})
    dump("disease_metadata.json", metadata, indent=1)
    (out / "disease_LICENSE.txt").write_text(
        f"Disease Ontology (DOID) {version_info}\nSource: {obo_url}\nLicence IRI (from the ontology header): {licence_iri}\n"
        f"Licence text below from: {licence_url}\n\n{licence_text}", encoding="utf-8")

    # ---- 10. report --------------------------------------------------------------------------------------
    print(f"\nDisease Ontology {version_info} ({tag}), sha256 {sha256[:16]}...")
    for k in ("total_term_stanzas", "active_terms", "obsolete_terms_removed", "replacements_resolved", "edges_redirected_to_replacement",
              "edges_dropped_obsolete_without_replacement", "max_hierarchy_depth_primary_tree", "max_hierarchy_depth_longest_path",
              "multi_parent_diseases", "is_a_edges_preserved", "missing_definition", "missing_synonyms", "missing_xrefs"):
        print(f"  {k:46s} {stats[k]}")
    print(f"  top-level branches ({len(top_level)}): " + ", ".join(b["name"] for b in stats["top_level_branches"]))
    print("validation:", json.dumps({k: v for k, v in validation.items() if k != "problems"}))
    if problems:
        print("PROBLEMS:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print("all validation checks passed")


if __name__ == "__main__":
    main()
