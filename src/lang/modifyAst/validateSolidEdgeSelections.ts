import { getArtifactFromRange } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'

/** Raw sketch segments cannot express which adjacent solid edge to select. */
export function validateSolidEdgeSelections(
  selections: Selections,
  artifactGraph: ArtifactGraph
): Error | undefined {
  for (const selection of selections.graphSelections) {
    // Viewport and recovered edit selections already identify the intended edge.
    if (selection.entityRef?.type === 'edge') continue
    if (
      selection.entityRef?.type === 'segment' ||
      selection.entityRef?.type === 'solid2d_edge'
    ) {
      return new Error(
        'Sketch segments cannot be used as solid-edge selections.'
      )
    }
    // Explicit face/body references are valid for commands that also accept them.
    if (selection.entityRef) continue
    const artifact =
      selection.artifact ??
      (selection.codeRef
        ? getArtifactFromRange(selection.codeRef.range, artifactGraph)
        : undefined)
    if (artifact?.type === 'segment') {
      return new Error(
        'Sketch segments cannot be used as solid-edge selections.'
      )
    }
  }
}
