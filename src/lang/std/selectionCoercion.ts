import { artifactToEntityRef, resolveSelectionV2 } from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import type { Artifact, CodeRef } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections, SelectionV2 } from '@src/machines/modelingSharedTypes'
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
  const seenBodyIds = new Set<string>()

  for (const selV2 of selections.graphSelectionsV2) {
    const selection = resolveSelectionV2(selV2, artifactGraph)
    if (!selection) {
      if (
        selV2.codeRef &&
        selV2.codeRef.range[1] - selV2.codeRef.range[0] !== 0
      ) {
        codeRefOnlyV2.push({ codeRef: selV2.codeRef })
      }
      continue
    }
    if (!selection.artifact) {
      if (selection.codeRef.range[1] - selection.codeRef.range[0] !== 0) {
        codeRefOnlyV2.push({ codeRef: selection.codeRef })
      }
      continue
    }

    if (
      selection.artifact.type === 'sweep' ||
      selection.artifact.type === 'compositeSolid' ||
      selection.artifact.type === 'path'
    ) {
      if (!seenBodyIds.has(selection.artifact.id)) {
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
      const maybePath = getArtifactOfTypes(
        { key: maybeSweep.pathId, types: ['path'] },
        artifactGraph
      )
      if (!err(maybePath)) {
        if (!seenBodyIds.has(maybePath.id)) {
          seenBodyIds.add(maybePath.id)
          bodySelections.push({
            artifact: maybePath,
            codeRef: maybePath.codeRef,
          })
        }
      } else {
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
        }
      }
    }
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
    otherSelections: selections.otherSelections,
  }
}
