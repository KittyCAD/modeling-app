import { ChangeSet, Text, type ChangeSpec } from '@codemirror/state'
import {
  parse,
  type ASTNode,
  type EdgeASTNode,
  type GraphASTNode,
  type LiteralASTNode,
  type NodeASTNode,
} from '@ts-graphviz/ast'
import { isErr } from '@src/lib/trap'

export interface Point {
  x: number
  y: number
}
export interface SourceRange {
  from: number
  to: number
}
/** Syntax and original identifier spellings used for small, lossless source edits. */
export interface DotDocument {
  graph: GraphASTNode
  nodes: Map<string, NodeASTNode>
  ids: Map<string, string>
  edges: EdgeASTNode[]
  positions: Map<string, Point>
}
// Parsed ASTs always carry locations; the library also types generated, locationless ASTs.
export const rangeOf = (node: ASTNode): SourceRange => ({
  from: node.location!.start.offset,
  to: node.location!.end.offset,
})

export function readDot(contents: string): DotDocument | Error {
  try {
    const ast = parse(contents)
    const graphs = ast.children.filter((node) => node.type === 'Graph')
    if (graphs.length !== 1) return new Error('Open one DOT graph per file.')
    const graph = graphs[0]
    const nodes = new Map<string, NodeASTNode>()
    const ids = new Map<string, string>()
    const edges: EdgeASTNode[] = []
    const authoredPositions = new Map<string, string>()
    const remember = (id: LiteralASTNode) =>
      ids.set(
        id.value,
        contents.slice(id.location!.start.offset, id.location!.end.offset)
      )
    const visit = (node: ASTNode) => {
      if (node.type === 'Node') {
        nodes.set(node.id.value, node)
        remember(node.id)
        const pos = node.children.findLast(
          (child) => child.type === 'Attribute' && child.key.value === 'pos'
        )
        if (pos?.type === 'Attribute')
          authoredPositions.set(node.id.value, pos.value.value)
      }
      if (node.type === 'NodeRef') remember(node.id)
      if (node.type === 'Edge') {
        edges.push(node)
        node.targets.forEach(visit)
      }
      node.children.forEach(visit)
    }
    visit(graph)
    const attributes = graph.children.flatMap((node) =>
      node.type === 'Attribute'
        ? [node]
        : node.type === 'AttributeList' && node.kind === 'Graph'
          ? node.children.filter((child) => child.type === 'Attribute')
          : []
    )
    const inputscale = Number(
      attributes.findLast((attr) => attr.key.value === 'inputscale')?.value
        .value ?? 1
    )
    const scale = inputscale > 0 ? 72 / inputscale : 72
    const positions = new Map<string, Point>()
    // DOT inputs use inches by default; this view stores persisted coordinates in points.
    for (const [name, value] of authoredPositions) {
      const parts = value.replace(/!$/, '').split(',').map(Number)
      if (parts.length === 2 && parts.every(Number.isFinite))
        positions.set(name, { x: parts[0] * scale, y: -parts[1] * scale })
    }
    return { graph, nodes, ids, edges, positions }
  } catch (cause) {
    return isErr(cause) ? cause : new Error('Unable to parse DOT', { cause })
  }
}

export function insertStatement(
  contents: string,
  document: DotDocument,
  statement: string
): { from: number; insert: string } {
  return {
    from: document.graph.location!.end.offset - 1,
    insert: `\n  ${statement}\n`,
  }
}

/** Commit all displayed positions together, so automatic layout cannot move the other nodes. */
export function positionChanges(
  contents: string,
  document: DotDocument,
  positions: ReadonlyMap<string, Point>
): ChangeSpec[] {
  const changes: ChangeSpec[] = []
  const appended: string[] = []
  for (const [name, point] of positions) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const pos = `"${Number(point.x.toFixed(3))},${Number((-point.y).toFixed(3))}!"`
    const node = document.nodes.get(name)
    const existing = node?.children.findLast(
      (child) => child.type === 'Attribute' && child.key.value === 'pos'
    )
    if (existing?.type === 'Attribute')
      changes.push({ ...rangeOf(existing.value), insert: pos })
    else if (node) {
      const lastAttribute = node.children.findLast(
        (child) => child.type === 'Attribute'
      )
      const end = node.location!.end.offset
      const beforeTerminator = contents[end - 1] === ';' ? end - 1 : end
      const closingList = contents
        .slice(node.id.location!.end.offset, beforeTerminator)
        .trimEnd()
        .endsWith(']')
      changes.push({
        from: lastAttribute
          ? lastAttribute.location!.end.offset
          : closingList
            ? contents.lastIndexOf(']', beforeTerminator - 1)
            : beforeTerminator,
        insert: lastAttribute
          ? `, pos=${pos}, pin=true`
          : closingList
            ? `pos=${pos}, pin=true`
            : ` [pos=${pos}, pin=true]`,
      })
    } else appended.push(`${document.ids.get(name)} [pos=${pos}, pin=true];`)
  }
  const attributes = document.graph.children.flatMap((node) =>
    node.type === 'Attribute'
      ? [node]
      : node.type === 'AttributeList' && node.kind === 'Graph'
        ? node.children.filter((child) => child.type === 'Attribute')
        : []
  )
  for (const [key, value] of [
    ['inputscale', '72'],
    ['notranslate', 'true'],
  ]) {
    const existing = attributes.findLast((attr) => attr.key.value === key)
    if (existing) changes.push({ ...rangeOf(existing.value), insert: value })
    else appended.push(`graph [${key}=${value}];`)
  }
  if (appended.length)
    changes.push(insertStatement(contents, document, appended.join('\n  ')))
  return changes
}

/** Check the edited document before dispatch; callers also reject gestures on stale snapshots. */
export function checkedChanges(
  contents: string,
  changes: ChangeSpec[]
): ChangeSpec[] | Error {
  const result = ChangeSet.of(changes, contents.length)
    .apply(Text.of(contents.split('\n')))
    .toString()
  const document = readDot(result)
  return isErr(document) ? document : changes
}
