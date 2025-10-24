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
import { capitaliseFC, throttle } from '@src/lib/utils'
import type { TooltipProps } from '@src/components/Tooltip'
import { getPanelElement, getPanelGroupElement } from 'react-resizable-panels'
import {
  DefaultLayoutToolbarID,
  defaultLayoutConfig,
  isDefaultLayoutPaneID,
} from '@src/lib/layout/configs/default'
import { isErr } from '@src/lib/trap'
import {
  parseLayoutFromJsonString,
  parseLayoutInner,
} from '@src/lib/layout/parse'
import { LAYOUT_PERSIST_PREFIX, LAYOUT_SAVE_THROTTLE } from '@src/lib/constants'

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

export interface IRootAndTargetID {
  rootLayout: Layout
  targetNodeId: string
}
interface IRootAndTargetLayout {
  rootLayout: Layout
  targetNode: Layout
}

/**
 * Find and return a reference to a layout child node by `id`, if it exists
 */
export function findLayoutChildNode({
  rootLayout,
  targetNodeId,
}: IRootAndTargetID): Layout | undefined {
  if (rootLayout.id === targetNodeId) {
    return rootLayout
  }

  if ('children' in rootLayout && rootLayout.children) {
    for (const child of rootLayout.children) {
      const found = findLayoutChildNode({ rootLayout: child, targetNodeId })
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
  targetNodeId,
}: IRootAndTargetID): Layout | undefined {
  if (rootLayout.id === targetNodeId) {
    // There is no parent because our target is the root
    return undefined
  }

  if ('children' in rootLayout && rootLayout.children) {
    for (const child of rootLayout.children) {
      if (child.id === targetNodeId) {
        return rootLayout
      }
      const found = findLayoutParentNode({ rootLayout: child, targetNodeId })
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
    const newNodeParsed = parseLayoutInner(newNode)
    if (isErr(newNodeParsed)) {
      console.error(newNodeParsed)
      return rootLayout
    }

    return newNodeParsed
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

export interface IUpdateNodeSizes extends IRootAndTargetID {
  newSizes: number[]
}

/*
 * Mutate rootLayout at targetNode in-place, if found, to have newSizes.
 */
export function findAndUpdateSplitSizes({
  rootLayout,
  targetNodeId,
  newSizes,
}: IUpdateNodeSizes) {
  const foundNode = findLayoutChildNode({ rootLayout, targetNodeId })
  if (foundNode && 'sizes' in foundNode) {
    foundNode.sizes = newSizes
  }

  return rootLayout
}

/**
 * Load in a layout's persisted JSON and parse and validate it
 */
export function loadLayout(id: string): Layout | Error {
  if (!globalThis.localStorage) {
    return Error('No localStorage to load from')
  }
  const layoutString = globalThis.localStorage.getItem(
    `${LAYOUT_PERSIST_PREFIX}${id}`
  )
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
  if (!globalThis.localStorage) {
    return
  }
  globalThis.localStorage.setItem(
    `${LAYOUT_PERSIST_PREFIX}${layoutName}`,
    globalThis.JSON?.stringify({
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
}: IRootAndTargetLayout) {
  if (!panesLayoutNode || panesLayoutNode.type !== LayoutType.Panes) {
    return rootLayout
  }

  const splitsLayoutNode = findLayoutParentNode({
    rootLayout,
    targetNodeId: panesLayoutNode.id,
  })
  if (!splitsLayoutNode || splitsLayoutNode.type !== LayoutType.Splits) {
    return rootLayout
  }

  const indexOfSplit = splitsLayoutNode.children.findIndex(
    (child) => child.id === panesLayoutNode.id
  )

  /**
   * Only need to expand if the child pane node is on a side that is the same
   * as its parent's orientation.
   */
  const paneToolbarIsInLineWithSplit = panesLayoutNode.side.includes(
    splitsLayoutNode.orientation
  )
  if (!paneToolbarIsInLineWithSplit || indexOfSplit < 0) {
    return rootLayout
  }

  const childIndexToTransferDeltaFrom =
    indexOfSplit === 0 ? 1 : indexOfSplit - 1

  // We persist `onExpandSize` to save the user's last pane layout size,
  // but if that isn't set for whatever reason we should just split the
  // available space evenly
  const sizeToExpandTo =
    panesLayoutNode.onExpandSize && panesLayoutNode.onExpandSize > 10
      ? panesLayoutNode.onExpandSize
      : (splitsLayoutNode.sizes[indexOfSplit] +
          splitsLayoutNode.sizes[childIndexToTransferDeltaFrom]) /
        2
  const sizeDelta = Math.abs(
    sizeToExpandTo - splitsLayoutNode.sizes[indexOfSplit]
  )
  splitsLayoutNode.sizes[indexOfSplit] = sizeToExpandTo
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
}: IRootAndTargetLayout) {
  if (!panesLayoutNode || panesLayoutNode.type !== LayoutType.Panes) {
    console.error(
      `Invalid panesLayoutNode, ID: ${panesLayoutNode?.id || 'undefined'}`
    )
    return rootLayout
  }

  const splitsLayoutNode = findLayoutParentNode({
    rootLayout,
    targetNodeId: panesLayoutNode.id,
  })
  if (!splitsLayoutNode || splitsLayoutNode.type !== LayoutType.Splits) {
    console.error(
      `Invalid splitsLayoutNode, ID: ${splitsLayoutNode?.id || null}`
    )
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
    console.warn(
      `Not collapsing pane layout within split layout, ${panesLayoutNode.side} not in split orientation ${splitsLayoutNode.orientation}`
    )
    return rootLayout
  }

  // Need to reach into the DOM to get the elements to measure
  const parentElement = globalThis.document
    ? getPanelGroupElement(splitsLayoutNode.id)
    : undefined
  const childElement = globalThis.document
    ? getPanelElement(panesLayoutNode.id)
    : undefined
  const toolbarElement = childElement?.querySelector('[data-pane-toolbar]')
  const canMeasure = parentElement && toolbarElement

  const directionToMeasure =
    splitsLayoutNode.orientation === 'inline' ? 'width' : 'height'
  // Just use fallback values if we don't have elements
  const parentSize = canMeasure
    ? parentElement.getBoundingClientRect()[directionToMeasure]
    : 100
  const toolbarSize = canMeasure
    ? toolbarElement.getBoundingClientRect()[directionToMeasure]
    : 5

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

export const isCollapsedPaneLayout = (l: Layout | undefined) =>
  l?.type === LayoutType.Panes && l.activeIndices.length === 0

export function shouldEnableResizeHandle(
  currentSplitChild: Layout,
  index: number,
  allSplitChildren: Layout[]
): boolean {
  const isLastSplitChild = index >= allSplitChildren.length - 1
  const nextSplitChild = !isLastSplitChild
    ? allSplitChildren[index + 1]
    : undefined
  const nextIsCollapsed = isCollapsedPaneLayout(nextSplitChild)
  const thisIsCollapsed = isCollapsedPaneLayout(currentSplitChild)

  return !(isLastSplitChild || nextIsCollapsed || thisIsCollapsed)
}

export function shouldDisableFlex(
  currentSplitChild: Layout,
  parentLayout: Layout
): boolean {
  const isCollapsedPaneLayout =
    currentSplitChild.type === LayoutType.Panes &&
    currentSplitChild.activeIndices.length === 0
  const isParentSplit = parentLayout.type === LayoutType.Splits
  // Only need to collapse if the child pane node is on a side that is the same
  // as its parent's orientation.
  const isAlignedPaneChild =
    isCollapsedPaneLayout &&
    isParentSplit &&
    currentSplitChild.side.includes(parentLayout.orientation)
  return isAlignedPaneChild
}

export interface ITogglePane extends IRootAndTargetID {
  shouldExpand: boolean
}

/**
 * Mutates a layout by toggling a Pane layout child either opened or closed,
 * and making any adjustments to a parent Split layout needed if there is one.
 */
export function togglePaneLayoutNode({
  rootLayout,
  targetNodeId,
  shouldExpand,
}: ITogglePane): Layout {
  const paneChildLayout = findLayoutChildNode({ rootLayout, targetNodeId })
  const paneLayout = findLayoutParentNode({ rootLayout, targetNodeId })
  if (!paneLayout || paneLayout.type !== LayoutType.Panes || !paneChildLayout) {
    console.error(
      `targetNode pane child not found, pane toggling didn't occur. Target ID: ${targetNodeId}`
    )
    return rootLayout
  }
  const indexInChildren = paneLayout.children.findIndex(
    (child) => child.id === targetNodeId
  )
  if (indexInChildren < 0) {
    console.error(
      `targetNode pane child is not a child of pane layout. Target ID: ${targetNodeId}`
    )
    return rootLayout
  }

  const indexInActiveItems = paneLayout.activeIndices
    .map((index) => paneLayout.children[index])
    .findIndex((activeItem) => activeItem.id === targetNodeId)
  const isInActiveItems = indexInActiveItems >= 0

  // Needs to open and isn't already in the opened panes
  if (shouldExpand && !isInActiveItems) {
    paneLayout.activeIndices.push(indexInChildren)
    paneLayout.activeIndices.sort()

    // Already has open siblings, needs to calculate its size among them
    if (paneLayout.sizes.length > 1) {
      const newActiveIndex = paneLayout.activeIndices.indexOf(indexInChildren)

      if (areSplitSizesNatural(paneLayout.sizes)) {
        paneLayout.sizes = Array(paneLayout.activeIndices.length).fill(
          100 / paneLayout.activeIndices.length
        )
      } else {
        const activeIndexToSplit = newActiveIndex === 0 ? 1 : newActiveIndex - 1
        const halfSize = (paneLayout.sizes[activeIndexToSplit] || 2) / 2
        paneLayout.sizes[activeIndexToSplit] = halfSize
        paneLayout.sizes.splice(newActiveIndex, 0, halfSize)
      }

      // Has just one open sibling
    } else if (paneLayout.sizes.length === 1) {
      paneLayout.sizes = [50, 50]
    } else {
      // First opened pane, which means we probably need to expand the Pane layout in
      // its parent Split layout so we can see the opened pane child.
      paneLayout.sizes = [100]
      return expandSplitChildPaneNode({ rootLayout, targetNode: paneLayout })
    }

    return findAndReplaceLayoutChildNode({
      rootLayout,
      targetNodeId: paneLayout.id,
      newNode: paneLayout,
    })
  }

  if (!shouldExpand && isInActiveItems) {
    paneLayout.activeIndices.splice(indexInActiveItems, 1)

    if (paneLayout.sizes.length > 1) {
      const removedSize = paneLayout.sizes.splice(indexInActiveItems, 1)
      paneLayout.sizes[indexInActiveItems === 0 ? 0 : indexInActiveItems - 1] +=
        removedSize[0]
    } else {
      paneLayout.activeIndices = []
      paneLayout.sizes = []
      return collapseSplitChildPaneNode({ rootLayout, targetNode: paneLayout })
    }

    return findAndReplaceLayoutChildNode({
      rootLayout,
      targetNodeId: paneLayout.id,
      newNode: paneLayout,
    })
  }

  console.warn(
    `Toggle pane seemed to be called unnecessarily: pane layout ${paneLayout.id}`
  )
  return rootLayout
}

export function getOpenPanes({ rootLayout }: { rootLayout: Layout }): string[] {
  if (!rootLayout) {
    return []
  }
  const openPanes: string[] = []
  const left = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutToolbarID.Left,
  })
  if (left?.type === LayoutType.Panes) {
    for (const activeIndex of left.activeIndices) {
      openPanes.push(left.children[activeIndex].id)
    }
  }
  const right = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutToolbarID.Right,
  })
  if (right?.type === LayoutType.Panes) {
    for (const activeIndex of right.activeIndices) {
      openPanes.push(right.children[activeIndex].id)
    }
  }
  return openPanes
}

/**
 * Mutate a Layout to close all of a given pane set's panes
 */
export function closeAllPanes(
  rootLayout: Layout,
  paneLayoutID: string
): Layout {
  const paneLayout = findLayoutChildNode({
    rootLayout,
    targetNodeId: paneLayoutID,
  })
  if (!paneLayout || paneLayout.type !== LayoutType.Panes) {
    console.warn(
      `Pane layout with ID: ${paneLayoutID} not found to close all of its panes`
    )
    return rootLayout
  }

  for (const activeIndex of paneLayout.activeIndices) {
    const child = paneLayout.children[activeIndex]
    togglePaneLayoutNode({
      rootLayout,
      targetNodeId: child.id,
      shouldExpand: false,
    })
  }

  return rootLayout
}

/**
 * Mutate a Layout to find and open any panes within their parent Pane layout
 */
export function setOpenPanes(rootLayout: Layout, paneIDs: string[]): Layout {
  // TODO: Make this more generic in the future when users can have any number of Pane layouts
  closeAllPanes(rootLayout, DefaultLayoutToolbarID.Left)
  closeAllPanes(rootLayout, DefaultLayoutToolbarID.Right)

  const deduplicatedPaneIDs = new Set(paneIDs)
  const validPaneIDs = Array.from(deduplicatedPaneIDs).filter(
    isDefaultLayoutPaneID
  )
  for (const id of validPaneIDs) {
    togglePaneLayoutNode({
      rootLayout,
      targetNodeId: id,
      shouldExpand: true,
    })
  }
  return rootLayout
}
