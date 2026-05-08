import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import {
  AreaType,
  type Layout,
  LayoutType,
  type PaneChild,
  type PaneLayout,
  type SplitLayout,
} from '@src/lib/layout/types'
import {
  findLayoutChildNode,
  findLayoutParentNode,
} from '@src/lib/layout/utils'

const ZOOKEEPER_SPLIT_SIZE = 30

export const zookeeperPane = Object.freeze({
  id: DefaultLayoutPaneID.TTC,
  label: 'Zookeeper',
  type: LayoutType.Simple,
  areaType: AreaType.TTC,
  icon: 'sparkles',
} satisfies PaneChild)

function createRightSidebar(): PaneLayout {
  return {
    id: DefaultLayoutToolbarID.Right,
    label: DefaultLayoutToolbarID.Right,
    type: LayoutType.Panes,
    side: 'inline-end',
    activeIndices: [0],
    sizes: [100],
    splitOrientation: 'block',
    children: [structuredClone(zookeeperPane)],
  }
}

function getActivePaneState(paneLayout: PaneLayout) {
  const activePaneIds = paneLayout.activeIndices
    .map((activeIndex) => paneLayout.children[activeIndex]?.id)
    .filter((id) => id !== undefined)
  const sizeByPaneId = new Map(
    paneLayout.activeIndices
      .map((activeIndex, sizeIndex) => [
        paneLayout.children[activeIndex]?.id,
        paneLayout.sizes[sizeIndex],
      ])
      .filter(
        (entry): entry is [string, number] =>
          entry[0] !== undefined && entry[1] !== undefined
      )
  )

  return { activePaneIds, sizeByPaneId }
}

function setActivePaneState({
  paneLayout,
  activePaneIds,
  sizeByPaneId,
}: {
  paneLayout: PaneLayout
  activePaneIds: readonly string[]
  sizeByPaneId: Map<string, number>
}) {
  paneLayout.activeIndices = activePaneIds
    .map((id) => paneLayout.children.findIndex((child) => child.id === id))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  paneLayout.sizes = paneLayout.activeIndices.map((activeIndex) => {
    const paneId = paneLayout.children[activeIndex]?.id
    return paneId ? (sizeByPaneId.get(paneId) ?? 0) : 0
  })
}

function appendSplitSize(
  sizes: readonly number[],
  existingChildCount: number
): number[] {
  const nextChildCount = existingChildCount + 1
  const total = sizes.reduce((sum, size) => sum + size, 0)

  if (sizes.length !== existingChildCount || total <= 0) {
    return new Array(nextChildCount).fill(100 / nextChildCount)
  }

  const remainingSize = 100 - ZOOKEEPER_SPLIT_SIZE
  const scale = remainingSize / total
  return [...sizes.map((size) => size * scale), ZOOKEEPER_SPLIT_SIZE]
}

function removeSplitChild(rootLayout: Layout, childId: string) {
  const parent = findLayoutParentNode({ rootLayout, targetNodeId: childId })
  if (!parent || parent.type !== LayoutType.Splits) {
    return false
  }

  const childIndex = parent.children.findIndex((child) => child.id === childId)
  if (childIndex < 0) {
    return false
  }

  const removedSize = parent.sizes[childIndex] ?? 0
  parent.children.splice(childIndex, 1)
  parent.sizes.splice(childIndex, 1)

  if (parent.sizes.length > 0) {
    const recipientIndex = childIndex === 0 ? 0 : childIndex - 1
    parent.sizes[recipientIndex] += removedSize
  }

  return true
}

function removePaneChild(paneLayout: PaneLayout, childId: string) {
  const childIndex = paneLayout.children.findIndex(
    (child) => child.id === childId
  )
  if (childIndex < 0) {
    return false
  }

  const { activePaneIds, sizeByPaneId } = getActivePaneState(paneLayout)
  paneLayout.children.splice(childIndex, 1)
  setActivePaneState({
    paneLayout,
    activePaneIds: activePaneIds.filter((id) => id !== childId),
    sizeByPaneId,
  })

  return true
}

function removeZookeeperFromNonRightPaneLayouts(
  rootLayout: Layout,
  rightSidebar: PaneLayout
) {
  const parent = findLayoutParentNode({
    rootLayout,
    targetNodeId: zookeeperPane.id,
  })

  if (
    !parent ||
    parent.id === rightSidebar.id ||
    parent.type !== LayoutType.Panes
  ) {
    return false
  }

  return removePaneChild(parent, zookeeperPane.id)
}

function addZookeeperToRightSidebar(rightSidebar: PaneLayout) {
  const { activePaneIds } = getActivePaneState(rightSidebar)
  rightSidebar.children.push(structuredClone(zookeeperPane))
  rightSidebar.activeIndices = rightSidebar.children
    .map((child, index) =>
      activePaneIds.includes(child.id) || child.id === zookeeperPane.id
        ? index
        : -1
    )
    .filter((index) => index >= 0)
  rightSidebar.sizes =
    rightSidebar.activeIndices.length > 0
      ? new Array(rightSidebar.activeIndices.length).fill(
          100 / rightSidebar.activeIndices.length
        )
      : []
}

function addRightSidebar(rootLayout: Layout): PaneLayout | undefined {
  if (rootLayout.type !== LayoutType.Splits) {
    return undefined
  }

  const splitLayout = rootLayout as SplitLayout
  const sidebar = createRightSidebar()
  splitLayout.sizes = appendSplitSize(
    splitLayout.sizes,
    splitLayout.children.length
  )
  splitLayout.children.push(sidebar)
  return sidebar
}

export function ensureZookeeperLayout(rootLayout: Layout) {
  const existingRightSidebar = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutToolbarID.Right,
  })

  if (existingRightSidebar && existingRightSidebar.type !== LayoutType.Panes) {
    return false
  }

  const rightSidebar = existingRightSidebar ?? addRightSidebar(rootLayout)
  if (!rightSidebar) {
    return false
  }
  const addedRightSidebar = !existingRightSidebar

  const movedFromAnotherPane = removeZookeeperFromNonRightPaneLayouts(
    rootLayout,
    rightSidebar
  )
  const alreadyInRightSidebar = rightSidebar.children.some(
    (child) => child.id === zookeeperPane.id
  )

  if (alreadyInRightSidebar) {
    return addedRightSidebar || movedFromAnotherPane
  }

  addZookeeperToRightSidebar(rightSidebar)
  return true
}

export function removeZookeeperLayout(rootLayout: Layout) {
  const rightSidebar = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutToolbarID.Right,
  })

  if (!rightSidebar || rightSidebar.type !== LayoutType.Panes) {
    return false
  }

  const removedZookeeper = removePaneChild(rightSidebar, zookeeperPane.id)
  if (!removedZookeeper) {
    return false
  }

  if (rightSidebar.children.length === 0) {
    removeSplitChild(rootLayout, rightSidebar.id)
  }

  return true
}
