import {
  Artifact,
  ArtifactGraph,
  ArtifactId,
  PathToNode,
  Program,
  SourceRange,
  PathArtifact,
  PlaneArtifact,
  WallArtifact,
  SegmentArtifact,
  Solid2dArtifact as Solid2D,
  SweepArtifact,
  SweepEdge,
  CapArtifact,
  EdgeCut,
} from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { err } from 'lib/trap'
import { codeManager } from 'lib/singletons'

export type { Artifact, ArtifactId, SegmentArtifact } from 'lang/wasm'

interface BaseArtifact {
  id: ArtifactId
}

export interface CodeRef {
  range: SourceRange
  pathToNode: PathToNode
}

export interface PlaneArtifactRich extends BaseArtifact {
  type: 'plane'
  paths: Array<PathArtifact>
  codeRef: CodeRef
}

export interface PathArtifactRich extends BaseArtifact {
  type: 'path'
  /** A path must always lie on a plane */
  plane: PlaneArtifact | WallArtifact
  /** A path must always contain 0 or more segments */
  segments: Array<SegmentArtifact>
  /** A path may not result in a sweep artifact */
  sweep: SweepArtifact | null
  codeRef: CodeRef
}

interface SegmentArtifactRich extends BaseArtifact {
  type: 'segment'
  path: PathArtifact
  surf?: WallArtifact
  edges: Array<SweepEdge>
  edgeCut?: EdgeCut
  codeRef: CodeRef
}

interface SweepArtifactRich extends BaseArtifact {
  type: 'sweep'
  subType: 'extrusion' | 'revolve' | 'loft' | 'sweep'
  path: PathArtifact
  surfaces: Array<WallArtifact | CapArtifact>
  edges: Array<SweepEdge>
  codeRef: CodeRef
}

export type EngineCommand = Models['WebSocketRequest_type']

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

export interface ResponseMap {
  [commandId: string]: OkWebSocketResponseData
}

/** filter map items of a specific type */
export function filterArtifacts<T extends Artifact['type'][]>(
  {
    types,
    predicate,
  }: {
    types: T
    predicate?: (value: Extract<Artifact, { type: T[number] }>) => boolean
  },
  map: ArtifactGraph
) {
  return new Map(
    Array.from(map).filter(
      ([_, value]) =>
        types.includes(value.type) &&
        (!predicate ||
          predicate(value as Extract<Artifact, { type: T[number] }>))
    )
  ) as Map<ArtifactId, Extract<Artifact, { type: T[number] }>>
}

export function getArtifactsOfTypes<T extends Artifact['type'][]>(
  {
    keys,
    types,
    predicate,
  }: {
    keys: string[]
    types: T
    predicate?: (value: Extract<Artifact, { type: T[number] }>) => boolean
  },
  map: ArtifactGraph
): Map<ArtifactId, Extract<Artifact, { type: T[number] }>> {
  return new Map(
    [...map].filter(
      ([key, value]) =>
        keys.includes(key) &&
        types.includes(value.type) &&
        (!predicate ||
          predicate(value as Extract<Artifact, { type: T[number] }>))
    )
  ) as Map<ArtifactId, Extract<Artifact, { type: T[number] }>>
}

export function getArtifactOfTypes<T extends Artifact['type'][]>(
  {
    key,
    types,
  }: {
    key: ArtifactId
    types: T
  },
  map: ArtifactGraph
): Extract<Artifact, { type: T[number] }> | Error {
  const artifact = map.get(key)
  if (!artifact) return new Error(`No artifact found with key ${key}`)
  if (!types.includes(artifact?.type))
    return new Error(`Expected ${types} but got ${artifact?.type}`)
  return artifact as Extract<Artifact, { type: T[number] }>
}

