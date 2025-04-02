import { isDesktop } from '@src/lib/isDesktop'
import { platform } from '@src/lib/utils'

export type InteractionMapItem = {
  name: string
  sequence: string
  title: string
  description: string
}

/**
 * Controls both the available names for interaction map categories
 * and the order in which they are displayed.
 */
const interactionMapCategories = [
  'Sketching',
  'Modeling',
  'Command Palette',
  'Settings',
  'Panes',
  'Code Editor',
  'File Tree',
  'Miscellaneous',
]

type InteractionMapCategory = (typeof interactionMapCategories)[number]

/**
 * Primary modifier key for the current platform.
 */
const PRIMARY = platform() === 'macos' ? 'Command' : 'Control'

/**
 * A temporary implementation of the interaction map for
 * display purposes only.
 * @todo Implement a proper interaction map
 * that can be edited, saved, and loaded. This is underway in the
 * franknoirot/editable-hotkeys branch.
 */
export const interactionMap: Record<
  InteractionMapCategory,
  InteractionMapItem[]
> = {
  Settings: [
    {
      name: 'toggle-settings',
      sequence: isDesktop() ? `${PRIMARY}+,` : `Shift+${PRIMARY}+,`,
      title: 'Toggle Settings',
      description: 'Opens the settings dialog. Always available.',
    },
    {
      name: 'settings-search',
      sequence: 'Control+.',
      title: 'Settings Search',
      description:
        'Focus the settings search input. Available when settings are open.',
    },
  ],
  'Command Palette': [
    {
      name: 'toggle-command-palette',
      sequence: `${PRIMARY}+K`,
      title: 'Toggle Command Palette',
      description: 'Always available.',
    },
  ],
  Panes: [
    {
      name: 'toggle-code-pane',
      sequence: 'Shift+C',
      title: 'Toggle Code Pane',
      description:
        'Available while modeling when not typing in the code editor.',
    },
    {
      name: 'toggle-variables-pane',
      sequence: 'Shift+V',
      title: 'Toggle Variables Pane',
      description:
        'Available while modeling when not typing in the code editor.',
    },
    {
      name: 'toggle-logs-pane',
      sequence: 'Shift+L',
      title: 'Toggle Logs Pane',
      description:
        'Available while modeling when not typing in the code editor.',
    },
    {
      name: 'toggle-errors-pane',
      sequence: 'Shift+E',
      title: 'Toggle Errors Pane',
      description:
        'Available while modeling when not typing in the code editor.',
    },
  ],
  Sketching: [
    {
      name: 'enter-sketch-mode',
      sequence: 'S',
      title: 'Enter Sketch Mode',
      description:
        'Available while modeling when not typing in the code editor.',
    },
    {
      name: 'unequip-sketch-tool',
      sequence: 'Escape',
      title: 'Unequip Sketch Tool',
      description:
        'Unequips the current sketch tool. Available while sketching.',
    },
    {
      name: 'exit-sketch-mode',
      sequence: 'Escape',
      title: 'Exit Sketch Mode',
      description: 'Available while sketching, if no sketch tool is equipped.',
    },
    {
      name: 'toggle-line-tool',
      sequence: 'L',
      title: 'Toggle Line Tool',
      description:
        'Available while sketching, when not typing in the code editor.',
    },
    {
      name: 'toggle-rectangle-tool',
      sequence: 'R',
      title: 'Toggle Rectangle Tool',
      description:
        'Available while sketching, when not typing in the code editor.',
    },
    {
      name: 'toggle-arc-tool',
      sequence: 'A',
      title: 'Toggle Arc Tool',
      description:
        'Available while sketching, when not typing in the code editor.',
    },
  ],
  Modeling: [
    {
      name: 'extrude',
      sequence: 'E',
      title: 'Extrude',
      description:
        'Available while modeling with either a face selected or an empty selection, when not typing in the code editor.',
    },
    {
      name: 'center-on-selection',
      sequence: `${PRIMARY}+Alt+C`,
      title: 'Center on selection',
      description:
        'Centers the view on the selected geometry, or everything if nothing is selected.',
    },
  ],
  'Code Editor': [
    {
      name: 'format-code',
      sequence: 'Shift+Alt+F',
      title: 'Format Code',
      description:
        'Nicely formats the KCL code in the editor, available when the editor is focused.',
    },
  ],
  'File Tree': [
    {
      name: 'rename-file',
      sequence: 'Enter',
      title: 'Rename File/Folder',
      description:
        'Available when a file or folder is selected in the file tree.',
    },
    {
      name: 'delete-file',
      sequence: `${PRIMARY}+Backspace`,
      title: 'Delete File/Folder',
      description:
        'Available when a file or folder is selected in the file tree.',
    },
  ],
}

/**
 * Sorts interaction map categories by their order in the
 * `interactionMapCategories` array.
 */
export function sortInteractionMapByCategory(
  [categoryA]: [InteractionMapCategory, InteractionMapItem[]],
  [categoryB]: [InteractionMapCategory, InteractionMapItem[]]
) {
  return (
    interactionMapCategories.indexOf(categoryA) -
    interactionMapCategories.indexOf(categoryB)
  )
}
