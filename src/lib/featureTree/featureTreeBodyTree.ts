import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import {
  isOperationTreeBranch,
  type OperationTreeNode,
} from '@src/lib/featureTree/featureTreeOperationTree'
import { isArray } from '@src/lib/utils'

export type BodyArtifact = Extract<
  Artifact,
  { type: 'sweep' | 'compositeSolid' | 'pattern' }
>
export type BodyOperationTreeBranch = {
  id: string
  expansionKey: string
  artifact: BodyArtifact
  index: number
  ownerModuleId: number
  operations: OperationTreeNode[]
}
export type BodyTreeNode =
  | Operation
  | Operation[]
  | {
      parent: Extract<Operation, { type: 'ModuleInstance' }>
      children: BodyTreeNode[]
    }
  | { body: BodyOperationTreeBranch; children: BodyTreeNode[] }

export function getBodyTreeNodeKey(node: BodyTreeNode, _index: number): string {
  if (!isArray(node) && 'body' in node) return `body-${node.body.expansionKey}`
  const op = isArray(node) ? node[0] : 'parent' in node ? node.parent : node
  if (!op || !('nodePath' in op)) return 'empty'
  return JSON.stringify([op.type, 'name' in op ? op.name : '', op.nodePath])
}

export function buildBodyOperationTree(
  nodes: OperationTreeNode[],
  bodies: Map<string, BodyArtifact>,
  graph: ArtifactGraph
) {
  const operations: Operation[] = []
  const imports = new Map<string, number>()
  const modulePaths = new Map<number, number[]>()
  function index(items: OperationTreeNode[], path: number[] = []) {
    for (const node of items) {
      if (isOperationTreeBranch(node)) {
        imports.set(node.parent.sourceRange.join(), node.parent.moduleId)
        const next = [...path, node.parent.moduleId]
        modulePaths.set(node.parent.moduleId, next)
        index(node.children, next)
      } else operations.push(...(isArray(node) ? node : [node]))
    }
  }
  index(nodes)
  const offsetPlaneRanges = new Set(
    operations.flatMap((op) =>
      op.type === 'StdLibCall' && op.name === 'offsetPlane'
        ? [op.sourceRange.join()]
        : []
    )
  )
  const order = new Map(operations.map((op, i) => [op, i]))
  const sourceOrder = new Map(
    operations.flatMap((op, i) =>
      'sourceRange' in op ? [[op.sourceRange.join(), i] as const] : []
    )
  )
  function definition(artifact: Artifact) {
    return 'codeRef' in artifact && artifact.codeRef
      ? (artifact.codeRef.definitionRange ?? artifact.codeRef.range)
      : undefined
  }
  const producingRanges = new Set(
    [...graph.values()].flatMap((a) =>
      (a.type === 'sweep' ||
        a.type === 'compositeSolid' ||
        a.type === 'pattern' ||
        a.type === 'importedGeometry') &&
      definition(a)
        ? [definition(a)?.join()]
        : []
    )
  )
  const patterns = [...graph.values()].filter((a) => a.type === 'pattern')
  const copySources = new Map(
    patterns.flatMap((p) => p.copyIds.map((id) => [id, p] as const))
  )
  function patternSource(id: string, seen = new Set<string>()): string {
    if (seen.has(id)) return id
    seen.add(id)
    const a = graph.get(id)
    const pattern =
      copySources.get(id) ?? (a?.type === 'pattern' ? a : undefined)
    if (pattern) {
      const source = patternSource(pattern.sourceId, seen)
      if (
        graph.get(source)?.type === 'sweep' ||
        graph.get(source)?.type === 'compositeSolid'
      )
        return source
      return (
        [...graph.values()].find(
          (body) =>
            (body.type === 'sweep' || body.type === 'compositeSolid') &&
            body.patternIds?.includes(pattern.id)
        )?.id ?? source
      )
    }
    return a?.type === 'path' && a.sweepId ? patternSource(a.sweepId, seen) : id
  }
  const grouped = new Map<string, BodyArtifact>()
  for (const [id, artifact] of bodies) {
    if (artifact.type !== 'pattern' && !copySources.has(id)) {
      grouped.set(id, artifact)
      continue
    }
    const sourceId = patternSource(
      artifact.type === 'pattern' ? artifact.id : id
    )
    const source = graph.get(sourceId)
    grouped.set(
      sourceId,
      source?.type === 'sweep' || source?.type === 'compositeSolid'
        ? source
        : artifact
    )
  }

  const assigned = new Set<OperationTreeNode>()
  const branches = [...grouped].map(
    ([id, artifact], index): BodyOperationTreeBranch => {
      const bodyPatterns = patterns.filter((p) => patternSource(p.id) === id)
      const ancestors = new Map<string, Artifact>()
      const before = new Map<string, number>()
      const pending = [artifact, ...bodyPatterns].map((a) => ({
        id: a.id,
        until: Infinity,
      }))
      while (pending.length) {
        const entry = pending.pop()
        if (!entry || (before.get(entry.id) ?? -1) >= entry.until) continue
        const a = graph.get(entry.id)
        if (!a) continue
        ancestors.set(a.id, a)
        before.set(a.id, entry.until)
        const until = Math.min(
          entry.until,
          sourceOrder.get(definition(a)?.join() ?? '') ?? Infinity
        )
        pending.push(...sourceIds(a, graph).map((id) => ({ id, until })))
        if (a.type === 'path') {
          const plane = graph.get(a.planeId)
          if (
            plane?.type === 'plane' &&
            offsetPlaneRanges.has(definition(plane)?.join() ?? '')
          )
            pending.push({ id: plane.id, until })
        }
      }
      before.set(id, Infinity)
      for (const p of bodyPatterns) {
        before.set(p.id, Infinity)
        for (const copy of p.copyIds) before.set(copy, Infinity)
      }
      const ranges = [...ancestors.values()].flatMap((a) => {
        const range = definition(a)
        return range ? [range] : []
      })
      function matches(op: Operation): boolean {
        if (!('sourceRange' in op) || op.type === 'ModuleInstance') return false
        const range = op.sourceRange
        if (
          ranges.some(
            (r) => r[2] === range[2] && r[0] >= range[0] && r[1] <= range[1]
          )
        )
          return true
        if (op.type !== 'StdLibCall' || producingRanges.has(range.join()))
          return false
        return [op.unlabeledArg, ...Object.values(op.labeledArgs)].some(
          (arg) =>
            arg &&
            referencesBefore(arg.value, before, order.get(op) ?? Infinity)
        )
      }
      function select(items: OperationTreeNode[]): OperationTreeNode[] {
        return items.flatMap((node): OperationTreeNode[] => {
          if (isOperationTreeBranch(node)) {
            const children = select(node.children)
            return children.length ? [{ ...node, children }] : []
          }
          if (!(isArray(node) ? node.some(matches) : matches(node))) return []
          assigned.add(node)
          return [node]
        })
      }
      const range = definition(artifact)
      const moduleId =
        artifact.codeRef.definitionRange?.[2] ??
        imports.get(artifact.codeRef.range.join()) ??
        range?.[2] ??
        0
      const creation = operations.find(
        (op) => 'sourceRange' in op && op.sourceRange.join() === range?.join()
      )
      const path =
        artifact.type === 'sweep' && artifact.pathId
          ? graph.get(artifact.pathId)
          : undefined
      const expansionKey = JSON.stringify([
        moduleId,
        creation && 'nodePath' in creation
          ? creation.nodePath
          : artifact.codeRef.nodePath,
        artifact.type === 'compositeSolid'
          ? artifact.outputIndex
          : path && 'codeRef' in path
            ? path.codeRef?.nodePath
            : undefined,
      ])
      return {
        id,
        artifact,
        index,
        expansionKey,
        ownerModuleId: modulePaths.has(moduleId) ? moduleId : 0,
        operations: select(nodes),
      }
    }
  )
  // Ambiguous outputs must never inherit another body's deliberate choice.
  const counts = new Map<string, number>()
  for (const b of branches)
    counts.set(b.expansionKey, (counts.get(b.expansionKey) ?? 0) + 1)
  for (const b of branches)
    if ((counts.get(b.expansionKey) ?? 0) > 1) b.expansionKey += `/${b.id}`

  function remaining(items: OperationTreeNode[]): OperationTreeNode[] {
    return items.flatMap((node): OperationTreeNode[] => {
      if (isOperationTreeBranch(node))
        return [{ ...node, children: remaining(node.children) }]
      return assigned.has(node) ? [] : [node]
    })
  }
  function unwrap(items: OperationTreeNode[]): OperationTreeNode[] {
    return items.flatMap((node): OperationTreeNode[] =>
      isOperationTreeBranch(node) ? unwrap(node.children) : [node]
    )
  }
  function assemble(
    items: OperationTreeNode[],
    moduleId: number
  ): BodyTreeNode[] {
    const result = items.flatMap((node): BodyTreeNode[] => {
      if (isOperationTreeBranch(node))
        return [
          {
            parent: node.parent,
            children: assemble(node.children, node.parent.moduleId),
          },
        ]
      return assigned.has(node) ? [] : [node]
    })
    for (const body of branches.filter((b) => b.ownerModuleId === moduleId)) {
      result.push({
        body,
        children: unwrap(body.operations),
      })
    }
    return result
  }
  return { branches, operations: remaining(nodes), nodes: assemble(nodes, 0) }
}

