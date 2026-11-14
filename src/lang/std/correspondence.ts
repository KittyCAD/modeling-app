import type { EntityReference } from '@kittycad/lib'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { artifactToEntityRef } from '@src/lang/queryAst'
import {
  getCodeRefsByArtifactId,
  getOriginalSegmentArtifact,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import {
  entityReferenceKey,
  getEntityRefId,
} from '@src/lib/scene/entityReference'
import { isErr } from '@src/lib/trap'

/** Provenance is a relationship, not a promise that source and geometry have a one-to-one mapping. */
export type CorrespondenceRelation =
  | 'defined-by'
  | 'generated-by'
  | 'derived-from'
  | 'imported-through'
export interface ArtifactCorrespondence {
  readonly entity: EntityReference
  readonly artifactId: string
  readonly sourceArtifactId: string
  readonly range: SourceRange
  readonly relation: CorrespondenceRelation
  readonly queryRange?: SourceRange
}
export interface CorrespondencePolicy {
  readonly relations: readonly CorrespondenceRelation[]
}
// TODO: Consider a registry value spec for correspondence policies. For example, a learning-oriented
// Code view could request full provenance while a feature inspector requests only the generating operation.
// Keep policy data separate from execution-scoped graph queries and command-input acceptance rules.
export const explanationPolicy: CorrespondencePolicy = {
  relations: ['defined-by', 'generated-by', 'derived-from', 'imported-through'],
}
export const directPickingPolicy: CorrespondencePolicy = {
  relations: ['defined-by', 'generated-by'],
}

/** Queries borrow one execution's artifact graph. No secondary graph, UI state, or selection coercion is created. */
export function createArtifactCorrespondence(graph: ArtifactGraph) {
  const forEntity = (
    entity: EntityReference,
    policy: CorrespondencePolicy = explanationPolicy
  ): ArtifactCorrespondence[] => {
    const results: ArtifactCorrespondence[] = []
    const add = (
      target: Artifact,
      source: Artifact | undefined,
      relation: CorrespondenceRelation,
      range?: SourceRange
    ) => {
      if (!source || !policy.relations.includes(relation)) return
      const sourceRange =
        range ?? ('codeRef' in source ? source.codeRef?.range : undefined)
      if (!sourceRange) return
      if (
        results.some(
          (item) =>
            item.relation === relation &&
            item.sourceArtifactId === source.id &&
            item.range.every((value, index) => value === sourceRange[index])
        )
      )
        return
      results.push({
        entity,
        artifactId: target.id,
        sourceArtifactId: source.id,
        range: sourceRange,
        relation,
      })
    }
    const describe = (artifact: Artifact) => {
      switch (artifact.type) {
        case 'wall': {
          const segment = graph.get(artifact.segId)
          add(artifact, segment, 'derived-from')
          const original = getOriginalSegmentArtifact(artifact.segId, graph)
          if (original) add(artifact, original, 'derived-from')
          add(artifact, graph.get(artifact.sweepId ?? ''), 'generated-by')
          break
        }
        case 'cap': {
          const refs = getCodeRefsByArtifactId(artifact.id, graph) ?? []
          for (const ref of refs)
            add(artifact, artifact, 'derived-from', ref.range)
          const sweep = getSweepFromSuspectedSweepSurface(artifact.id, graph)
          if (!isErr(sweep)) add(artifact, graph.get(sweep.id), 'generated-by')
          break
        }
        case 'sweepEdge':
          add(artifact, graph.get(artifact.segId), 'derived-from')
          add(artifact, graph.get(artifact.sweepId ?? ''), 'generated-by')
          break
        case 'solid2d':
          for (const ref of getCodeRefsByArtifactId(artifact.id, graph) ?? [])
            add(artifact, artifact, 'defined-by', ref.range)
          break
        case 'importedGeometry':
          add(artifact, artifact, 'imported-through')
          break
        case 'edgeCut':
          add(artifact, artifact, 'generated-by')
          for (const ref of getCodeRefsByArtifactId(artifact.id, graph)?.slice(
            1
          ) ?? [])
            add(artifact, artifact, 'derived-from', ref.range)
          break
        case 'sweep':
        case 'compositeSolid':
        case 'pattern':
          add(artifact, artifact, 'generated-by')
          break
        case 'plane':
        case 'helix':
        case 'segment':
        case 'path':
        case 'primitiveFace':
        case 'primitiveEdge':
        case 'planeOfFace':
        case 'startSketchOnFace':
        case 'startSketchOnPlane':
        case 'sketchBlock':
        case 'sketchBlockConstraint':
        case 'edgeCutEdge':
        case 'gdtAnnotation':
        case 'namedView':
          add(artifact, artifact, 'defined-by')
      }
    }
    if (entity.type === 'edge' || entity.type === 'vertex') {
      // Adjacency supports explanation only; a neighboring face is never a direct edge/vertex pick.
      const ids =
        entity.type === 'edge'
          ? [...(entity.side_faces ?? []), ...(entity.end_faces ?? [])]
          : (entity.side_faces ?? [])
      for (const id of new Set(ids)) {
        const artifact = graph.get(id)
        if (artifact)
          for (const ref of getCodeRefsByArtifactId(id, graph) ?? [])
            add(artifact, artifact, 'derived-from', ref.range)
      }
    } else {
      const id = getEntityRefId(entity)
      const artifact = id ? graph.get(id) : undefined
      if (artifact) describe(artifact)
    }
    // TODO: Resolve region solver IDs and pattern-copy identity when the artifact graph exposes their provenance.
    // TODO: Add imported-through links for KCL module imports; importedGeometry currently covers CAD imports only.
    return results
  }
  const forCode = (
    range: SourceRange,
    policy: CorrespondencePolicy = explanationPolicy
  ) => {
    const result: ArtifactCorrespondence[] = []
    for (const artifact of graph.values()) {
      const entity = artifactToEntityRef(
        artifact.type,
        artifact.id,
        artifact.type === 'segment' ? artifact.pathId : undefined
      )
      if (!entity) continue
      result.push(
        ...forEntity(entity, policy)
          .filter((item) => rangesOverlap(range, item.range))
          .map((item) => ({ ...item, queryRange: range }))
      )
    }
    return result
  }
  return { forEntity, forCode }
}

export function rangesOverlap(a: SourceRange, b: SourceRange) {
  if (a[2] !== b[2]) return false
  return a[0] === a[1]
    ? b[0] <= a[0] && a[0] < b[1]
    : a[0] < b[1] && b[0] < a[1]
}

/** Each intentional source selection must identify one direct target. Multiplicity permits several such selections, not ambiguity. */
export function resolvePickingCandidates(
  groups: readonly (readonly ArtifactCorrespondence[])[],
  accepts: (entity: EntityReference) => boolean,
  multiple: boolean
): EntityReference[] | Error {
  const result = new Map<string, EntityReference>()
  if (!groups.length)
    return new Error('Select a directly corresponding entity.')
  for (const group of groups) {
    const direct = group.filter(
      (item) =>
        item.artifactId === item.sourceArtifactId &&
        directPickingPolicy.relations.includes(item.relation) &&
        accepts(item.entity)
    )
    // A cursor inside a nested expression chooses the narrowest direct source span, never a containing operation.
    const cursorQuery = direct.every(
      (item) => item.queryRange && item.queryRange[0] === item.queryRange[1]
    )
    const width = Math.min(
      ...direct.map((item) => item.range[1] - item.range[0])
    )
    const candidates = new Map<string, EntityReference>()
    for (const item of direct) {
      const key = entityReferenceKey(item.entity)
      if (key && (!cursorQuery || item.range[1] - item.range[0] === width))
        candidates.set(key, item.entity)
    }
    if (candidates.size !== 1)
      return new Error(
        'The source selection does not identify one compatible entity. Pick geometry in the scene.'
      )
    for (const [key, value] of candidates) result.set(key, value)
  }
  if (!multiple && result.size !== 1)
    return new Error('This argument accepts one entity.')
  return [...result.values()]
}
