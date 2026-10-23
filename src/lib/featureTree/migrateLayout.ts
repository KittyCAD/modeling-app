import { parseLayoutInner } from '@src/lib/layout/parse'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'

/** Move operation history and bodies to scene sections, preserving unrelated saved panes. */
export function migrateFeatureTreeLayout(layout: Layout): Layout {
  function visit(node: Layout): Layout | undefined {
    if (node.type === LayoutType.Simple)
      return node.areaType === AreaType.FeatureTree ||
        node.areaType === AreaType.Bodies
        ? undefined
        : node
    if (node.type === LayoutType.Splits) {
      const surviving = node.children
        .map((child, index) => ({
          child: visit(child),
          size: node.sizes[index] ?? 1,
        }))
        .filter(
          (entry): entry is { child: Layout; size: number } =>
            entry.child !== undefined
        )
      const children = surviving.map(({ child }) => child)
      if (!children.length) return undefined
      if (children.length === 1 && node.children.length > 1) return children[0]
      if (children.length === node.children.length) return { ...node, children }
      const total = surviving.reduce((sum, { size }) => sum + size, 0)
      return {
        ...node,
        children,
        sizes: surviving.map(({ size }) =>
          total ? (size / total) * 100 : 100 / children.length
        ),
      }
    }
    const mapped = node.children.map((child) => {
      const result = visit(child)
      return result ? { ...result, icon: child.icon } : undefined
    })
    const kept = mapped
      .map((child, index) => (child ? index : -1))
      .filter((index) => index >= 0)
    const children = kept.map((index) => mapped[index]!)
    if (!children.length && node.children.length) return undefined
    const active = node.activeIndices
      .map((index, position) => ({
        index: kept.indexOf(index),
        size: node.sizes[position] ?? 1,
      }))
      .filter((item) => item.index >= 0)
    const total = active.reduce((sum, item) => sum + item.size, 0)
    return {
      ...node,
      children,
      activeIndices: active.map((item) => item.index),
      sizes: active.map((item) =>
        total ? (item.size / total) * 100 : 100 / active.length
      ),
    }
  }
  return (
    visit(layout) ?? {
      id: layout.id,
      label: 'Scene',
      type: LayoutType.Simple,
      areaType: AreaType.ModelingScene,
    }
  )
}

/** The rollout keeps the previous pane layout in saved configuration for safe revocation. */
export function resolveSceneBrowserLayout(
  layout: Layout,
  enabled: boolean
): Layout & { sceneBrowserFallback?: Layout } {
  const parsedFallback =
    'sceneBrowserFallback' in layout
      ? parseLayoutInner(layout.sceneBrowserFallback)
      : undefined
  const fallback = parsedFallback instanceof Error ? undefined : parsedFallback
  if (!enabled) return fallback ?? layout
  return {
    ...migrateFeatureTreeLayout(layout),
    sceneBrowserFallback: fallback ?? structuredClone(layout),
  }
}
