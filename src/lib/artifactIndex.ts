import { ArtifactGraph, ArtifactId, SourceRange, Artifact } from 'lang/wasm'
import { getFaceCodeRef } from 'lang/std/artifactGraph'

// Index artifacts in an ordered list for binary search
export type ArtifactEntry = { artifact: Artifact; id: ArtifactId }
export type ArtifactIndex = Array<{
  range: SourceRange
  entry: ArtifactEntry
}>

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
