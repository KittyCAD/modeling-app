import type { SidebarId } from '@src/components/ModelingSidebar/ModelingPanes/types'
import { Shortcut } from '@src/lib/shortcuts'
import type { ShortcutProps } from '@src/lib/shortcuts/types'

const PANE_PREFIX = 'ctrl+l'
type PaneShortcutConfig = { id: `pane-toggle-${SidebarId}` } & ShortcutProps

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
    id: 'pane-toggle-text-to-cad',
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
] as const

export const initialShortcuts = initialShortcutConfigs.map(
  (config) => new Shortcut(config satisfies ShortcutProps)
)

export type ShortcutId = (typeof initialShortcutConfigs)[number]['id']
