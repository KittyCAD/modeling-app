type ToolbarDropdownItemIdLike = {
  id: string
}

type ToolbarDropdownLike<T extends ToolbarDropdownItemIdLike> = {
  array: readonly T[]
  defaultVisibleItemIds?: string[]
  visibleItemCount?: number
}

export function getToolbarDropdownDisplay(dropdown: {
  display?: 'default' | 'recent'
}): 'default' | 'recent' {
  return dropdown.display ?? 'default'
}

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
