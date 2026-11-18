import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  getOperationTreeNodeKey,
  isOperationTreeBranch,
  type OperationTreeNode,
} from '@src/lib/featureTree/featureTreeOperationTree'
import { incrementMapCounter, isArray } from '@src/lib/utils'

export type BodyArtifact = Extract<
  Artifact,
  { type: 'sweep' | 'compositeSolid' | 'pattern' }
>
export type BodyOperationTreeBranch = {
  id: string
  artifact: BodyArtifact
  index: number
  expansionKey: string
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

export function getFeatureKey(operation: Operation): string {
  return JSON.stringify([
    operation.type,
    'sourceRange' in operation ? operation.sourceRange[2] : 0,
    'nodePath' in operation ? operation.nodePath : null,
    'name' in operation ? operation.name : null,
  ])
}

export function getBodyTreeNodeKey(node: BodyTreeNode): string {
  if (isArray(node)) return `group-${getFeatureKey(node[0])}`
  if ('body' in node) return node.body.expansionKey
  return getFeatureKey('parent' in node ? node.parent : node)
}

export function getBodyTreeNodeRenderKey(
  node: BodyTreeNode,
  siblingIndex: number
): string {
  if (!isArray(node) && 'body' in node) return node.body.expansionKey
  // Live operations have placeholder paths but still need unique sibling keys.
  return getOperationTreeNodeKey(
    !isArray(node) && 'parent' in node ? node.parent : node,
    siblingIndex
  )
}

function definitionRange(artifact: Artifact): SourceRange | undefined {
  return 'codeRef' in artifact && artifact.codeRef
    ? (artifact.codeRef.definitionRange ?? artifact.codeRef.range)
    : undefined
}

function valueIds(value: OpKclValue): string[] {
  if (
    value.type === 'Solid' ||
    value.type === 'Sketch' ||
    value.type === 'Helix'
  )
    return [value.value.artifactId]
  if (value.type === 'Array') return value.value.flatMap(valueIds)
  if (value.type === 'Object')
    return Object.values(value.value).flatMap(valueIds)
  return 'artifact_id' in value && value.artifact_id ? [value.artifact_id] : []
}

function inputIds(operation: Operation): string[] {
  if (operation.type !== 'StdLibCall') return []
  return [
    operation.unlabeledArg,
    ...Object.values(operation.labeledArgs),
  ].flatMap((arg) => (arg ? valueIds(arg.value) : []))
}

/** Project the operation tree onto live bodies without changing operation objects. */
export function buildBodyOperationTree(
  nodes: OperationTreeNode[],
  bodies: Map<string, BodyArtifact>,
  graph: ArtifactGraph,
  identityNodes: OperationTreeNode[] = nodes
) {
  const operations: Operation[] = []
  const modules = new Set([0])
  const importOwners = new Map<string, number>()
  function index(items: OperationTreeNode[], collected = operations) {
    for (const node of items) {
      if (isOperationTreeBranch(node)) {
        modules.add(node.parent.moduleId)
        importOwners.set(
          node.parent.sourceRange.join(','),
          node.parent.moduleId
        )
        index(node.children, collected)
      } else collected.push(...(isArray(node) ? node : [node]))
    }
  }
  index(nodes)
  const identityOperations = identityNodes === nodes ? operations : []
  if (identityNodes !== nodes) index(identityNodes, identityOperations)
  const identityAtRange = new Map(
    identityOperations.flatMap((operation) =>
      'sourceRange' in operation
        ? [[operation.sourceRange.join(','), operation] as const]
        : []
    )
  )
  const identityProducer = (artifact: Artifact) => {
    const range = definitionRange(artifact)
    return range ? identityAtRange.get(range.join(',')) : undefined
  }
  const order = new Map(
    operations.map((operation, index) => [operation, index])
  )
  const atRange = new Map<string, Operation>()
  for (const operation of operations) {
    if (!('sourceRange' in operation)) continue
    const key = operation.sourceRange.join(',')
    if (!atRange.has(key)) atRange.set(key, operation)
  }
  const producer = (artifact: Artifact) => {
    const range = definitionRange(artifact)
    return range ? atRange.get(range.join(',')) : undefined
  }
  const producingOperations = new Set(
    [...graph.values()]
      .filter(
        (a) =>
          a.type === 'sweep' ||
          a.type === 'compositeSolid' ||
          a.type === 'pattern' ||
          a.type === 'path'
      )
      .map(producer)
  )

  const patternByCopy = new Map<
    string,
    Extract<Artifact, { type: 'pattern' }>
  >()
  const patternSources = new Map<string, string>()
  const profileMembers = new Map<string, string[]>()
  for (const artifact of graph.values()) {
    if (
      (artifact.type === 'sweep' || artifact.type === 'segment') &&
      artifact.pathId
    ) {
      const members = profileMembers.get(artifact.pathId) ?? []
      members.push(artifact.id)
      profileMembers.set(artifact.pathId, members)
    }
    if (artifact.type === 'pattern') {
      for (const id of artifact.copyIds) patternByCopy.set(id, artifact)
    } else if (
      artifact.type === 'sweep' ||
      artifact.type === 'compositeSolid'
    ) {
      for (const id of artifact.patternIds ?? [])
        patternSources.set(id, artifact.id)
    }
  }
  function sourceBody(id: string, seen = new Set<string>()): string {
    if (seen.has(id)) return id
    seen.add(id)
    const artifact = graph.get(id)
    const pattern =
      patternByCopy.get(id) ??
      (artifact?.type === 'pattern' ? artifact : undefined)
    if (pattern)
      return sourceBody(
        patternSources.get(pattern.id) ?? pattern.sourceId,
        seen
      )
    if (artifact?.type === 'path' && artifact.sweepId)
      return sourceBody(artifact.sweepId, seen)
    if (
      artifact?.type === 'compositeSolid' &&
      artifact.solidIds.length > 0 &&
      artifact.solidIds.every((input) => patternByCopy.has(input))
    ) {
      const sources = new Set(
        artifact.solidIds.map((input) => sourceBody(input, new Set(seen)))
      )
      if (sources.size === 1) return [...sources][0]
    }
    return id
  }
  const live = new Map<string, BodyArtifact>()
  for (const [id, artifact] of bodies) {
    const sourceId = sourceBody(artifact.type === 'pattern' ? artifact.id : id)
    const source = graph.get(sourceId)
    live.set(
      sourceId,
      source?.type === 'sweep' || source?.type === 'compositeSolid'
        ? source
        : artifact
    )
  }

  function dependencies(artifact: Artifact): string[] {
    if (artifact.type === 'sweep')
      return [
        artifact.pathId,
        artifact.trajectoryId,
        artifact.sourceSweepId,
      ].filter((id): id is string => !!id)
    if (artifact.type === 'path')
      return [
        artifact.planeId,
        artifact.sketchBlockId,
        artifact.originPathId,
        artifact.innerPathId,
      ].filter((id): id is string => !!id)
    if (artifact.type === 'sketchBlock')
      return artifact.planeId ? [artifact.planeId] : []
    if (artifact.type === 'segment')
      return [artifact.originalSegId ?? artifact.pathId]
    if (artifact.type === 'compositeSolid')
      // Boolean inputs can be engine profile IDs. Only follow sweepId here,
      // never while walking a shared sketch's dependencies.
      return [...artifact.solidIds, ...artifact.toolIds].flatMap((id) => {
        const input = graph.get(id)
        return input?.type === 'path' && input.sweepId
          ? [id, input.sweepId]
          : // Boolean outputs can replace their input path at the same ID.
            // Its segments retain the region code reference and original sketch.
            [id, ...(profileMembers.get(id) ?? [])]
      })
    if (artifact.type === 'pattern') return [sourceBody(artifact.id)]
    return []
  }

  const assigned = new Set<OperationTreeNode>()
  const branches = Array.from(
    live,
    ([id, artifact], index): BodyOperationTreeBranch => {
      // Each ancestor has a cutoff: clones inherit earlier edits, not later ones.
      const before = new Map<string, number>()
      const pending = [{ id: artifact.id, limit: Infinity }]
      for (const [resultId, result] of bodies) {
        if (
          result.type !== 'pattern' &&
          resultId !== id &&
          sourceBody(resultId) === id
        ) {
          pending.push({ id: resultId, limit: Infinity })
        }
      }
      for (const pattern of graph.values()) {
        if (pattern.type !== 'pattern' || sourceBody(pattern.id) !== id)
          continue
        pending.push({ id: pattern.id, limit: Infinity })
        for (const copy of pattern.copyIds) before.set(copy, Infinity)
      }
      while (pending.length) {
        const next = pending.pop()
        if (!next || (before.get(next.id) ?? -1) >= next.limit) continue
        before.set(next.id, next.limit)
        const source = graph.get(next.id)
        if (!source) continue
        const operation = producer(source)
        const limit = Math.min(
          next.limit,
          operation ? (order.get(operation) ?? Infinity) : Infinity
        )
        const inputs = dependencies(source)
        // Loft/blend profiles and sweep trajectories are also recorded in args.
        if (operation && source.type === 'sweep')
          inputs.push(...inputIds(operation))
        for (const input of inputs) pending.push({ id: input, limit })
      }
      before.set(id, Infinity)
      const ranges = [...before.keys()].flatMap((id) => {
        const source = graph.get(id)
        const range = source && definitionRange(source)
        return range ? [range] : []
      })
      const matches = (operation: Operation): boolean => {
        if (
          !('sourceRange' in operation) ||
          operation.type === 'ModuleInstance'
        )
          return false
        const range = operation.sourceRange
        if (
          ranges.some(
            (source) =>
              source[2] === range[2] &&
              source[0] >= range[0] &&
              source[1] <= range[1]
          )
        )
          return true
        if (operation.type !== 'StdLibCall') return false
        // Producing calls belong to their output. In-place edits belong to inputs.
        if (producingOperations.has(operation)) return false
        return inputIds(operation).some(
          (input) =>
            (order.get(operation) ?? Infinity) < (before.get(input) ?? -1)
        )
      }
      function history(items: OperationTreeNode[]): OperationTreeNode[] {
        return items.flatMap((node): OperationTreeNode[] => {
          if (isOperationTreeBranch(node)) return history(node.children)
          if (!(isArray(node) ? node.some(matches) : matches(node))) return []
          assigned.add(node)
          return [node]
        })
      }
      const range = definitionRange(artifact)
      const owner =
        artifact.codeRef.definitionRange?.[2] ??
        importOwners.get(artifact.codeRef.range.join(',')) ??
        range?.[2] ??
        0
      // Live operations can be incomplete or shifted while this graph is still old.
      const creation = identityProducer(artifact)
      // Include the specific input profile and output slot for multi-body calls.
      // These are source identities, independent of graph order and engine UUIDs.
      const profile =
        artifact.type === 'sweep' && artifact.pathId
          ? graph.get(artifact.pathId)
          : undefined
      const profileOperation = profile && identityProducer(profile)
      const expansionKey = JSON.stringify([
        owner,
        creation ? getFeatureKey(creation) : artifact.codeRef.nodePath,
        profileOperation ? getFeatureKey(profileOperation) : null,
        artifact.type === 'compositeSolid' ? artifact.outputIndex : null,
      ])
      return {
        id,
        artifact,
        index,
        expansionKey,
        ownerModuleId: modules.has(owner) ? owner : 0,
        operations: history(nodes),
      }
    }
  )
  // Never attach a remembered choice to an indistinguishable sibling.
  const keyCounts = new Map<string, number>()
  for (const body of branches) incrementMapCounter(keyCounts, body.expansionKey)
  for (const body of branches)
    if ((keyCounts.get(body.expansionKey) ?? 0) > 1)
      body.expansionKey += body.id

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
    return [
      ...result,
      ...branches
        .filter((body) => body.ownerModuleId === moduleId)
        .map((body) => ({ body, children: body.operations })),
    ]
  }
  return { branches, nodes: assemble(nodes, 0) }
}
