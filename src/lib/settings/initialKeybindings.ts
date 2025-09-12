export type MouseButtonName = `${'Left' | 'Middle' | 'Right'}Button`
export type MouseOrKeyboardEvent = MouseEvent | KeyboardEvent

export type InteractionMapItem = {
  id: string
  title: string
  description: string
  sequence: string
  userDefinedSequence?: string
  guard?: (e: MouseOrKeyboardEvent) => boolean
  action: () => void | Promise<() => void>
  category: InteractionMapCategory
}

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

type InteractionMapCategory = (typeof interactionMapCategoriesInOrder)[number]

/**
 * Sorts interaction map categories by their order in the
 * `interactionMapCategories` array.
 */
export function sortInteractionMapByCategory(
  [categoryA]: [InteractionMapCategory, InteractionMapItem[]],
  [categoryB]: [InteractionMapCategory, InteractionMapItem[]]
) {
  return (
    interactionMapCategoriesInOrder.indexOf(categoryA) -
    interactionMapCategoriesInOrder.indexOf(categoryB)
  )
}

export function mouseButtonToName(
  button: MouseEvent['button']
): MouseButtonName {
  switch (button) {
    case 0:
      return 'LeftButton'
    case 1:
      return 'MiddleButton'
    case 2:
      return 'RightButton'
    default:
      return 'LeftButton'
  }
}