function referencesBefore(
  value: OpKclValue,
  before: Map<string, number>,
  index: number
): boolean {
  if (value.type === 'Solid' || value.type === 'Sketch')
    return index < (before.get(value.value.artifactId) ?? -1)
  if (value.type === 'ImportedGeometry')
    return index < (before.get(value.artifact_id) ?? -1)
  if (value.type === 'Array')
    return value.value.some((v) => referencesBefore(v, before, index))
  if (value.type === 'Object')
    return Object.values(value.value).some((v) =>
      referencesBefore(v, before, index)
    )
  return false
}

function sourceIds(a: Artifact, graph: ArtifactGraph): string[] {
  if (a.type === 'sweep')
    return [a.pathId, a.trajectoryId, a.sourceSweepId].filter(
      (id): id is string => !!id
    )
  if (a.type === 'compositeSolid' || a.type === 'pattern') {
    const inputs =
      a.type === 'pattern' ? [a.sourceId] : [...a.solidIds, ...a.toolIds]
    return inputs.flatMap((id) => {
      const input = graph.get(id)
      return input?.type === 'path' && input.sweepId
        ? [id, input.sweepId]
        : [id]
    })
  }
  if (a.type === 'path')
    return [a.sketchBlockId, a.originPathId, a.innerPathId].filter(
      (id): id is string => !!id
    )
  return []
}
