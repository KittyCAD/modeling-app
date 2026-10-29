import { getArtifactsOfTypes } from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, SegmentArtifact } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'

/** Temporary adapter for legacy fixtures; remove as those fixtures migrate to face references. */
export function getCommonFacesForEdge(
  artifact: SegmentArtifact,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'wall' | 'cap' }>[] | Error {
  const candidates =
    'pathId' in artifact
      ? [
          artifact,
          ...[...artifactGraph.values()].filter(
            (candidate): candidate is Extract<Artifact, { type: 'segment' }> =>
              candidate.type === 'segment' &&
              candidate.originalSegId === artifact.id
          ),
        ]
      : [artifact]

  let commonFaces: Extract<Artifact, { type: 'wall' | 'cap' }>[] | null = null

  for (const candidate of candidates) {
    const faces = getArtifactsOfTypes(
      { keys: candidate.commonSurfaceIds, types: ['wall', 'cap'] },
      artifactGraph
    )
    if (isErr(faces)) {
      return faces
    }
    if (faces.size === 0) {
      continue
    }

    const candidateFaces = [...faces.values()]
    const commonFaceIds = new Set(commonFaces?.map(({ id }) => id))
    if (
      commonFaces &&
      (commonFaces.length !== candidateFaces.length ||
        candidateFaces.some(({ id }) => !commonFaceIds.has(id)))
    ) {
      return new Error('Segment maps to more than one set of common faces')
    }
    commonFaces = candidateFaces
  }

  return commonFaces ?? new Error('No common face found')
}
