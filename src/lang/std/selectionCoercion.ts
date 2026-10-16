import {
  artifactToEntityRef,
  getEntityRefId,
  resolveToCodeRef,
} from '@src/lang/queryAst'
import {
  getArtifactFromRange,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { CommandSelectionType } from '@src/lib/commandTypes'
import {
  getBodySelectionFromPrimitiveParentEntityId,
  getEngineTopologyFallbackNormalized,
  isEnginePrimitiveSelection,
} from '@src/lib/selections'
import { isErr } from '@src/lib/trap'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

/** Coerce faces and edges to bodies without losing source-only or unresolved selections. */
export function coerceSelectionsToBody(
  selections: Selections,
  artifactGraph: ArtifactGraph
): Selections | Error {
  const graphSelections: Selection[] = []
  const otherSelections: Selections['otherSelections'] = []
  const seenBodyIds = new Set<string>()

  function appendBody(selection: Selection) {
    const artifact = resolveToCodeRef(selection, artifactGraph)?.artifact
    let bodyId =
      artifact?.id ??
      (selection.entityRef && getEntityRefId(selection.entityRef)) ??
      selection.engineEntityId
    if (artifact?.type === 'pattern') {
      const index =
        selection.patternIndex ??
        (selection.engineEntityId
          ? artifact.copyIds.indexOf(selection.engineEntityId) + 1
          : undefined)
      if (index !== undefined) bodyId = `${artifact.id}[${index}]`
    }
    if (bodyId && seenBodyIds.has(bodyId)) return
    if (bodyId) seenBodyIds.add(bodyId)
    graphSelections.push(selection)
  }

  function bodyFromParent(parentId: string) {
    const body = getBodySelectionFromPrimitiveParentEntityId(
      parentId,
      artifactGraph,
      {
        bodyArtifactTypes: ['sweep', 'compositeSolid', 'pattern'],
        lookUpPatternCopies: true,
      }
    )
    if (!body?.artifact) return null
    return {
      ...body,
      entityRef: artifactToEntityRef(body.artifact.type, body.artifact.id),
    }
  }

  for (const selection of selections.graphSelections) {
    const topology = getEngineTopologyFallbackNormalized(selection)
    const parent = topology && bodyFromParent(topology.parentId)
    if (parent) {
      appendBody(parent)
      continue
    }

    const resolved = resolveToCodeRef(selection, artifactGraph)
    const artifact =
      resolved &&
      (resolved.artifact ??
        getArtifactFromRange(resolved.codeRef.range, artifactGraph))
    if (!resolved || !artifact) {
      graphSelections.push(selection)
      continue
    }
    if (
      artifact.type === 'pattern' ||
      artifact.type === 'helix' ||
      artifact.type === 'plane' ||
      artifact.type === 'sketchBlock' ||
      artifact.type === 'solid2d'
    ) {
      appendBody({ ...selection, ...resolved, artifact })
      continue
    }
    if (artifact.type === 'sweep' || artifact.type === 'compositeSolid') {
      appendBody({
        // A promoted face/edge ID is not the identity of the resulting body.
        ...(!selection.entityRef || selection.entityRef.type === 'solid3d'
          ? selection
          : {}),
        entityRef: artifactToEntityRef(artifact.type, artifact.id),
        artifact,
        codeRef: resolved.codeRef,
      })
      continue
    }
    if (artifact.type === 'path') {
      const sweep = artifact.sweepId
        ? artifactGraph.get(artifact.sweepId)
        : undefined
      if (sweep?.type === 'sweep') {
        appendBody({
          entityRef: artifactToEntityRef(sweep.type, sweep.id),
          codeRef: sweep.codeRef,
        })
      } else {
        appendBody({ ...selection, ...resolved, artifact })
      }
      continue
    }

    const sweep = getSweepArtifactFromSelection(
      { ...resolved, artifact },
      artifactGraph
    )
    if (isErr(sweep)) return sweep
    appendBody({
      entityRef: artifactToEntityRef(sweep.type, sweep.id),
      codeRef: sweep.codeRef,
    })
  }

  for (const selection of selections.otherSelections) {
    const parent =
      isEnginePrimitiveSelection(selection) && selection.parentEntityId
        ? bodyFromParent(selection.parentEntityId)
        : null
    if (parent) appendBody(parent)
    else otherSelections.push(selection)
  }
  return { graphSelections, otherSelections }
}

export function coerceSelectionsForBodyOnlySelectionTypes(
  selections: Selections | undefined,
  selectionTypes: CommandSelectionType[] | undefined,
  artifactGraph: ArtifactGraph
): Selections | undefined {
  if (
    !selections ||
    !selectionTypes?.length ||
    !selectionTypes.every((type) =>
      [
        'sweep',
        'compositeSolid',
        'path',
        'pathRegion',
        'sketchBlock',
        'solid2d',
        'helix',
        'plane',
      ].includes(type)
    )
  )
    return selections

  const coerced = coerceSelectionsToBody(selections, artifactGraph)
  return isErr(coerced) ? selections : coerced
}
