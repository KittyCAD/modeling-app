import { Shortcut } from '@src/lib/shortcuts'
import type { ShortcutProps } from '@src/lib/shortcuts/types'
import type { DefaultLayoutPaneID } from '@src/lib/layout'

const PANE_PREFIX = 'ctrl+l'
const TOOLBAR_PREFIX = 'ctrl+period'
type PaneShortcutConfig = {
  id: `pane-toggle-${DefaultLayoutPaneID}`
} & ShortcutProps

export const toolbarShortcutConfigs = {
  sketch: {
    id: 'sketch',
    title: 'Sketch',
    description: 'Start drawing a 2D sketch',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} s`,
    enabledDescription: 'While in the editor',
  },
  extrude: {
    id: 'extrude',
    title: 'Extrude',
    description: 'Pull a sketch into 3D along its normal or perpendicular.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} e`,
    enabledDescription: 'While in the editor',
  },
  sweep: {
    id: 'sweep',
    title: 'Sweep',
    description:
      'Create a 3D body by moving a sketch region along an arbitrary path.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} w`,
    enabledDescription: 'While in the editor',
  },
  loft: {
    id: 'loft',
    title: 'Loft',
    description: 'Create a 3D body by blending between two or more sketches.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} l`,
    enabledDescription: 'While in the editor',
  },
  revolve: {
    id: 'revolve',
    title: 'Revolve',
    description: 'Create a 3D body by rotating a sketch region about an axis.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} r`,
    enabledDescription: 'While in the editor',
  },
  fillet3d: {
    id: 'fillet3d',
    title: 'Fillet',
    description: 'Round the edges of a 3D solid.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} f`,
    enabledDescription: 'While in the editor',
  },
  chamfer3d: {
    id: 'chamfer3d',
    title: 'Chamfer',
    description: 'Bevel the edges of a 3D solid.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} c`,
    enabledDescription: 'While in the editor',
  },
  shell: {
    id: 'shell',
    title: 'Shell',
    description: 'Hollow out a 3D solid.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} shift+s`,
    enabledDescription: 'While in the editor',
  },
  booleanUnion: {
    id: 'boolean-union',
    title: 'Union',
    description: 'Combine two or more solids into a single solid.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} b u`,
    enabledDescription: 'While in the editor',
  },
  booleanSubtract: {
    id: 'boolean-subtract',
    title: 'Subtract',
    description: 'Subtract one solid from another.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} b s`,
    enabledDescription: 'While in the editor',
  },
  booleanInterset: {
    id: 'boolean-intersect',
    title: 'Intersect',
    description: 'Create a solid from the intersection of two solids.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} b i`,
    enabledDescription: 'While in the editor',
  },
  offsetPlane: {
    id: 'plane-offset',
    title: 'Offset plane',
    description: 'Create a plane parallel to an existing plane.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} o`,
    enabledDescription: 'While in the editor',
  },
  helix: {
    id: 'helix',
    title: 'Helix',
    description: 'Create a helix or spiral in 3D about an axis.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} h`,
    enabledDescription: 'While in the editor',
  },
  insert: {
    id: 'insert',
    title: 'Insert',
    description: 'Insert from a file in the current project directory',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} i`,
    enabledDescription: 'While in the editor',
  },
  move: {
    id: 'translate',
    title: 'Translate',
    description: 'Apply a translation to a solid or sketch.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} t t`,
    enabledDescription: 'While in the editor',
  },
  rotate: {
    id: 'rotate',
    title: 'Rotate',
    description: 'Apply a rotation to a solid or sketch.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} t r`,
    enabledDescription: 'While in the editor',
  },
  scale: {
    id: 'scale',
    title: 'Scale',
    description: 'Apply scaling to a solid or sketch.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} t s`,
    enabledDescription: 'While in the editor',
  },
  clone: {
    id: 'clone',
    title: 'Clone',
    description: 'Clone a solid or sketch.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} t c`,
    enabledDescription: 'While in the editor',
  },
  appearance: {
    id: 'appearance',
    title: 'Appearance',
    description:
      'Set the appearance of a solid. This only works on solids, not sketches or individual paths.',
    category: 'Modeling',
    sequence: `${TOOLBAR_PREFIX} shift+a`,
    enabledDescription: 'While in the editor',
  },
} as const

export const initialShortcutConfigs = [
  {
    id: 'toggle-cmd-palette',
    title: 'Toggle command palette',
    description: 'Open and close the thing',
    category: 'Command Palette',
    sequence: 'mod+k',
    enabledDescription: 'Always available',
  },
  {
    id: 'close-cmd-palette',
    title: 'Close command palette',
    description: 'Always close the thing',
    category: 'Command Palette',
    sequence: 'esc',
    enabledDescription: 'When the command palette is open',
  },
  {
    id: 'bring-the-pain',
    title: 'Bring the pain',
    description: 'A goofy test keybinding',
    category: 'Miscellaneous',
    sequence: 'g LeftButton shift+o',
    enabledDescription: 'Always available',
  },
  {
    id: 'pane-toggle-code',
    title: 'Toggle code pane',
    description: 'The code pane in the left sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} c`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-files',
    title: 'Toggle file explorer pane',
    description: 'The file explorer pane in the left sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} p`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-feature-tree',
    title: 'Toggle feature tree pane',
    description: 'The feature tree pane in the left sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} f`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-ttc',
    title: 'Toggle Text-to-CAD pane',
    description: 'The Text-to-CAD pane in the right sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} t`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-variables',
    title: 'Toggle variables pane',
    description: 'The variables pane in the left sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} v`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-debug',
    title: 'Toggle debug pane',
    description:
      'The debug pane in the left sidebar (must have debug pane enabled)',
    category: 'Panes',
    sequence: `${PANE_PREFIX} d`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  {
    id: 'pane-toggle-logs',
    title: 'Toggle logs pane',
    description: 'The logs pane in the left sidebar',
    category: 'Panes',
    sequence: `${PANE_PREFIX} l`,
    enabledDescription: 'While in the editor',
  } satisfies PaneShortcutConfig,
  ...Object.values(toolbarShortcutConfigs),
] as const

export const initialShortcuts = initialShortcutConfigs.map(
  (config) => new Shortcut(config satisfies ShortcutProps)
)

export type ShortcutId = (typeof initialShortcutConfigs)[number]['id']
