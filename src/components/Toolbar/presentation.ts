type ToolbarDropdownItemIdLike = {
  id: string
}

type ToolbarDropdownLike<T extends ToolbarDropdownItemIdLike> = {
  array: readonly T[]
  defaultVisibleItemIds?: string[]
  visibleItemCount?: number
}

/**
 * `ToolbarView` uses a split button for `default`: one remembered tool beside
 * a menu arrow. `recent` shows several tool buttons beside an overflow menu.
 * Omitting `display` keeps the split-button layout.
 */
export function getToolbarDropdownDisplay(dropdown: {
  display?: 'default' | 'recent'
}): 'default' | 'recent' {
  return dropdown.display ?? 'default'
}

/**
 * Choose the tool buttons shown before a recent dropdown has any saved choices.
 * Prefer `defaultVisibleItemIds`, then the first tools in `array`, up to
 * `visibleItemCount` (three by default). Removed IDs and duplicates are ignored.
 */
export function getDefaultRecentToolbarItemIds(
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const maxItems = dropdown.visibleItemCount ?? 3
  const fallbackVisibleItemIds = dropdown.array
    .slice(0, maxItems)
    .map((item) => item.id)
  const configuredVisibleItemIds = dropdown.defaultVisibleItemIds ?? []

  return [...configuredVisibleItemIds, ...fallbackVisibleItemIds]
    .filter(
      (itemId, index, itemIds) =>
        dropdown.array.some((item) => item.id === itemId) &&
        itemIds.indexOf(itemId) === index
    )
    .slice(0, maxItems)
}

/**
 * Make a tool chosen from overflow visible without rearranging the other buttons.
 * `currentItemIds` is the visible row; `recentItemIds` ranks tools by last use.
 * Replace the least recently used visible tool and put `itemId` first. Defaults
 * and declaration order rank tools with no recorded use and fill remaining slots.
 * An already-visible tool keeps its position.
 */
export function promoteRecentToolbarItemId(
  itemId: string,
  currentItemIds: readonly string[],
  recentItemIds: readonly string[],
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const maxItems = dropdown.visibleItemCount ?? 3
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)
  const availableItemIds = dropdown.array.map((item) => item.id)
  const currentVisibleItemIds = [...currentItemIds]
    .filter(
      (nextItemId, index, itemIds) =>
        availableItemIds.includes(nextItemId) &&
        itemIds.indexOf(nextItemId) === index
    )
    .slice(0, maxItems)
  const recencyOrder = [
    itemId,
    ...recentItemIds,
    ...defaultItemIds,
    ...availableItemIds,
  ].filter(
    (nextItemId, index, itemIds) =>
      availableItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )

  if (currentVisibleItemIds.includes(itemId)) {
    return currentVisibleItemIds
  }

  const remainingVisibleItemIds = currentVisibleItemIds.filter(
    (currentVisibleItemId) => currentVisibleItemId !== itemId
  )
  const leastRecentVisibleItemId = [...remainingVisibleItemIds].sort(
    (leftItemId, rightItemId) =>
      recencyOrder.indexOf(rightItemId) - recencyOrder.indexOf(leftItemId)
  )[0]
  const nextVisibleItemIds = remainingVisibleItemIds.filter(
    (currentVisibleItemId) => currentVisibleItemId !== leastRecentVisibleItemId
  )
  const fallbackItemIds = [...defaultItemIds, ...availableItemIds].filter(
    (nextItemId, index, itemIds) =>
      !nextVisibleItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )

  return [itemId, ...nextVisibleItemIds, ...fallbackItemIds].slice(0, maxItems)
}

/**
 * Record a tool's use independently of its button's position. `currentItemIds`
 * is the previous usage order, not the visible row. Return the chosen tool first,
 * followed by earlier history and unused tools in default/declaration order.
 * `ToolbarView` keeps this ranking to choose which button an overflow pick replaces;
 * clicking a visible button updates its recency without moving it.
 */
export function recordRecentToolbarItemId(
  itemId: string,
  currentItemIds: readonly string[],
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const availableItemIds = dropdown.array.map((item) => item.id)
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)

  return [
    itemId,
    ...currentItemIds,
    ...defaultItemIds,
    ...availableItemIds,
  ].filter(
    (nextItemId, index, itemIds) =>
      availableItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )
}

/**
 * Resolve the remembered visible IDs to the current tool objects for rendering.
 * Fill missing slots from defaults and declaration order. If the first active
 * tool is hidden, bring it into the row so activation outside the dropdown
 * (for example, through a shortcut) still shows the active tool.
 * This does not change `ToolbarView`'s saved visible IDs or usage history.
 */
export function resolveRecentToolbarItems<
  T extends ToolbarDropdownItemIdLike & { isActive?: boolean },
>(
  dropdown: ToolbarDropdownLike<T>,
  visibleItemIds: readonly string[]
): {
  visibleItems: T[]
} {
  const maxItems = dropdown.visibleItemCount ?? 3
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)
  const activeItemId = dropdown.array.find((item) => item.isActive)?.id
  const resolvedVisibleItemIds = [
    ...visibleItemIds,
    ...defaultItemIds,
    ...dropdown.array.map((item) => item.id),
  ]
    .filter(
      (itemId, index, itemIds) =>
        dropdown.array.some((item) => item.id === itemId) &&
        itemIds.indexOf(itemId) === index
    )
    .slice(0, maxItems)
  const nextVisibleItemIds =
    activeItemId && !resolvedVisibleItemIds.includes(activeItemId)
      ? promoteRecentToolbarItemId(
          activeItemId,
          resolvedVisibleItemIds,
          [],
          dropdown
        )
      : resolvedVisibleItemIds
  const uniqueOrderedItemIds = nextVisibleItemIds.filter(
    (itemId, index, itemIds) =>
      dropdown.array.some((item) => item.id === itemId) &&
      itemIds.indexOf(itemId) === index
  )
  const finalVisibleItemIds = uniqueOrderedItemIds.slice(0, maxItems)
  const visibleItems = finalVisibleItemIds
    .map((itemId) => dropdown.array.find((item) => item.id === itemId))
    .filter((item): item is T => item !== undefined)
  return {
    visibleItems,
  }
}
