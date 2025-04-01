import { getFaceCodeRef } from 'lang/std/artifactGraph'
import { Artifact, ArtifactGraph, ArtifactId, SourceRange } from 'lang/wasm'

// Index artifacts in an ordered list for binary search
export type ArtifactEntry = { artifact: Artifact; id: ArtifactId }
/** Index artifacts by their codeRef range, ordered by start position */
export type ArtifactIndex = Array<{
  range: SourceRange
  entry: ArtifactEntry
}>

/** Creates an array of artifacts, only those with codeRefs, orders them by start range,
 * to be used later by binary search */
export function buildArtifactIndex(
  artifactGraph: ArtifactGraph
): ArtifactIndex {
  const index: ArtifactIndex = []

  Array.from(artifactGraph).forEach(([id, artifact]) => {
    const codeRef = getFaceCodeRef(artifact)
    if (!codeRef?.range) return

    const entry = { artifact, id }
    index.push({ range: codeRef.range, entry })
  })

  // Sort by start position for binary search
  return index.sort((a, b) => a.range[0] - b.range[0])
}
