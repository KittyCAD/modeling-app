import type { ToolbarGroupDefinition } from '@src/components/Toolbar/groups'

/** Mode-specific roots disappear when none of their contributed tools are present. */
export const defaultModelingToolGroups: readonly ToolbarGroupDefinition[] = [
  { id: 'kcl.modeling', title: 'Modeling', collapsePriority: -100 },
  {
    id: 'kcl.sketch.entry',
    title: 'Sketch',
    parentId: 'kcl.modeling',
    order: 0,
  },
  {
    id: 'kcl.solids',
    title: 'Solids',
    parentId: 'kcl.modeling',
    order: 1,
    collapsePriority: 100,
  },
  { id: 'kcl.sketch.editing', title: 'Sketch tools', collapsePriority: -100 },
  {
    id: 'kcl.sketch.draw',
    title: 'Draw',
    parentId: 'kcl.sketch.editing',
    order: 0,
  },
  {
    id: 'kcl.sketch.session',
    title: 'Sketch session',
    parentId: 'kcl.sketch.editing',
    order: 1,
  },
]
