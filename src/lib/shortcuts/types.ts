export type MouseButtonName = `${'Left' | 'Middle' | 'Right'}Button`
export type MouseOrKeyboardEvent = MouseEvent | KeyboardEvent

/**
 * Controls both the available names for interaction map categories
 * and the order in which they are displayed.
 */
export const interactionMapCategoriesInOrder = [
  'Sketching',
  'Modeling',
  'Command Palette',
  'Settings',
  'Panes',
  'Code Editor',
  'File Tree',
  'Miscellaneous',
] as const

export type ShortcutCategory = (typeof interactionMapCategoriesInOrder)[number]

export type ShortcutProps = {
  /** A unique identifier for the shortcut */
  id: string
  /** A human-readable title */
  title: string
  /**
   * The sequence of keystrokes and/or mouse clicks that triggers the shortcut.
   * - letters are represented by their lowercase form (ex: 'k')
   * - clicks are LeftClick, MiddleButton, or RightClick
   * - modifiers are added to a keystroke or a click with `+` (ex: `mod+k` or `shift+LeftClick`)
   * - chord sequences are separated by spaces (ex: `ctrl+g n`)
   */
  sequence: string
  /** A user-settable override value that will be persisted with settings */
  override?: string
  /** A human-readable explanation of what this shortcut does */
  description: string
  /** A human-readable category for organization in the UI */
  category: ShortcutCategory
  action?: () => void
  /** A human-readable description of when this shortcut is available */
  enabledDescription: string
}
