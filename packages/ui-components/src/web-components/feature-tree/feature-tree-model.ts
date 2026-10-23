/** Logical hierarchy independent of mounted rows, including collapsed descendants. */
export interface FeatureTreeNode {
  id: string
  parentId?: string
  label: string
  disabled?: boolean
}

/** Preorder metadata used by flat rows, keyboard navigation, and HUD connectors. */
export interface FeatureTreeEntry extends FeatureTreeNode {
  depth: number
  childIds: readonly string[]
  posInSet: number
  setSize: number
  lastSibling: boolean
  guides: readonly boolean[]
}

export function buildFeatureTreeModel(
  nodes: readonly FeatureTreeNode[],
  expandedIds: readonly string[]
): {
  entries: ReadonlyMap<string, FeatureTreeEntry>
  visible: readonly FeatureTreeEntry[]
} {
  const records = new Map<string, FeatureTreeNode>()
  const children = new Map<string | undefined, string[]>()
  for (const node of nodes) {
    if (node.id.trim().length === 0) {
      throw new TypeError('Feature tree node IDs must not be empty')
    }
    if (records.has(node.id)) {
      throw new TypeError(`Duplicate feature tree node ID: "${node.id}"`)
    }
    records.set(node.id, node)
    const siblings = children.get(node.parentId)
    if (siblings) siblings.push(node.id)
    else children.set(node.parentId, [node.id])
  }
  for (const node of nodes) {
    if (node.parentId !== undefined && !records.has(node.parentId)) {
      throw new TypeError(
        `Feature tree node "${node.id}" has missing parent "${node.parentId}"`
      )
    }
  }

  const expanded = new Set(expandedIds)
  const entries = new Map<string, FeatureTreeEntry>()
  const visible: FeatureTreeEntry[] = []
  const pending: {
    id: string
    parent?: FeatureTreeEntry
    visible: boolean
    position: number
    size: number
  }[] = []
  const roots = children.get(undefined) ?? []
  for (let index = roots.length - 1; index >= 0; index--) {
    pending.push({
      id: roots[index],
      visible: true,
      position: index + 1,
      size: roots.length,
    })
  }
  while (pending.length > 0) {
    const item = pending.pop()!
    const node = records.get(item.id)!
    const lastSibling = item.position === item.size
    const childIds = children.get(item.id) ?? []
    const entry: FeatureTreeEntry = {
      ...node,
      depth: item.parent ? item.parent.depth + 1 : 0,
      childIds,
      posInSet: item.position,
      setSize: item.size,
      lastSibling,
      guides: item.parent ? [...item.parent.guides, !lastSibling] : [],
    }
    entries.set(item.id, entry)
    if (item.visible) visible.push(entry)
    for (let index = childIds.length - 1; index >= 0; index--) {
      pending.push({
        id: childIds[index],
        parent: entry,
        visible: item.visible && expanded.has(item.id),
        position: index + 1,
        size: childIds.length,
      })
    }
  }

  // With exactly one parent per node, anything unreachable from a root belongs
  // to a cycle or descends from one. Reject the whole model instead of losing it.
  if (entries.size !== records.size) {
    let cycleNode = nodes.find((node) => !entries.has(node.id))!
    const ancestors = new Set<string>()
    while (!ancestors.has(cycleNode.id)) {
      ancestors.add(cycleNode.id)
      cycleNode = records.get(cycleNode.parentId!)!
    }
    throw new TypeError(
      `Feature tree contains a parent cycle involving "${cycleNode.id}"`
    )
  }
  return { entries, visible }
}
