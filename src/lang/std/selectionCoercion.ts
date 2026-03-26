import { artifactToEntityRef, resolveSelectionV2 } from '@src/lang/queryAst'
import { getBodySelectionFromPrimitiveParentEntityId } from '@src/lang/modifyAst/faces'
import {
  getArtifactFromRange,
  getArtifactOfTypes,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import type { Artifact, CodeRef } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { CommandSelectionType } from '@src/lib/commandTypes'
import type { Selections, SelectionV2 } from '@src/machines/modelingSharedTypes'
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import { err } from '@src/lib/trap'

/**
 * Coerce selections that may contain faces or edges to their parent body (sweep/compositeSolid).
 * This is useful for commands that only work with bodies, but users may have faces or edges selected.
 *
 * @param selections - The selections to coerce
 * @param artifactGraph - The artifact graph to use for lookups
 * @returns A new Selections object with only body artifacts, or an Error if coercion fails
 */
export function coerceSelectionsToBody(
  selections: Selections,
  artifactGraph: ArtifactGraph
): Selections | Error {
  const bodySelections: Array<{ artifact: Artifact; codeRef: CodeRef }> = []
  const codeRefOnlyV2: Array<SelectionV2> = []
  const remainingOtherSelections: Selections['otherSelections'] = []
  const seenBodyIds = new Set<string>()

  for (const selV2 of selections.graphSelectionsV2) {
    const resolvedSelection = resolveSelectionV2(selV2, artifactGraph)
    const selection = resolvedSelection
      ? !resolvedSelection.artifact && resolvedSelection.codeRef.range
        ? {
            ...resolvedSelection,
            artifact:
              getArtifactFromRange(
                resolvedSelection.codeRef.range,
                artifactGraph
              ) ?? undefined,
          }
        : resolvedSelection
      : selV2.codeRef
        ? {
            codeRef: selV2.codeRef,
            artifact:
              getArtifactFromRange(selV2.codeRef.range, artifactGraph) ??
              undefined,
          }
        : null

    if (!selection) {
      continue
    }

    if (!selection.artifact) {
      if (selection.codeRef.range[1] - selection.codeRef.range[0] !== 0) {
        codeRefOnlyV2.push({ codeRef: selection.codeRef })
      }
      continue
    }

    if (selection.artifact.type === 'path') {
      const maybeSweepId = selection.artifact.sweepId
      if (maybeSweepId) {
        const sweepWithType = getArtifactOfTypes(
          { key: maybeSweepId, types: ['sweep'] },
          artifactGraph
        )
        if (!err(sweepWithType) && !seenBodyIds.has(sweepWithType.id)) {
          seenBodyIds.add(sweepWithType.id)
          bodySelections.push({
            artifact: sweepWithType,
            codeRef: sweepWithType.codeRef,
          })
          continue
        }
      }

      if (
        selection.artifact.codeRef.range[1] -
          selection.artifact.codeRef.range[0] !==
        0
      ) {
        codeRefOnlyV2.push({ codeRef: selection.artifact.codeRef })
      }
      continue
    }

    if (
      selection.artifact.type === 'sweep' ||
      selection.artifact.type === 'compositeSolid'
    ) {
      const entityRef = artifactToEntityRef(
        selection.artifact.type,
        selection.artifact.id
      )
      if (entityRef && !seenBodyIds.has(selection.artifact.id)) {
        seenBodyIds.add(selection.artifact.id)
        bodySelections.push({
          artifact: selection.artifact,
          codeRef: selection.codeRef,
        })
      }
    } else {
      const maybeSweep = getSweepArtifactFromSelection(selection, artifactGraph)
      if (err(maybeSweep)) {
        return new Error(
          `Unable to find parent body for selected artifact: ${selection.artifact.type}`
        )
      }
      // Prefer the sweep (3D solid) over the path (2D profile) when it has entityRef.
      const sweepWithType = getArtifactOfTypes(
        { key: maybeSweep.id, types: ['sweep'] },
        artifactGraph
      )
      if (!err(sweepWithType) && !seenBodyIds.has(sweepWithType.id)) {
        seenBodyIds.add(sweepWithType.id)
        bodySelections.push({
          artifact: sweepWithType,
          codeRef: maybeSweep.codeRef,
        })
        continue
      }

      const maybePath = getArtifactOfTypes(
        { key: maybeSweep.pathId, types: ['path'] },
        artifactGraph
      )
      if (!err(maybePath) && !seenBodyIds.has(maybePath.id)) {
        const pathEntityRef = artifactToEntityRef('path', maybePath.id)
        if (pathEntityRef) {
          seenBodyIds.add(maybePath.id)
          bodySelections.push({
            artifact: maybePath,
            codeRef: maybePath.codeRef,
          })
        } else if (
          maybePath.codeRef.range[1] - maybePath.codeRef.range[0] !==
          0
        ) {
          codeRefOnlyV2.push({ codeRef: maybePath.codeRef })
        }
      }
    }
  }

  for (const selection of selections.otherSelections) {
    if (
      isEnginePrimitiveSelection(selection) &&
      selection.parentEntityId != null
    ) {
      const bodySelection = getBodySelectionFromPrimitiveParentEntityId(
        selection.parentEntityId,
        artifactGraph
      )
      if (
        bodySelection?.artifact &&
        !seenBodyIds.has(bodySelection.artifact.id)
      ) {
        seenBodyIds.add(bodySelection.artifact.id)
        bodySelections.push({
          artifact: bodySelection.artifact,
          codeRef: bodySelection.codeRef,
        })
        continue
      }
    }

    remainingOtherSelections.push(selection)
  }

  const graphSelectionsV2: SelectionV2[] = [
    ...bodySelections
      .map((s) => ({
        entityRef: artifactToEntityRef(s.artifact.type, s.artifact.id),
        codeRef: s.codeRef,
      }))
      .filter(
        (
          v2
        ): v2 is typeof v2 & { entityRef: NonNullable<typeof v2.entityRef> } =>
          v2.entityRef != null
      ),
    ...codeRefOnlyV2,
  ]

  return {
    graphSelectionsV2,
    otherSelections: remainingOtherSelections,
  }
}

export function coerceSelectionsForBodyOnlySelectionTypes(
  selections: Selections | undefined,
  selectionTypes: CommandSelectionType[] | undefined,
  artifactGraph: ArtifactGraph
): Selections | undefined {
  if (
    !selections ||
    (selections.graphSelectionsV2.length === 0 &&
      selections.otherSelections.length === 0)
  ) {
    return selections
  }

  const onlyAcceptsBodies = selectionTypes?.every(
    (type) => type === 'sweep' || type === 'compositeSolid' || type === 'path'
  )
  if (!onlyAcceptsBodies) {
    return selections
  }

  const coercedSelections = coerceSelectionsToBody(selections, artifactGraph)
  if (err(coercedSelections)) {
    return selections
  }

  if ((coercedSelections.graphSelectionsV2?.length ?? 0) === 0) {
    return selections
  }

  return coercedSelections
}
