import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getPatternArtifactForCopyId,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type {
  EnginePrimitiveSelection,
  EngineTopologyFallback,
  Selection,
} from '@src/machines/modelingSharedTypes'

/** Artifacts whose engine entities own selectable BREP faces and edges. */
export const TOPOLOGY_BODY_ARTIFACT_TYPES: Artifact['type'][] = [
  'sweep',
  'compositeSolid',
  'pattern',
  'importedGeometry',
]

export function getKclBodyIdFromEnginePrimitiveSelection(
  selection: EnginePrimitiveSelection
): string | undefined {
  return selection.kclBodyId ?? selection.parentEntityId
}

export function getBodySelectionFromPrimitiveParentEntityId(
  parentEntityId: string,
  artifactGraph: ArtifactGraph,
  {
    bodyArtifactTypes = TOPOLOGY_BODY_ARTIFACT_TYPES,
    codeRefLookup = 'last',
    lookUpPatternCopies = false,
  }: {
    bodyArtifactTypes?: Artifact['type'][]
    codeRefLookup?: 'first' | 'last'
    lookUpPatternCopies?: boolean
  } = {}
): Selection | null {
  const parentArtifact =
    artifactGraph.get(parentEntityId) ??
    (lookUpPatternCopies
      ? getPatternArtifactForCopyId(parentEntityId, artifactGraph)
      : undefined)
  if (!parentArtifact) {
    return null
  }

  if (
    bodyArtifactTypes.includes(parentArtifact.type) &&
    'codeRef' in parentArtifact
  ) {
    return {
      artifact: parentArtifact,
      codeRef: parentArtifact.codeRef,
      engineEntityId:
        parentArtifact.id === parentEntityId ? undefined : parentEntityId,
    }
  }

  if (parentArtifact.type === 'path' && parentArtifact.sweepId) {
    const parentSweep = getArtifactOfTypes(
      { key: parentArtifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  if (
    parentArtifact.type === 'cap' ||
    parentArtifact.type === 'wall' ||
    parentArtifact.type === 'edgeCut'
  ) {
    const parentSweep = getSweepFromSuspectedSweepSurface(
      parentArtifact.id,
      artifactGraph
    )
    if (!err(parentSweep)) {
      return {
        artifact: parentSweep as Artifact,
        codeRef: parentSweep.codeRef,
      }
    }
  }

  const parentCodeRefs = getCodeRefsByArtifactId(parentEntityId, artifactGraph)
  if (!parentCodeRefs || parentCodeRefs.length === 0) {
    return null
  }

  return {
    artifact: parentArtifact,
    codeRef:
      codeRefLookup === 'first'
        ? parentCodeRefs[0]
        : parentCodeRefs[parentCodeRefs.length - 1],
  }
}

/** Normalize topology_fallback whether it came from TS (camelCase) or engine JSON (snake_case). */
export function getEngineTopologyFallbackNormalized(
  v2: Selection
): EngineTopologyFallback | null {
  const raw =
    v2.engineTopologyFallback ??
    (v2 as { engine_topology_fallback?: unknown }).engine_topology_fallback
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const parentId =
    typeof o.parentId === 'string'
      ? o.parentId
      : typeof o.parent_id === 'string'
        ? o.parent_id
        : ''
  let primitiveIndex = NaN
  if (typeof o.primitiveIndex === 'number') primitiveIndex = o.primitiveIndex
  else if (typeof o.primitiveIndex === 'string')
    primitiveIndex = parseInt(String(o.primitiveIndex), 10)
  else if (typeof o.primitive_index === 'number')
    primitiveIndex = o.primitive_index
  else if (typeof o.primitive_index === 'string')
    primitiveIndex = parseInt(String(o.primitive_index), 10)
  if (!parentId || !Number.isFinite(primitiveIndex)) return null
  return {
    ...v2.engineTopologyFallback,
    parentId,
    primitiveIndex,
  }
}

/** Convert an uncoded SelectionV2 face/edge into the shared primitive codemod input. */
export function getEnginePrimitiveSelectionFromSelection(
  selection: Selection
): EnginePrimitiveSelection | null {
  const reference = selection.entityRef
  if (reference?.type !== 'face' && reference?.type !== 'edge') return null
  const topology = getEngineTopologyFallbackNormalized(selection)
  if (!topology) return null
  return {
    type: 'enginePrimitive',
    entityId:
      selection.engineEntityId ??
      (reference.type === 'face'
        ? reference.face_id
        : (selection.artifact?.id ??
          `${topology.parentId}:edge:${topology.primitiveIndex}`)),
    parentEntityId: topology.parentId,
    primitiveIndex: topology.primitiveIndex,
    primitiveType: reference.type,
    ...(topology.kclBodyId ? { kclBodyId: topology.kclBodyId } : {}),
    ...(topology.kclBodyArtifactType
      ? { kclBodyArtifactType: topology.kclBodyArtifactType }
      : {}),
    ...(topology.bodyPath ? { bodyPath: topology.bodyPath } : {}),
    ...(selection.selectionOrder !== undefined
      ? { selectionOrder: selection.selectionOrder }
      : {}),
  }
}
