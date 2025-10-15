import type {
  Direction,
  Layout,
  LayoutWithMetadata,
  Orientation,
  PaneLayout,
  Side,
  SplitLayout,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import type React from 'react'
import { capitaliseFC } from '@src/lib/utils'
import type { TooltipProps } from '@src/components/Tooltip'
import { throttle } from '@src/lib/utils'
import { getPanelElement, getPanelGroupElement } from 'react-resizable-panels'
import { defaultLayoutConfig } from '@src/lib/layout/configs/default'
import { isErr } from '@src/lib/trap'
import { parseLayoutFromJsonString } from '@src/lib/layout/parse'

const LAYOUT_PERSIST_PREFIX = 'layout-'
const LAYOUT_SAVE_THROTTLE = 500

// Attempt to load a persisted layout
const defaultLayoutLoadResult = loadLayout('default')
export const defaultLayout = isErr(defaultLayoutLoadResult)
  ? defaultLayoutConfig
  : defaultLayoutLoadResult

/**
 * A split area must have the same number of sizes as children.
 * Each point must be an integer between 0 and 100.
 * The sum of the areas must be 100.
 */
export function hasValidSizes(area: SplitLayout | PaneLayout) {
  return (
    area.sizes.length === area.children.length &&
    area.sizes.every((p) => Number.isInteger(p) && p > 0 && p < 100)
  )
}

export function getOppositeOrientation(o: Orientation): Orientation {
  return o === 'inline' ? 'block' : 'inline'
}

export function getOppositeSide(side: Side): Side {
  switch (side) {
    case 'inline-start':
      return 'inline-end'
    case 'inline-end':
      return 'inline-start'
    case 'block-start':
      return 'block-end'
    case 'block-end':
      return 'block-start'
  }
}

/**
 * Converts from CSS logical properties, which the layout Side type uses,
 * to the traditional "side" description that our Tooltip component uses.
 */
export function logicalSideToTooltipPosition(
  side: Side
): TooltipProps['position'] {
  switch (side) {
    case 'inline-start':
      return 'left'
    case 'inline-end':
      return 'right'
    case 'block-start':
      return 'top'
    case 'block-end':
      return 'bottom'
  }
}
/**
 * Direction is simpler than Orientation, which uses CSS logical properties.
 * The split layout library we use takes a Direction though.
 */
export function orientationToDirection(o: Orientation): Direction {
  return o === 'inline' ? 'horizontal' : 'vertical'
}

/**
 * Gets the Tailwind className that corresponds to a Side
 */
export function sideToTailwindLayoutDirection(
  side: Side
): React.HTMLProps<HTMLElement>['className'] {
  switch (side) {
    case 'inline-start':
      return 'flex-row'
    case 'inline-end':
      return 'flex-row-reverse'
    case 'block-start':
      return 'flex-col'
    case 'block-end':
      return 'flex-col-reverse'
  }
}

/**
 * Gets the corresponding flex direction for a given Side.
 */
export function sideToTailwindTabDirection(
  side: Side
): React.HTMLProps<HTMLElement>['className'] {
  if (side.includes('inline')) {
    return 'flex-col'
  }

  return 'flex-row'
}

export function sideToSplitDirection(side: Side): Direction {
  if (side.includes('inline')) {
    return 'horizontal'
  }

  return 'vertical'
}

export function getOppositionDirection(direction: Direction): Direction {
  return direction === 'horizontal' ? 'vertical' : 'horizontal'
}

export function sideToOrientation(side: Side): Orientation {
  if (side.includes('inline')) {
    return 'inline'
  }

  return 'block'
}

/**
 * @example - `inline-start` -> `InlineStart`
 * @example - `block-end` -> `BlockEnd`
 */
export function sideToReactCss(side: Side): string {
  return side.split('-').map(capitaliseFC).join('')
}

/**
 * @example - `inline` -> `Inline`
 */
export function orientationToReactCss(orientation: Orientation): string {
  return capitaliseFC(orientation)
}

export interface IRootAndTargetLayouts {
  rootLayout: Layout
  targetNode: Layout
}

/**
 * Find and return a reference to a layout child node by `id`, if it exists
 */
export function findLayoutChildNode({
  rootLayout,
  targetNode,
}: IRootAndTargetLayouts): Layout | undefined {
  if (rootLayout.id === targetNode.id) {
    return rootLayout
  }

  if ('children' in rootLayout && rootLayout.children) {
    for (const child of rootLayout.children) {
      const found = findLayoutChildNode({ rootLayout: child, targetNode })
      if (found) {
        return found
      }
    }
  }

  return undefined
}

/**
 * Find the parent node of a `targetNode`` by its `id`, if it exists
 */
export function findLayoutParentNode({
  rootLayout,
  targetNode,
}: IRootAndTargetLayouts): Layout | undefined {
  if (rootLayout.id === targetNode.id) {
    // There is no parent because our target is the root
    return undefined
  }

  if ('children' in rootLayout && rootLayout.children) {
    for (const child of rootLayout.children) {
      if (child.id === targetNode.id) {
        return rootLayout
      }
      const found = findLayoutParentNode({ rootLayout: child, targetNode })
      if (found) {
        return found
      }
    }
  }

  return undefined
}

export interface IReplaceLayoutChildNode {
  rootLayout: Layout
  targetNodeId: string
  newNode: Layout
}

/**
 * Mutate and return a layout after attempting to
 * find-and-replace a child node by `targetNodeId`
 */
export function findAndReplaceLayoutChildNode({
  rootLayout,
  targetNodeId,
  newNode,
}: IReplaceLayoutChildNode): Layout {
  if (rootLayout.id === targetNodeId) {
    return newNode
  }

  if ('children' in rootLayout && rootLayout.children) {
    rootLayout.children = rootLayout.children.map((child) =>
      child.id === targetNodeId
        ? newNode
        : findAndReplaceLayoutChildNode({
            rootLayout: child,
            targetNodeId,
            newNode,
          })
    )
  }

  return rootLayout
}

export interface IUpdateNodeSizes extends IRootAndTargetLayouts {
  newSizes: number[]
}

/*
 * Mutate rootLayout at targetNode in-place, if found, to have newSizes.
 */
export function findAndUpdateSplitSizes({
  rootLayout,
  targetNode,
  newSizes,
}: IUpdateNodeSizes) {
  const foundNode = findLayoutChildNode({ rootLayout, targetNode })
  if (foundNode && 'sizes' in foundNode) {
    foundNode.sizes = newSizes
  }

  return rootLayout
}

/**
 * Load in a layout's persisted JSON and parse and validate it
 */
export function loadLayout(id: string): Layout | Error {
  const layoutString = localStorage.getItem(`${LAYOUT_PERSIST_PREFIX}${id}`)
  if (!layoutString) {
    return new Error('No persisted layout found')
  }
  return parseLayoutFromJsonString(layoutString)
}

interface ISaveLayout {
  layout: Layout
  layoutName?: string
  saveFn?: (key: string, value: string) => void | Promise<void>
}

/**
 * Wrap the layout data in a versioned object
 * and save it to persisted storage.
 */
function saveLayoutInner({ layout, layoutName = 'default' }: ISaveLayout) {
  return localStorage.setItem(
    `${LAYOUT_PERSIST_PREFIX}${layoutName}`,
    JSON.stringify({
      version: 'v1',
      layout,
    } satisfies LayoutWithMetadata)
  )
}
export const saveLayout = throttle(saveLayoutInner, LAYOUT_SAVE_THROTTLE)

/**
 * Have the panes not been resized at all, just divided evenly?
 * @example - [25, 25, 25, 25] --> true
 * @example - [40, 60] --> false
 */
export function areSplitSizesNatural(sizes: number[]) {
  const epsilon = 0.1
  return sizes.every((size) => Math.abs(100 / sizes.length - size) < epsilon)
}

/**
 * Mutates a layout by expanding the size of a Pane layout
 * within its Split layout parent, making it its last-known size,
 * if the Pane layout is on a side that is in-line with the flow of the parent Split layout.
 */
export function expandSplitChildPaneNode({
  rootLayout,
  targetNode: panesLayoutNode,
}: IRootAndTargetLayouts) {
  if (!panesLayoutNode || panesLayoutNode.type !== LayoutType.Panes) {
    return rootLayout
  }

  const splitsLayoutNode = findLayoutParentNode({
    rootLayout,
    targetNode: panesLayoutNode,
  })
  if (!splitsLayoutNode || splitsLayoutNode.type !== LayoutType.Splits) {
    return rootLayout
  }

  const indexOfSplit = splitsLayoutNode.children.findIndex(
    (child) => child.id === panesLayoutNode.id
  )
  splitsLayoutNode.children[indexOfSplit] = panesLayoutNode

  /**
   * Only need to expand if the child pane node is on a side that is the same
   * as its parent's orientation.
   */
  const paneToolbarIsInLineWithSplit = panesLayoutNode.side.includes(
    splitsLayoutNode.orientation
  )
  if (
    !panesLayoutNode.onExpandSize ||
    !paneToolbarIsInLineWithSplit ||
    indexOfSplit < 0
  ) {
    return rootLayout
  }

  const sizeDelta = Math.abs(
    panesLayoutNode.onExpandSize - splitsLayoutNode.sizes[indexOfSplit]
  )
  const childIndexToTransferDeltaFrom =
    indexOfSplit === 0 ? 1 : indexOfSplit - 1

  splitsLayoutNode.sizes[indexOfSplit] = panesLayoutNode.onExpandSize
  panesLayoutNode.onExpandSize = undefined
  splitsLayoutNode.sizes[childIndexToTransferDeltaFrom] -= sizeDelta
  splitsLayoutNode.children[indexOfSplit] = panesLayoutNode

  return rootLayout
}

/**
 * Mutate the rootLayout to collapse a pane layout that is a child of a split layout
 * if the pane layout's orientation is in-line with the parent split layout.
 */
export function collapseSplitChildPaneNode({
  rootLayout,
  targetNode: panesLayoutNode,
}: IRootAndTargetLayouts) {
  if (!panesLayoutNode || panesLayoutNode.type !== LayoutType.Panes) {
    return rootLayout
  }

  const splitsLayoutNode = findLayoutParentNode({
    rootLayout,
    targetNode: panesLayoutNode,
  })
  if (!splitsLayoutNode || splitsLayoutNode.type !== LayoutType.Splits) {
    return rootLayout
  }

  const indexOfSplit = splitsLayoutNode.children.findIndex(
    (child) => child.id === panesLayoutNode.id
  )
  splitsLayoutNode.children[indexOfSplit] = panesLayoutNode

  // Only need to collapse if the child pane node is on a side that is the same
  // as its parent's orientation.
  const shouldCollapse = panesLayoutNode.side.includes(
    splitsLayoutNode.orientation
  )
  if (!shouldCollapse || indexOfSplit < 0) {
    return rootLayout
  }

  // Need to reach into the DOM to get the elements to measure
  const parentElement = getPanelGroupElement(splitsLayoutNode.id)
  const childElement = getPanelElement(panesLayoutNode.id)
  const toolbarElement = childElement?.querySelector('[data-pane-toolbar]')
  if (!parentElement || indexOfSplit < 0 || !toolbarElement) {
    return rootLayout
  }

  const directionToMeasure =
    splitsLayoutNode.orientation === 'inline' ? 'width' : 'height'
  const parentSize = parentElement.getBoundingClientRect()[directionToMeasure]
  const toolbarSize = toolbarElement.getBoundingClientRect()[directionToMeasure]

  const newSizeAsPercentage = (toolbarSize / parentSize) * 100
  const sizeDelta = Math.abs(
    newSizeAsPercentage - splitsLayoutNode.sizes[indexOfSplit]
  )
  const childIndexToTransferDeltaTo = indexOfSplit === 0 ? 1 : indexOfSplit - 1

  // Mutate all the values-by-reference to make the split
  // containing the pane layout only as large as its toolbar
  panesLayoutNode.onExpandSize = splitsLayoutNode.sizes[indexOfSplit]
  const newSizes = [...splitsLayoutNode.sizes]
  newSizes[indexOfSplit] = newSizeAsPercentage
  newSizes[childIndexToTransferDeltaTo] += sizeDelta
  splitsLayoutNode.sizes = newSizes
  splitsLayoutNode.children[indexOfSplit] = panesLayoutNode

  return rootLayout
}

export function shouldEnableResizeHandle(
  currentPane: Layout,
  index: number,
  allPanes: Layout[]
): boolean {
  const isLastPane = index >= allPanes.length - 1
  const nextPane = !isLastPane ? allPanes[index + 1] : undefined
  const isCollapsedPaneLayout = (l: Layout | undefined) =>
    l?.type === LayoutType.Panes && l.onExpandSize !== undefined
  const nextIsCollapsed = isCollapsedPaneLayout(nextPane)
  const thisIsCollapsed = isCollapsedPaneLayout(currentPane)

  return !(isLastPane || nextIsCollapsed || thisIsCollapsed)
}

export interface ITogglePane extends IRootAndTargetLayouts {
  expandOrCollapse: boolean
  paneIndex: number
}
export function togglePaneLayoutNode({
  rootLayout,
  targetNode,
  expandOrCollapse,
  paneIndex,
}: ITogglePane): Layout {
  const layout = findLayoutChildNode({ rootLayout, targetNode })
  if (!layout || layout.type !== LayoutType.Panes) {
    console.error(
      `targetNode not found, pane toggling didn't occur. Target ID: ${targetNode.id}`
    )
    return rootLayout
  }
  const indexInActiveItems = layout.activeIndices.indexOf(paneIndex)
  const isInActiveItems = indexInActiveItems >= 0

  if (expandOrCollapse && !isInActiveItems) {
    layout.activeIndices.push(paneIndex)
    layout.activeIndices.sort()

    if (layout.sizes.length > 1) {
      const newActiveIndex = layout.activeIndices.indexOf(paneIndex)

      if (areSplitSizesNatural(layout.sizes)) {
        layout.sizes = Array(layout.activeIndices.length).fill(
          100 / layout.activeIndices.length
        )
      } else {
        const activeIndexToSplit = newActiveIndex === 0 ? 1 : newActiveIndex - 1
        const halfSize = (layout.sizes[activeIndexToSplit] || 2) / 2
        layout.sizes[activeIndexToSplit] = halfSize
        layout.sizes.splice(newActiveIndex, 0, halfSize)
      }
    } else if (layout.sizes.length === 1) {
      layout.sizes = [50, 50]
    } else {
      layout.sizes = [100]
      return expandSplitChildPaneNode({ rootLayout, targetNode: layout })
    }

    return findAndReplaceLayoutChildNode({
      rootLayout,
      targetNodeId: layout.id,
      newNode: layout,
    })
  } else if (!expandOrCollapse && isInActiveItems) {
    layout.activeIndices.splice(indexInActiveItems, 1)

    if (layout.sizes.length > 1) {
      const removedSize = layout.sizes.splice(indexInActiveItems, 1)
      layout.sizes[indexInActiveItems === 0 ? 0 : indexInActiveItems - 1] +=
        removedSize[0]
    } else {
      layout.activeIndices = []
      layout.sizes = []
      return collapseSplitChildPaneNode({ rootLayout, targetNode: layout })
    }

    return findAndReplaceLayoutChildNode({
      rootLayout,
      targetNodeId: layout.id,
      newNode: layout,
    })
  }
  console.warn(
    `Toggle pane seemed to be called unnecessarily: pane layout ${layout.id}`
  )
  return rootLayout
}
