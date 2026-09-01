const OVERFLOW_BUTTON_WIDTH = 36
const TOOLBAR_GAP = 4

export type ResponsiveToolbarEntry =
  | 'break'
  | {
      id: string
      array?: readonly {
        icon?: unknown
        showTitle?: boolean
      }[]
      icon?: unknown
      showTitle?: boolean
    }

function estimateToolbarItemWidth(
  item: Exclude<ResponsiveToolbarEntry, 'break'>
): number {
  if (item.showTitle || !item.icon) {
    return 96
  }
  return 28
}

function estimateExpandedEntryWidth(entry: ResponsiveToolbarEntry): number {
  if (entry === 'break') {
    return 8
  }
  if (!entry.array) {
    return estimateToolbarItemWidth(entry)
  }

  return entry.array.reduce(
    (width, item, index) =>
      width +
      estimateToolbarItemWidth({ id: entry.id, ...item }) +
      (index > 0 ? TOOLBAR_GAP : 0),
    0
  )
}

export function getResponsiveToolbarLayout(
  entries: readonly ResponsiveToolbarEntry[],
  availableWidth: number | null
): {
  expandedDropdownItemIds: string[]
  hiddenItemIds: string[]
} {
  if (availableWidth === null) {
    return { expandedDropdownItemIds: [], hiddenItemIds: [] }
  }

  const fullWidth = entries.reduce(
    (width, entry, index) =>
      width + estimateExpandedEntryWidth(entry) + (index > 0 ? TOOLBAR_GAP : 0),
    0
  )
  const cutoffIndex = (() => {
    if (fullWidth <= availableWidth) {
      return entries.length
    }

    const visibleWidth = Math.max(0, availableWidth - OVERFLOW_BUTTON_WIDTH)
    let usedWidth = 0
    let visibleItemCount = 0

    for (const [index, entry] of entries.entries()) {
      const nextWidth =
        estimateExpandedEntryWidth(entry) + (index > 0 ? TOOLBAR_GAP : 0)

      if (
        entry !== 'break' &&
        visibleItemCount > 0 &&
        usedWidth + nextWidth > visibleWidth
      ) {
        return index
      }

      usedWidth += nextWidth
      if (entry !== 'break') {
        visibleItemCount += 1
      }
    }

    return entries.length
  })()

  const visibleEntries = entries.slice(0, cutoffIndex)

  return {
    expandedDropdownItemIds: visibleEntries.flatMap((entry) =>
      entry !== 'break' && entry.array ? [entry.id] : []
    ),
    hiddenItemIds: entries
      .slice(cutoffIndex)
      .flatMap((entry) => (entry === 'break' ? [] : [entry.id])),
  }
}

export function getResponsiveToolbarHiddenItemIds(
  entries: readonly ResponsiveToolbarEntry[],
  availableWidth: number | null
): string[] {
  return getResponsiveToolbarLayout(entries, availableWidth).hiddenItemIds
}
