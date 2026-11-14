import type { ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'

/** A semantic tool category has stable identity independently of inline, split-button, or submenu presentation. */
export interface ToolbarGroupDefinition {
  id: string
  title: string
  parentId?: string
  order?: number
  collapsePriority?: number
  defaultToolId?: string
}
export interface ToolbarGroup
  extends Omit<ToolbarGroupDefinition, 'parentId' | 'order'> {
  children: readonly ToolbarNode[]
}
export type ToolbarNode = ToolbarViewItem | ToolbarGroup
export type ToolbarProjection =
  | ToolbarViewItem
  | { group: ToolbarGroup; selected: ToolbarViewItem }
  | 'break'
export const isToolbarGroup = (node: ToolbarNode): node is ToolbarGroup =>
  'children' in node
export function toolbarLeaves(
  nodes: readonly ToolbarNode[]
): ToolbarViewItem[] {
  return nodes.flatMap((node) =>
    isToolbarGroup(node) ? toolbarLeaves(node.children) : [node]
  )
}

export function groupToolbarItems(
  items: readonly ToolbarViewItem[],
  definitions: readonly ToolbarGroupDefinition[]
): ToolbarNode[] | Error {
  const groups = new Map(definitions.map((group) => [group.id, group]))
  if (groups.size !== definitions.length)
    return new Error('Toolbar group IDs must be unique')
  const ids = new Set(items.map((item) => item.id))
  if (ids.size !== items.length || items.some((item) => groups.has(item.id)))
    return new Error('Toolbar tool and group IDs must be unique')
  for (const group of definitions) {
    const visited = new Set([group.id])
    let parent = group.parentId
    while (parent) {
      if (visited.has(parent))
        return new Error('Toolbar groups cannot contain a cycle')
      visited.add(parent)
      const next = groups.get(parent)
      if (!next) return new Error(`Unknown toolbar group: ${parent}`)
      parent = next.parentId
    }
  }
  if (items.some((item) => item.groupId && !groups.has(item.groupId)))
    return new Error('A toolbar tool references an unknown group')
  const build = (parentId?: string): ToolbarNode[] => {
    const children: ToolbarNode[] = items.filter(
      (item) => item.groupId === parentId
    )
    for (const group of [...definitions]
      .filter((group) => group.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const nested = build(group.id)
      if (nested.length) children.push({ ...group, children: nested })
    }
    return children
  }
  return build()
}
export function representative(
  group: ToolbarGroup,
  recent: ReadonlyMap<string, string>
): ToolbarViewItem | undefined {
  const leaves = toolbarLeaves(group.children)
  return (
    leaves.find(
      (item) => item.id === (recent.get(group.id) ?? group.defaultToolId)
    ) ??
    leaves.find(
      (item) =>
        !item.disabled && ['available', 'experimental'].includes(item.status)
    ) ??
    leaves[0]
  )
}
export function projectToolbar(
  nodes: readonly ToolbarNode[],
  collapsed: ReadonlySet<string>,
  recent: ReadonlyMap<string, string>
): ToolbarProjection[] {
  const result: ToolbarProjection[] = []
  const append = (entry: ToolbarProjection) => {
    if (entry !== 'break' || (result.length && result.at(-1) !== 'break'))
      result.push(entry)
  }
  const visit = (nodes: readonly ToolbarNode[]) => {
    for (const node of nodes) {
      if (!isToolbarGroup(node)) append(node)
      else if (collapsed.has(node.id)) {
        const selected = representative(node, recent)
        if (selected) append({ group: node, selected })
      } else if (toolbarLeaves(node.children).length) {
        append('break')
        visit(node.children)
        append('break')
      }
    }
  }
  visit(nodes)
  if (result.at(-1) === 'break') result.pop()
  return result
}
export function toolbarGroups(nodes: readonly ToolbarNode[]): ToolbarGroup[] {
  return nodes.flatMap((node) =>
    isToolbarGroup(node) ? [node, ...toolbarGroups(node.children)] : []
  )
}

/** Recompute from the semantic tree and measured controls; layout history cannot cause resize oscillation. */
export function fitToolbar(
  nodes: readonly ToolbarNode[],
  available: number,
  widths: ReadonlyMap<string, number>,
  recent: ReadonlyMap<string, string>,
  gap: number,
  chrome: number
): ReadonlySet<string> {
  const candidates: { group: ToolbarGroup; depth: number; index: number }[] = []
  const visit = (nodes: readonly ToolbarNode[], depth: number) => {
    for (const node of nodes)
      if (isToolbarGroup(node)) {
        candidates.push({ group: node, depth, index: candidates.length })
        visit(node.children, depth + 1)
      }
  }
  visit(nodes, 0)
  candidates.sort(
    (a, b) =>
      b.depth - a.depth ||
      (b.group.collapsePriority ?? 0) - (a.group.collapsePriority ?? 0) ||
      a.index - b.index
  )
  const cost = (collapsed: ReadonlySet<string>) => {
    const entries = projectToolbar(nodes, collapsed, recent)
    return (
      chrome +
      Math.max(0, entries.length - 1) * gap +
      entries.reduce(
        (sum, entry) =>
          sum +
          (entry === 'break'
            ? 1
            : (widths.get(
                'group' in entry
                  ? `group:${entry.group.id}`
                  : `tool:${entry.id}`
              ) ?? 0)),
        0
      )
    )
  }
  const collapsed = new Set<string>()
  for (const { group } of candidates) {
    if (cost(collapsed) <= available) break
    const proposed = new Set([...collapsed, group.id])
    if (cost(proposed) < cost(collapsed)) collapsed.add(group.id)
  }
  return collapsed
}
