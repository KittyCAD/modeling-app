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

export function buildBodyOperationTree(
  nodes: OperationTreeNode[],
  bodies: Map<string, BodyArtifact>,
  graph: ArtifactGraph
) {
  const operationOrder = new Map<Operation, number>()
  const sourceOrder = new Map<string, number>()
  function indexOperations(items: OperationTreeNode[]) {
    for (const node of items) {
      if (isOperationTreeBranch(node)) {
        indexOperations(node.children)
      } else {
        for (const operation of isArray(node) ? node : [node]) {
          const index = operationOrder.size
          operationOrder.set(operation, index)
          if ('sourceRange' in operation) {
            sourceOrder.set(operation.sourceRange.join('-'), index)
          }
        }
      }
    }
  }
  indexOperations(nodes)
  const producingRanges = new Set(
    Array.from(graph.values())
      .filter(
        (artifact) =>
          artifact.type === 'sweep' ||
          artifact.type === 'compositeSolid' ||
          artifact.type === 'pattern' ||
          artifact.type === 'importedGeometry'
      )
      .flatMap((artifact) =>
        'codeRef' in artifact && artifact.codeRef
          ? [artifact.codeRef.range.join('-')]
          : []
      )
  )
  const assigned = new Set<OperationTreeNode>()
  const branches = Array.from(bodies, ([id, artifact]) => {
    const ancestors = new Map<string, Artifact>()
    const beforeById = new Map<string, number>()
    const pending = [{ id: artifact.id, before: Infinity }]
    while (pending.length > 0) {
      const entry = pending.pop()
      if (!entry || (beforeById.get(entry.id) ?? -1) >= entry.before) continue
      const next = graph.get(entry.id)
      if (!next) continue
      ancestors.set(entry.id, next)
      beforeById.set(entry.id, entry.before)
      // A copy inherits earlier source edits, not edits made after the copy.
      const before = Math.min(
        entry.before,
        'codeRef' in next && next.codeRef
          ? (sourceOrder.get(next.codeRef.range.join('-')) ?? Infinity)
          : Infinity
      )
      pending.push(
        ...getSourceArtifactIds(next, graph).map((id) => ({ id, before }))
      )
    }
    beforeById.set(id, Infinity)

    const matches = (operation: Operation): boolean => {
      if (!('sourceRange' in operation)) return false
      const range = operation.sourceRange
      if (
        Array.from(ancestors.values()).some(
          (source) =>
            'codeRef' in source &&
            source.codeRef &&
            source.codeRef.range[2] === range[2] &&
            source.codeRef.range[0] >= range[0] &&
            source.codeRef.range[1] <= range[1]
        )
      )
        return true

      // Operations that modify a body in place have no new body artifact.
      // Calls that produce geometry belong to their output, not their inputs.
      if (
        operation.type !== 'StdLibCall' ||
        producingRanges.has(range.join('-'))
      )
        return false
      return [
        operation.unlabeledArg,
        ...Object.values(operation.labeledArgs),
      ].some(
        (arg) =>
          arg &&
          referencesBody(
            arg.value,
            beforeById,
            operationOrder.get(operation) ?? Infinity
          )
      )
    }

    function selectNodes(items: OperationTreeNode[]): OperationTreeNode[] {
      return items.flatMap((node): OperationTreeNode[] => {
        if (isOperationTreeBranch(node)) {
          const children = selectNodes(node.children)
          if (children.length === 0) return []
          assigned.add(node)
          return [{ ...node, children }]
        }
        if (isArray(node)) {
          // Keep sketch/function groups intact, including their editing scope.
          if (!node.some(matches)) return []
        } else if (!matches(node)) return []
        assigned.add(node)
        return [node]
      })
    }

    return { id, artifact, operations: selectNodes(nodes) }
  })

  function unassigned(items: OperationTreeNode[]): OperationTreeNode[] {
    return items.flatMap((node): OperationTreeNode[] => {
      if (isOperationTreeBranch(node)) {
        const children = unassigned(node.children)
        return children.length > 0 || !assigned.has(node)
          ? [{ ...node, children }]
          : []
      }
      return assigned.has(node) ? [] : [node]
    })
  }

  return { branches, operations: unassigned(nodes) }
}

function referencesBody(
  value: OpKclValue,
  beforeById: Map<string, number>,
  operationIndex: number
): boolean {
  if (value.type === 'Solid') {
    return operationIndex < (beforeById.get(value.value.artifactId) ?? -1)
  }
  if (value.type === 'ImportedGeometry') {
    return operationIndex < (beforeById.get(value.artifact_id) ?? -1)
  }
  if (value.type === 'Array') {
    return value.value.some((item) =>
      referencesBody(item, beforeById, operationIndex)
    )
  }
  if (value.type === 'Object') {
    return Object.values(value.value).some((item) =>
      referencesBody(item, beforeById, operationIndex)
    )
  }
  return false
}

function getSourceArtifactIds(
  artifact: Artifact,
  graph: ArtifactGraph
): string[] {
  if (artifact.type === 'sweep') {
    return [
      artifact.pathId,
      artifact.trajectoryId,
      artifact.sourceSweepId,
    ].filter((id): id is string => !!id)
  }
  if (artifact.type === 'compositeSolid') {
    return [...artifact.solidIds, ...artifact.toolIds]
  }
  if (artifact.type === 'pattern') {
    const source = graph.get(artifact.sourceId)
    return source?.type === 'path' && source.sweepId
      ? [artifact.sourceId, source.sweepId]
      : [artifact.sourceId]
  }
  if (artifact.type === 'path') {
    return [
      artifact.sketchBlockId,
      artifact.originPathId,
      artifact.innerPathId,
    ].filter((id): id is string => !!id)
  }
  return []
}
