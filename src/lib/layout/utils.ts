import type { Direction, Layout, Side } from '@src/lib/layout/types'
import type React from 'react'
import { capitaliseFC } from '@src/lib/utils'
import type { TooltipProps } from '@src/components/Tooltip'
import { throttle } from '@src/lib/utils'

const LAYOUT_PERSIST_PREFIX = 'layout-'
const LAYOUT_SAVE_THROTTLE = 500

/**
 * A split area must have the same number of sizes as children.
 * Each point must be an integer between 0 and 100.
 * The sum of the areas must be 100.
 */
export function hasValidSizes(area: Layout & { type: 'splits' }) {
  return (
    area.sizes.length === area.children.length &&
    area.sizes.every((p) => Number.isInteger(p) && p > 0 && p < 100)
  )
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

export function sideToReactCss(side: Side): string {
  return side.split('-').map(capitaliseFC).join('')
}

interface IFindLayoutChildNode {
  rootLayout: Layout
  targetNode: Layout
}

export function findLayoutChildNode(
  { rootLayout, targetNode }: IFindLayoutChildNode
): Layout | undefined {
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

export interface IReplaceLayoutChildNode {
  rootLayout: Layout
  targetNodeId: string
  newNode: Layout
}
export function findAndReplaceLayoutChildNode(
  { rootLayout, targetNodeId, newNode }: IReplaceLayoutChildNode
): Layout {
  if (rootLayout.id === targetNodeId) {
    return newNode
  }

  if ('children' in rootLayout && rootLayout.children) {
    rootLayout.children = rootLayout.children.map(child =>
      child.id === targetNodeId ? newNode : findAndReplaceLayoutChildNode({ rootLayout: child, targetNodeId, newNode })
    )
  }

  return rootLayout
}

export interface IUpdateNodeSizes extends IFindLayoutChildNode {
  newSizes: number[]
}

/* Mutate rootLayout at targetNode in-place, if found, to have newSizes. */
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

export function findAndReplaceLayoutNode({
  rootLayout,
  targetNode,
}: IFindLayoutChildNode) {
  const foundNode = findLayoutChildNode({ rootLayout, targetNode })
  if (foundNode) {
    foundNode = targetNode
  }

  return rootLayout
}


export function loadLayout(
  id: string
): Layout | undefined {
  const layoutString = localStorage.getItem(`${LAYOUT_PERSIST_PREFIX}${id}`)
  const parsed = layoutString
    ? parseLayoutString(layoutString)
    : undefined
  console.log('loaded layout', parsed)
  return parsed
}
function saveLayoutInner(
  layout: Layout
) {
  return localStorage.setItem(`${LAYOUT_PERSIST_PREFIX}${layout.id}`, JSON.stringify(layout))
}
export const saveLayout = throttle(saveLayoutInner, LAYOUT_SAVE_THROTTLE)

function parseLayoutString(
  layoutString: string
) {
  // TODO: validate this JSON
  return JSON.parse(layoutString) as Layout
}

/** Have the panes not been resized at all, just divided evenly? */
export function areSplitSizesNatural(
  sizes: number[]
) {
  const epsilon = 0.1
  return sizes.every(size => Math.abs(100 / sizes.length - size) < epsilon)
}