export function expandPlane(
  plane: PlaneArtifact,
  artifactGraph: ArtifactGraph
): PlaneArtifactRich {
  const paths = getArtifactsOfTypes(
    { keys: plane.pathIds, types: ['path'] },
    artifactGraph
  )
  return {
    type: 'plane',
    id: plane.id,
    paths: Array.from(paths.values()),
    codeRef: plane.codeRef,
  }
}

export function expandPath(
  path: PathArtifact,
  artifactGraph: ArtifactGraph
): PathArtifactRich | Error {
  const segs = getArtifactsOfTypes(
    { keys: path.segIds, types: ['segment'] },
    artifactGraph
  )
  const sweep = path.sweepId
    ? getArtifactOfTypes(
        {
          key: path.sweepId,
          types: ['sweep'],
        },
        artifactGraph
      )
    : null
  const plane = getArtifactOfTypes(
    { key: path.planeId, types: ['plane', 'wall'] },
    artifactGraph
  )
  if (err(sweep)) return sweep
  if (err(plane)) return plane
  return {
    type: 'path',
    id: path.id,
    segments: Array.from(segs.values()),
    sweep,
    plane,
    codeRef: path.codeRef,
  }
}

export function expandSweep(
  sweep: SweepArtifact,
  artifactGraph: ArtifactGraph
): SweepArtifactRich | Error {
  const surfs = getArtifactsOfTypes(
    { keys: sweep.surfaceIds, types: ['wall', 'cap'] },
    artifactGraph
  )
  const edges = getArtifactsOfTypes(
    { keys: sweep.edgeIds, types: ['sweepEdge'] },
    artifactGraph
  )
  const path = getArtifactOfTypes(
    { key: sweep.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path
  return {
    type: 'sweep',
    subType: sweep.subType,
    id: sweep.id,
    surfaces: Array.from(surfs.values()),
    edges: Array.from(edges.values()),
    path,
    codeRef: sweep.codeRef,
  }
}

export function expandSegment(
  segment: SegmentArtifact,
  artifactGraph: ArtifactGraph
): SegmentArtifactRich | Error {
  const path = getArtifactOfTypes(
    { key: segment.pathId, types: ['path'] },
    artifactGraph
  )
  const surf = segment.surfaceId
    ? getArtifactOfTypes(
        { key: segment.surfaceId, types: ['wall'] },
        artifactGraph
      )
    : undefined
  const edges = getArtifactsOfTypes(
    { keys: segment.edgeIds, types: ['sweepEdge'] },
    artifactGraph
  )
  const edgeCut = segment.edgeCutId
    ? getArtifactOfTypes(
        { key: segment.edgeCutId, types: ['edgeCut'] },
        artifactGraph
      )
    : undefined
  if (err(path)) return path
  if (err(surf)) return surf
  if (err(edgeCut)) return edgeCut

  return {
    type: 'segment',
    id: segment.id,
    path,
    surf,
    edges: Array.from(edges.values()),
    edgeCut: edgeCut,
    codeRef: segment.codeRef,
  }
}

export function getCapCodeRef(
  cap: CapArtifact,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const sweep = getArtifactOfTypes(
    { key: cap.sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (err(sweep)) return sweep
  const path = getArtifactOfTypes(
    { key: sweep.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path
  return path.codeRef
}

export function getSolid2dCodeRef(
  solid2d: Solid2D,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const path = getArtifactOfTypes(
    { key: solid2d.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path
  return path.codeRef
}

export function getWallCodeRef(
  wall: WallArtifact,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const seg = getArtifactOfTypes(
    { key: wall.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}

export function getSweepEdgeCodeRef(
  edge: SweepEdge,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const seg = getArtifactOfTypes(
    { key: edge.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}
export function getEdgeCutConsumedCodeRef(
  edge: EdgeCut,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const seg = getArtifactOfTypes(
    { key: edge.consumedEdgeId, types: ['segment', 'sweepEdge'] },
    artifactGraph
  )
  if (err(seg)) return seg
  if (seg.type === 'segment') return seg.codeRef
  return getSweepEdgeCodeRef(seg, artifactGraph)
}

export function getSweepFromSuspectedSweepSurface(
  id: ArtifactId,
  artifactGraph: ArtifactGraph
): SweepArtifact | Error {
  const artifact = getArtifactOfTypes(
    { key: id, types: ['wall', 'cap', 'edgeCut'] },
    artifactGraph
  )
  if (err(artifact)) return artifact
  if (artifact.type === 'wall' || artifact.type === 'cap') {
    return getArtifactOfTypes(
      { key: artifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
  }
  const segOrEdge = getArtifactOfTypes(
    { key: artifact.consumedEdgeId, types: ['segment', 'sweepEdge'] },
    artifactGraph
  )
  if (err(segOrEdge)) return segOrEdge
  if (segOrEdge.type === 'segment') {
    const path = getArtifactOfTypes(
      { key: segOrEdge.pathId, types: ['path'] },
      artifactGraph
    )
    if (err(path)) return path
    if (!path.sweepId) return new Error('Path does not have a sweepId')
    return getArtifactOfTypes(
      { key: path.sweepId, types: ['sweep'] },
      artifactGraph
    )
  }
  return getArtifactOfTypes(
    { key: segOrEdge.sweepId, types: ['sweep'] },
    artifactGraph
  )
}

export function getSweepFromSuspectedPath(
  id: ArtifactId,
  artifactGraph: ArtifactGraph
): SweepArtifact | Error {
  const path = getArtifactOfTypes({ key: id, types: ['path'] }, artifactGraph)
  if (err(path)) return path
  if (!path.sweepId) return new Error('Path does not have a sweepId')
  return getArtifactOfTypes(
    { key: path.sweepId, types: ['sweep'] },
    artifactGraph
  )
}

export function getCodeRefsByArtifactId(
  id: string,
  artifactGraph: ArtifactGraph
): Array<CodeRef> | null {
  const artifact = artifactGraph.get(id)
  if (artifact?.type === 'solid2d') {
    const codeRef = getSolid2dCodeRef(artifact, artifactGraph)
    if (err(codeRef)) return null
    return [codeRef]
  } else if (artifact?.type === 'cap') {
    const codeRef = getCapCodeRef(artifact, artifactGraph)
    if (err(codeRef)) return null
    return [codeRef]
  } else if (artifact?.type === 'wall') {
    const extrusion = getSweepFromSuspectedSweepSurface(id, artifactGraph)
    const codeRef = getWallCodeRef(artifact, artifactGraph)
    if (err(codeRef)) return null
    return err(extrusion) ? [codeRef] : [codeRef, extrusion.codeRef]
  } else if (artifact?.type === 'sweepEdge') {
    const codeRef = getSweepEdgeCodeRef(artifact, artifactGraph)
    if (err(codeRef)) return null
    return [codeRef]
  } else if (artifact?.type === 'segment') {
    return [artifact.codeRef]
  } else if (artifact?.type === 'edgeCut') {
    const codeRef = artifact.codeRef
    const consumedCodeRef = getEdgeCutConsumedCodeRef(artifact, artifactGraph)
    if (err(consumedCodeRef)) return [codeRef]
    return [codeRef, consumedCodeRef]
  } else if (artifact && 'codeRef' in artifact) {
    return [artifact.codeRef]
  } else {
    return null
  }
}

export function codeRefFromRange(range: SourceRange, ast: Program): CodeRef {
  return {
    range,
    pathToNode: getNodePathFromSourceRange(ast, range),
  }
}

/**
 * Get an artifact from a code source range
 */
export function getArtifactFromRange(
  range: SourceRange,
  artifactGraph: ArtifactGraph
): Artifact | null {
  for (const artifact of artifactGraph.values()) {
    if ('codeRef' in artifact) {
      const match =
        artifact.codeRef?.range[0] === range[0] &&
        artifact.codeRef.range[1] === range[1]
      if (match) return artifact
    }
  }
  return null
}
