import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import {
  isOperationTreeBranch,
  getOperationTreeNodeKey,
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

export function getBodyTreeNodeKey(node: BodyTreeNode, index: number): string {
  if (!isArray(node) && 'body' in node) return `body-${node.body.id}`
  if (!isArray(node) && 'parent' in node) {
    return getOperationTreeNodeKey(node.parent, index)
  }
  return getOperationTreeNodeKey(node, index)
}

export function buildBodyOperationTree(
  nodes: OperationTreeNode[],
  bodies: Map<string, BodyArtifact>,
  graph: ArtifactGraph
) {
  const operationOrder = new Map<Operation, number>()
  const sourceOrder = new Map<string, number>()
  const modulePaths = new Map<number, number[]>()
  const moduleByImportRange = new Map<string, number>()
  function indexOperations(items: OperationTreeNode[], path: number[] = []) {
    for (const node of items) {
      if (isOperationTreeBranch(node)) {
        const modulePath = [...path, node.parent.moduleId]
        modulePaths.set(node.parent.moduleId, modulePath)
        moduleByImportRange.set(
          node.parent.sourceRange.join('-'),
          node.parent.moduleId
        )
        indexOperations(node.children, modulePath)
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
          ? [
              (artifact.codeRef.definitionRange ?? artifact.codeRef.range).join(
                '-'
              ),
            ]
          : []
      )
  )
  const patternByCopyId = new Map<
    string,
    Extract<BodyArtifact, { type: 'pattern' }>
  >()
  const bodyIdByPatternId = new Map<string, string>()
  for (const artifact of graph.values()) {
    if (artifact.type === 'pattern') {
      for (const copyId of artifact.copyIds)
        patternByCopyId.set(copyId, artifact)
    }
    if (artifact.type === 'sweep' || artifact.type === 'compositeSolid') {
      for (const patternId of artifact.patternIds ?? []) {
        bodyIdByPatternId.set(patternId, artifact.id)
      }
    }
  }
  function sourceBodyId(id: string, visited = new Set<string>()): string {
    if (visited.has(id)) return id
    visited.add(id)
    const artifact = graph.get(id)
    const pattern =
      patternByCopyId.get(id) ??
      (artifact?.type === 'pattern' ? artifact : undefined)
    if (pattern) {
      const sourceId = sourceBodyId(pattern.sourceId, visited)
      const source = graph.get(sourceId)
      return source?.type === 'sweep' || source?.type === 'compositeSolid'
        ? sourceId
        : (bodyIdByPatternId.get(pattern.id) ?? sourceId)
    }
    if (artifact?.type === 'path' && artifact.sweepId) {
      return sourceBodyId(artifact.sweepId, visited)
    }
    return id
  }
  const groupedBodies = new Map<string, BodyArtifact>()
  const patternsByBody = new Map<
    string,
    Set<Extract<BodyArtifact, { type: 'pattern' }>>
  >()
  for (const [id, artifact] of bodies) {
    const pattern =
      artifact.type === 'pattern' ? artifact : patternByCopyId.get(id)
    if (!pattern) {
      groupedBodies.set(id, artifact)
      continue
    }
    const sourceId = sourceBodyId(pattern.id)
    const source = graph.get(sourceId)
    groupedBodies.set(
      sourceId,
      source?.type === 'sweep' || source?.type === 'compositeSolid'
        ? source
        : pattern
    )
    const patterns = patternsByBody.get(sourceId) ?? new Set()
    patterns.add(pattern)
    patternsByBody.set(sourceId, patterns)
  }
  const assigned = new Set<OperationTreeNode>()
  const bodyOccurrences = new Map<string, number>()
  const branches = Array.from(groupedBodies, ([id, artifact], index) => {
    const patterns =
      patternsByBody.get(id) ??
      new Set<Extract<BodyArtifact, { type: 'pattern' }>>()
    const ancestors = new Map<string, Artifact>()
    const beforeById = new Map<string, number>()
    const pending = [artifact, ...patterns].map((artifact) => ({
      id: artifact.id,
      before: Infinity,
    }))
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
          ? (sourceOrder.get(
              (next.codeRef.definitionRange ?? next.codeRef.range).join('-')
            ) ?? Infinity)
          : Infinity
      )
      pending.push(
        ...getSourceArtifactIds(next, graph).map((id) => ({ id, before }))
      )
    }
    beforeById.set(id, Infinity)
    for (const pattern of patterns) {
      beforeById.set(pattern.id, Infinity)
      for (const copyId of pattern.copyIds) beforeById.set(copyId, Infinity)
    }

    const matches = (operation: Operation): boolean => {
      if (!('sourceRange' in operation) || operation.type === 'ModuleInstance')
        return false
      const range = operation.sourceRange
      if (
        Array.from(ancestors.values()).some(
          (source) =>
            'codeRef' in source &&
            source.codeRef &&
            (source.codeRef.definitionRange ?? source.codeRef.range)[2] ===
              range[2] &&
            (source.codeRef.definitionRange ?? source.codeRef.range)[0] >=
              range[0] &&
            (source.codeRef.definitionRange ?? source.codeRef.range)[1] <=
              range[1]
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

    // Imported artifacts point to the import statement for source navigation.
    // That range belongs to the caller, while moduleId identifies the part.
    const moduleId =
      artifact.codeRef.definitionRange?.[2] ??
      moduleByImportRange.get(artifact.codeRef.range.join('-')) ??
      artifact.codeRef.range[2]
    const definitionRange =
      artifact.codeRef.definitionRange ?? artifact.codeRef.range
    const creation = Array.from(operationOrder.keys()).find(
      (operation) =>
        'sourceRange' in operation &&
        operation.sourceRange.every(
          (value, index) => value === definitionRange[index]
        )
    )
    // Engine IDs and byte offsets can change when editing a sketch.
    const nodePath =
      creation && 'nodePath' in creation
        ? creation.nodePath
        : artifact.codeRef.nodePath
    const sourceKey = JSON.stringify([moduleId, nodePath])
    const occurrence = bodyOccurrences.get(sourceKey) ?? 0
    bodyOccurrences.set(sourceKey, occurrence + 1)
    return {
      id,
      expansionKey: `${sourceKey}-${occurrence}`,
      artifact,
      index,
      ownerModuleId: modulePaths.has(moduleId) ? moduleId : 0,
      operations: selectNodes(nodes),
    }
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

  function bodyFeatures(
    items: OperationTreeNode[],
    path: Set<number>
  ): OperationTreeNode[] {
    return items.flatMap((node): OperationTreeNode[] =>
      isOperationTreeBranch(node) && path.has(node.parent.moduleId)
        ? bodyFeatures(node.children, path)
        : [node]
    )
  }

  function assemble(
    items: OperationTreeNode[],
    moduleId: number
  ): BodyTreeNode[] {
    const result = items.flatMap((node): BodyTreeNode[] => {
      if (isOperationTreeBranch(node)) {
        const children = assemble(node.children, node.parent.moduleId)
        return children.length > 0 || !assigned.has(node)
          ? [{ parent: node.parent, children }]
          : []
      }
      return assigned.has(node) ? [] : [node]
    })
    for (const body of branches) {
      if (body.ownerModuleId !== moduleId) continue
      result.push({
        body,
        children: bodyFeatures(
          body.operations,
          new Set(modulePaths.get(moduleId) ?? [])
        ),
      })
    }
    return result
  }

  return { branches, operations: unassigned(nodes), nodes: assemble(nodes, 0) }
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
