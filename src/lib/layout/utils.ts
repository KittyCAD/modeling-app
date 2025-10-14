import type {
  Action,
  BasicLayout,
  Direction,
  Layout,
  LayoutWithMetadata,
  Orientation,
  PaneLayout,
  Side,
  SimpleLayout,
  SplitLayout,
  TabLayout,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import type React from 'react'
import { capitaliseFC, isArray } from '@src/lib/utils'
import type { TooltipProps } from '@src/components/Tooltip'
import { throttle } from '@src/lib/utils'
import { getPanelElement, getPanelGroupElement } from 'react-resizable-panels'
import { areaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { defaultLayoutConfig } from '@src/lib/layout/defaultLayoutConfig'
import { isErr } from '@src/lib/trap'
import { isCustomIconName } from '@src/components/CustomIcon'
import { actionTypeRegistry } from '@src/lib/layout/actionTypeRegistry'

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
 * Direction is simpler than Orientation, which uses logical properties.
 */
export function orientationToDirection(o: Orientation): Direction {
  return o === 'inline' ? 'horizontal' : 'vertical'
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

export function sideToOrientation(side: Side): Orientation {
  if (side.includes('inline')) {
    return 'inline'
  }

  return 'block'
}

export function sideToReactCss(side: Side): string {
  return side.split('-').map(capitaliseFC).join('')
}

export function orientationToReactCss(orientation: Orientation): string {
  return capitaliseFC(orientation)
}

export interface IRootAndTargetLayouts {
  rootLayout: Layout
  targetNode: Layout
}

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

export function loadLayout(id: string): Layout | Error {
  const layoutString = localStorage.getItem(`${LAYOUT_PERSIST_PREFIX}${id}`)
  if (!layoutString) {
    return new Error('No persisted layout found')
  }
  return parseLayoutFromJsonString(layoutString)
}
function saveLayoutInner({
  layout,
  layoutName = 'default',
}: { layout: Layout; layoutName?: string }) {
  return localStorage.setItem(
    `${LAYOUT_PERSIST_PREFIX}${layoutName}`,
    JSON.stringify({
      version: 'v1',
      layout,
    } satisfies LayoutWithMetadata)
  )
}
export const saveLayout = throttle(saveLayoutInner, LAYOUT_SAVE_THROTTLE)

/** Have the panes not been resized at all, just divided evenly? */
export function areSplitSizesNatural(sizes: number[]) {
  const epsilon = 0.1
  return sizes.every((size) => Math.abs(100 / sizes.length - size) < epsilon)
}

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

export function parseLayoutFromJsonString(
  layoutString: string
): Layout | Error {
  try {
    const layoutWithMetadata = JSON.parse(layoutString)
    if (
      !(
        'version' in layoutWithMetadata &&
        layoutWithMetadata.version === 'v1' &&
        'layout' in layoutWithMetadata &&
        layoutWithMetadata.layout
      )
    ) {
      return new Error('Invalid layout persistence metadata')
    }

    const parseResult = parseLayoutInner(layoutWithMetadata.layout)

    return !isErr(parseResult) ? parseResult : new Error('invalid layout')
  } catch (e) {
    return new Error(`Failed to parse layout from disk ${String(e)}`)
  }
}

export function parseLayoutInner(l: unknown): Layout | Error {
  const basicResult = parseBasicLayout(l)
  if (isErr(basicResult)) {
    console.error(basicResult)
    return basicResult
  }

  switch (basicResult.type) {
    case LayoutType.Simple:
      return parseSimpleLayout(basicResult)
    case LayoutType.Splits:
      return parseSplitLayout(basicResult)
    case LayoutType.Tabs:
      return parseTabLayout(basicResult)
    case LayoutType.Panes:
      return parsePaneLayout(basicResult)
  }
}

function validateLayoutType(l: string): l is LayoutType {
  return Object.values(LayoutType).includes(l as LayoutType)
}
function validateAreaType(a: unknown): a is keyof typeof areaTypeRegistry {
  return Object.keys(areaTypeRegistry).includes(
    a as keyof typeof areaTypeRegistry
  )
}
function validateActionType(a: unknown): a is keyof typeof actionTypeRegistry {
  return Object.keys(actionTypeRegistry).includes(
    a as keyof typeof actionTypeRegistry
  )
}

function parseBasicLayout(layout: unknown) {
  const isObject = typeof layout === 'object' && layout !== null
  if (!isObject) {
    return new Error('Invalid layout')
  }

  // Heal an invalid ID
  const hasValidId = 'id' in layout && typeof layout.id === 'string'
  if (!hasValidId) {
    layout.id = crypto.randomUUID()
  }

  // Heal invalid label
  const hasValidLabel = 'label' in layout && typeof layout.label === 'string'
  if (!hasValidLabel) {
    layout.label = 'Unlabeled area'
  }

  // Invalid layout type is fatal
  const hasValidType =
    'type' in layout &&
    typeof layout.type === 'string' &&
    validateLayoutType(layout.type)
  if (!hasValidType) {
    return new Error(
      `Layout has ${layout.type ? 'invalid' : 'missing'} type ${layout.type ?? ''}`
    )
  }

  return layout as BasicLayout
}

export function parseSimpleLayout(layout: BasicLayout): SimpleLayout | Error {
  // Must have a registered areaType, fatal if not
  const hasValidAreaType =
    'areaType' in layout && validateAreaType(layout.areaType)
  if (!hasValidAreaType) {
    return new Error('Invalid area type in simple layout')
  }

  return layout as SimpleLayout
}

function validateOrientation(o: unknown): o is Orientation {
  return typeof o === 'string' && (o === 'block' || o === 'inline')
}
export function parseSplitLayout(layout: BasicLayout): SplitLayout | Error {
  // No children is fatal
  const hasChildren = 'children' in layout && isArray(layout.children)
  if (!hasChildren) {
    return new Error('Split layout with no children, invalid')
  }

  // Invalid orientation is healable
  const hasValidOrientation =
    'orientation' in layout && validateOrientation(layout.orientation)
  if (!hasValidOrientation) {
    layout.orientation = 'inline'
  }

  // Invalid sizes is healable, divide space evenly
  const hasValidSizes =
    'sizes' in layout &&
    isArray(layout.sizes) &&
    isArray(layout.children) &&
    layout.sizes.length === layout.children.length &&
    layout.sizes.every(Number.isFinite) &&
    layout.sizes.reduce((a, b) => a + b, 0) === 100
  if (!hasValidSizes) {
    const length = isArray(layout.children) ? layout.children.length : 1
    layout.sizes = new Array(length).fill(100 / length)
  }

  // Drop catastrophically erroring children
  // TODO: propogate errors as warnings
  if (
    'children' in layout &&
    isArray(layout.children) &&
    'sizes' in layout &&
    isArray(layout.sizes)
  ) {
    // Iterate in reverse so we can remove without messing up indices
    for (let i = layout.children.length - 1; i >= 0; i--) {
      const parsedChild = parseLayoutInner(layout.children[i])
      if (isErr(parsedChild)) {
        console.error(parsedChild)
        layout.children.splice(i, 1)
        layout.sizes.splice(i, 1)
      } else {
        layout.children[i] = parsedChild
      }
    }
  }
  return layout as SplitLayout
}

function validateSide(s: unknown): s is Side {
  return (
    typeof s === 'string' &&
    ['inline-start', 'inline-end', 'block-start', 'block-end'].includes(s)
  )
}

function parseTabLayout(layout: BasicLayout): TabLayout | Error {
  // No children is fatal
  const hasChildren = 'children' in layout && isArray(layout.children)
  if (!hasChildren) {
    return new Error('Tab layout with no children, invalid')
  }

  // Invalid side is healable, default to the block-start (top in LTR)
  const hasValidSide = 'side' in layout && validateSide(layout.side)
  if (!hasValidSide) {
    layout.side = 'block-start'
  }

  // Drop catastrophically erroring children
  // TODO: propogate errors as warnings
  if ('children' in layout && isArray(layout.children)) {
    // Iterate in reverse so we can remove without messing up indices
    for (let i = layout.children.length - 1; i >= 0; i--) {
      const parsedChild = parseLayoutInner(layout.children[i])
      if (isErr(parsedChild)) {
        console.error(parsedChild)
        layout.children.splice(i, 1)
      }
    }
  }

  // Invalid activeIndex is healable, default to 0
  const hasValidActiveIndex =
    'activeIndex' in layout &&
    typeof layout.activeIndex === 'number' &&
    isArray(layout.children) &&
    Number.isSafeInteger(layout.activeIndex) &&
    layout.activeIndex >= 0 &&
    layout.activeIndex < layout.children.length
  if (!hasValidActiveIndex) {
    layout.activeIndex = 0
  }

  return layout as TabLayout
}

export function parseAction(action: unknown): Action | Error {
  const isObject = action instanceof Object && action !== null
  if (!isObject) {
    return new Error('Action is not object')
  }

  // Heal an invalid ID
  const hasValidId = 'id' in action && typeof action.id === 'string'
  if (!hasValidId) {
    action.id = crypto.randomUUID()
  }

  // Heal invalid label
  const hasValidLabel = 'label' in action && typeof action.label === 'string'
  if (!hasValidLabel) {
    action.label = 'Unlabeled area'
  }

  // Invalid actionType is fatal
  const hasValidActionType =
    'actionType' in action &&
    typeof action.actionType === 'string' &&
    validateActionType(action.actionType)
  if (!hasValidActionType) {
    return new Error(
      `Layout has ${action.actionType ? 'invalid' : 'missing'} type ${action.actionType ?? ''}`
    )
  }

  // Having a missing or invalid icon is fatal
  const hasValidIcon =
    'icon' in action &&
    typeof action.icon === 'string' &&
    isCustomIconName(action.icon)
  if (!hasValidIcon) {
    return new Error(
      `Layout has ${action.actionType ? 'invalid' : 'missing'} type ${action.actionType ?? ''}`
    )
  }

  return action as Action
}

function parsePaneLayout(layout: BasicLayout): PaneLayout | Error {
  // No children is fatal
  const hasChildren = 'children' in layout && isArray(layout.children)
  if (!hasChildren) {
    return new Error('Pane layout with no children, invalid')
  }

  // Invalid side is healable, default to the inline-start (left in LTR)
  const hasValidSide = 'side' in layout && validateSide(layout.side)
  if (!hasValidSide) {
    layout.side = 'block-start'
  }

  // Invalid orientation is healable
  const hasValidSplitOrientation =
    'splitOrientation' in layout && validateOrientation(layout.splitOrientation)
  if (!hasValidSplitOrientation) {
    layout.splitOrientation = 'block'
  }

  // Drop catastrophically erroring children
  // TODO: propogate errors as warnings
  if (
    'children' in layout &&
    isArray(layout.children) &&
    'sizes' in layout &&
    isArray(layout.sizes)
  ) {
    // Iterate in reverse so we can remove without messing up indices
    for (let i = layout.children.length - 1; i >= 0; i--) {
      const child = layout.children[i]
      //
      // Having an invalid icon is fatal
      const childHasValidIcon =
        child instanceof Object &&
        'icon' in child &&
        typeof child.icon === 'string' &&
        isCustomIconName(child.icon)
      if (!childHasValidIcon) {
        layout.children.splice(i, 1)
        layout.sizes.splice(i, 1)
      } else {
        const parsedChild = parseLayoutInner(child)
        if (isErr(parsedChild)) {
          console.error(`LAYOUT PARSE ERROR ${parsedChild.message}`)
          layout.children.splice(i, 1)
          layout.sizes.splice(i, 1)
        } else {
          // We assign over in case the parsing healed anything
          layout.children[i] = parsedChild
        }
      }
    }
  }

  // Invalid active indices is healable, just make the first active
  const hasValidActiveIndices =
    'activeIndices' in layout &&
    isArray(layout.activeIndices) &&
    layout.activeIndices.every(Number.isSafeInteger) &&
    layout.activeIndices.every((a) => a >= 0 && a < layout.children.length)
  if (!hasValidActiveIndices) {
    layout.activeIndices = [0]
  }

  // Invalid sizes is healable, divide space evenly among activeIndices
  const hasValidSizes =
    'sizes' in layout &&
    isArray(layout.sizes) &&
    'activeIndices' in layout &&
    isArray(layout.activeIndices) &&
    layout.sizes.length === layout.activeIndices.length &&
    layout.sizes.every(Number.isFinite) &&
    layout.sizes.reduce((a, b) => a + b, 0) === 100
  if (!hasValidSizes) {
    const length = isArray(layout.activeIndices)
      ? layout.activeIndices.length
      : 1
    layout.sizes = new Array(length).fill(100 / length)
  }

  // Drop catastrophically erroring actions
  // TODO: propogate errors as warnings
  if ('actions' in layout && isArray(layout.actions)) {
    // Iterate in reverse so we can remove without messing up indices
    for (let i = layout.actions.length - 1; i >= 0; i--) {
      const action = layout.actions[i]
      const parsedAction = parseAction(action)
      if (isErr(parsedAction)) {
        console.error(`LAYOUT PARSE ERROR ${parsedAction.message}`)
        layout.actions.splice(i, 1)
      } else {
        // We assign over in case the parsing healed anything
        layout.actions[i] = parsedAction
      }
    }
  }

  return layout
}
