# Hyperbolic Disease Atlas

Explore the **Disease Ontology** (12,419 diseases, every `is_a` relationship kept) in a hyperbolic space: the Poincaré disk (2D) and ball (3D). The whole hierarchy is visible at once; the
selected disease is large in the centre and everything else shrinks toward the rim (focus + context). A student research project asking whether hyperbolic geometry improves exploration of large
biomedical ontologies. Educational and exploratory only; **not** a diagnostic or medical-advice tool.

> Work in progress on the `atlas` branch. **Start with [HANDOFF.md](HANDOFF.md)** (current status, what is unfinished, how to test), then [PROGRESS.md](PROGRESS.md) (detailed log)
> and [CLAUDE.md](CLAUDE.md) (project rules and the exact layout specification).

## Setup

Requirements: **Node 22+**, npm, Python 3 (only for `npm test` and the data generators), Chrome or Edge (only for the browser tests; set `CHROME_PATH` if it is not installed in a standard place).

```bash
git clone https://github.com/Sanjana-1905/hyperbolic-explorer.git
cd hyperbolic-explorer
git checkout atlas
npm install
npm run dev
```

Open **http://localhost:5173/hyperbolic-explorer/** (the `/hyperbolic-explorer/` base path is required).

| View | URL (after the base path) |
|---|---|
| Disease Atlas, 3D ball (current default) | `?` |
| 2D Poincaré disk | `?mode=2d` |
| Collapsible tree (study baseline) | `?mode=tree` |
| Sample dataset (fake code repository) | `?tree=sample_tree.json` |
| WordNet | `?tree=wordnet_tree.json` |

Add `&intro=0` to skip the first-visit help card.

## Tests and build

```bash
npm test                 # unit tests (Node + one Python test)
npm run build            # production build into dist/
npm run test:phone       # browser audits (headless Chrome), run one at a time:
npm run test:disease     #   test:phone, test:disease, test:groups, test:data, test:panel, test:parity
```

Details, current pass / fail status and known failures are in [HANDOFF.md](HANDOFF.md).

## Data and licences

Disease Ontology release 2026-10-29 (CC0 1.0, from the OBO Foundry / Human Disease Ontology repository), WordNet 3.0 (WordNet licence), Inter font (SIL OFL). Licence texts are in
`public/data/` and `public/fonts/`. Regenerate the ontology files with `python3 tools/make_disease_tree.py`.
