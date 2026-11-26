import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'

type CompositeSolid = Extract<Artifact, { type: 'compositeSolid' }>

export interface SubtractionFaceOrigin {
  /** Number of target-side subtraction steps back from the selected output. */
  cutDepth: number
  operand: 'target' | 'tool'
  role: { type: 'start' | 'end' } | { type: 'wall'; segmentIndex: number }
}

/** Trace a reported live face to a construction role on a subtraction operand. */
export function traceSubtractionFaceOrigin(
  output: CompositeSolid,
  liveFaceId: string,
  graph: ArtifactGraph
): SubtractionFaceOrigin | undefined {
  let current = output
  let faceId = liveFaceId
  const visited = new Set<string>()

  for (let cutDepth = 0; !visited.has(current.id); cutDepth++) {
    visited.add(current.id)
    if (
      current.subType !== 'subtract' ||
      current.solidIds.length !== 1 ||
      current.toolIds.length !== 1
    ) {
      return undefined
    }

    const source = current.subtractionFaceIdentityLineage?.sources[faceId]
    if (!source) return undefined

    const target = graph.get(current.solidIds[0])
    const face = graph.get(source)
    if (face?.type === 'wall' || face?.type === 'cap') {
      const sweep = graph.get(face.sweepId)
      if (sweep?.type === 'sweep' && sweep.subType === 'extrusion') {
        const owns = (id: string) => id === sweep.id || id === sweep.pathId
        const isTarget = owns(current.solidIds[0])
        const isTool = owns(current.toolIds[0])
        if (isTarget !== isTool) {
          const operand = isTarget ? 'target' : 'tool'
          if (face.type === 'cap') {
            return { cutDepth, operand, role: { type: face.subType } }
          }
          const path = sweep.pathId ? graph.get(sweep.pathId) : undefined
          const segmentIndex =
            path?.type === 'path' ? path.segIds.indexOf(face.segId) : -1
          if (segmentIndex === -1) return undefined
          return { cutDepth, operand, role: { type: 'wall', segmentIndex } }
        }
      }
    }

    if (target?.type !== 'compositeSolid') return undefined
    current = target
    faceId = source
  }
}
