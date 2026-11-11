// families.js - the colour (hue) of every node, shared by the 2D and the 3D viewer so a disease has the same colour in both.
// Each child of the root (a top-level family) gets a hue spread evenly over [ARM_HUE_FIRST, ARM_HUE_LAST]; everything below it inherits the hue
// (navigation groups too). The root has ROOT_HUE; a loose file directly under the root has LOOSE_FILE_HUE. (This is the rule the 3D viewer
// has always used for its "arms"; the visual restyle will decide the final palette, see PROGRESS.md.)
// Example: 8 families -> hues 0.55, 0.60, 0.65, ... 0.90.
import { THEME } from './theme.js';

export function assignFamilyHues(root) {
  const paint = (start, hue) => { const stack = [start]; while (stack.length) { const n = stack.pop(); n.hue = hue; for (const c of n.children) stack.push(c); } };
  root.hue = THEME.ROOT_HUE;
  const arms = root.children.filter((c) => c.type === 'folder');
  root.children.forEach((c) => { if (c.type !== 'folder') paint(c, THEME.LOOSE_FILE_HUE); });
  arms.forEach((arm, i) => paint(arm, arms.length > 1 ? THEME.ARM_HUE_FIRST + ((THEME.ARM_HUE_LAST - THEME.ARM_HUE_FIRST) * i) / (arms.length - 1) : THEME.ARM_HUE_FIRST));
}
