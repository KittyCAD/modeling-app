import {
  AreaType,
  type Layout,
  LayoutType,
  type PaneChild,
} from '@src/lib/layout/types'

/** One model editor by default. The optional tree has no separate Bodies pane. */
export function applyFeatureCodeLayout(
  layout: Layout,
  separate: boolean
): Layout {
  const next = structuredClone(layout)
  function visit(node: Layout) {
    if (!('children' in node)) {
      return
    }
    if (
      node.type === LayoutType.Panes &&
      node.children.some((child) => child.id === 'code')
    ) {
      const hadTree = node.children.some((child) => child.id === 'feature-tree')
      const active = node.activeIndices.map((index, i) => ({
        id: node.children[index]?.id,
        size: node.sizes[i] ?? 0,
      }))
      node.children = node.children.filter(
        (child) => child.id !== 'feature-tree' && child.id !== 'inline-bodies'
      )
      const codeIndex = node.children.findIndex((child) => child.id === 'code')
      node.children[codeIndex].label = separate
        ? 'Code Editor'
        : 'Features & Code'
      if (separate) {
        const tree: PaneChild = {
          id: 'feature-tree',
          label: 'Feature Tree',
          icon: 'model',
          type: LayoutType.Simple,
          areaType: AreaType.FeatureTree,
        }
        node.children.splice(codeIndex, 0, tree)
        const code = active.find(
          ({ id }) => id === 'code' || id === 'inline-bodies'
        )
        if (!hadTree && code) {
          const half = code.size / 2
          code.id = 'code'
          code.size = half
          active.unshift({ id: 'feature-tree', size: half })
        }
      }
      const weights = new Map<string, number>()
      for (const pane of active) {
        const id =
          pane.id === 'inline-bodies' ||
          (!separate && pane.id === 'feature-tree')
            ? 'code'
            : pane.id
        if (id && node.children.some((child) => child.id === id)) {
          weights.set(id, (weights.get(id) ?? 0) + pane.size)
        }
      }
      node.activeIndices = Array.from(weights.keys()).map((id) =>
        node.children.findIndex((child) => child.id === id)
      )
      node.sizes = Array.from(weights.values())
    }
    node.children.forEach(visit)
  }
  visit(next)
  return next
}
