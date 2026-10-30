import { featureTreePaneConfig } from '@src/lib/layout/configs/default'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'

/** Keep Bodies available while the operation tree moves into the code editor. */
export function applyFeatureCodeLayout(
  layout: Layout,
  separate: boolean
): Layout {
  const next = structuredClone(layout)
  function visit(node: Layout) {
    if (!('children' in node)) {
      return
    }
    if (node.type === LayoutType.Panes) {
      const codeIndex = node.children.findIndex((child) => child.id === 'code')
      const treeIndex = node.children.findIndex(
        (child) => child.id === 'feature-tree' || child.id === 'inline-bodies'
      )
      if (codeIndex >= 0 && treeIndex >= 0) {
        const wasTree = node.children[treeIndex].id === 'feature-tree'
        const hadTree = node.activeIndices.includes(treeIndex)
        const hadCode = node.activeIndices.includes(codeIndex)
        const activeBefore = node.activeIndices.join(',')
        node.children[treeIndex] = separate
          ? wasTree
            ? node.children[treeIndex]
            : structuredClone(featureTreePaneConfig)
          : {
              id: 'inline-bodies',
              label: 'Bodies',
              icon: 'model',
              type: LayoutType.Simple,
              areaType: AreaType.Bodies,
            }
        node.children[codeIndex].label = separate
          ? 'Code Editor'
          : 'Features & Code'
        if (separate && !wasTree && (hadCode || hadTree)) {
          node.activeIndices = [
            treeIndex,
            codeIndex,
            ...node.activeIndices.filter(
              (index) => index !== treeIndex && index !== codeIndex
            ),
          ]
        } else if (!separate && wasTree && hadTree) {
          node.activeIndices = [
            ...new Set(
              node.activeIndices.map((index) =>
                index === treeIndex ? codeIndex : index
              )
            ),
          ]
        }
        if (node.activeIndices.join(',') !== activeBefore) {
          node.sizes = node.activeIndices.map(
            () => 100 / node.activeIndices.length
          )
        }
      }
    }
    node.children.forEach(visit)
  }
  visit(next)
  return next
}
