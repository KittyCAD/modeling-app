import type {
  ShortcutCategory,
  MouseButtonName,
} from '@src/lib/shortcuts/types'
import { interactionMapCategoriesInOrder } from '@src/lib/shortcuts/types'
import type { Shortcut } from '@src/lib/shortcuts'

/**
 * Sorts interaction map categories by their order in the
 * `interactionMapCategories` array.
 */
export function sortInteractionMapByCategory(
  [categoryA]: [ShortcutCategory, Shortcut[]],
  [categoryB]: [ShortcutCategory, Shortcut[]]
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
