// dataset.js - which tree file does a page load? ONE place, used by the 3D viewer, the 2D viewer, the collapsible-tree page and study mode,
// so they can never disagree.
//
//   ?tree=name.json   always wins: public/data/name.json  (sample_tree.json, wordnet_tree.json, disease_tree.json, ...)
//   no ?tree=         normal launch  -> the Disease Ontology (the Atlas)
//   no ?tree= + ?study=1              -> sample_tree.json: the user-study tasks (public/study/tasks_sample.json) were written for the
//                                        sample repository and there is no task file for the disease data yet, so a study link without
//                                        an explicit tree must keep loading exactly what it loaded before the Atlas existed.
export const DEFAULT_TREE = 'disease_tree.json';
export const STUDY_DEFAULT_TREE = 'sample_tree.json';

export function treeFileFromUrl(params = new URLSearchParams(location.search)) {
  const explicit = params.get('tree');
  if (explicit) return explicit;
  return params.get('study') === '1' ? STUDY_DEFAULT_TREE : DEFAULT_TREE;
}
