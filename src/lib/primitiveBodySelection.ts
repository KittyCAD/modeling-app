import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getPatternArtifactForCopyId,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selection } from '@src/machines/modelingSharedTypes'

export function getBodySelectionFromPrimitiveParentEntityId(
  parentEntityId: string,
  artifactGraph: ArtifactGraph,
  {
    bodyArtifactTypes = ['sweep', 'compositeSolid'],
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
export function getEngineTopologyFallbackNormalized(v2: Selection): {
  parentId: string
  primitiveIndex: number
} | null {
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
  return { parentId, primitiveIndex }
}
