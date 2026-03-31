import type { OkWebSocketResponseData, WebSocketRequest } from '@kittycad/lib'

import type {
  Cap,
  CapSubType,
  Plane,
  StartSketchOnFace,
  StartSketchOnPlane,
  Wall,
} from '@rust/kcl-lib/bindings/Artifact'

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  Artifact,
  ArtifactGraph,
  ArtifactId,
  CapArtifact,
  EdgeCut,
  Expr,
  PathArtifact,
  PathToNode,
  PlaneArtifact,
  Program,
  SegmentArtifact,
  Solid2dArtifact as Solid2D,
  SourceRange,
  SweepArtifact,
  WallArtifact,
} from '@src/lang/wasm'
/** Legacy shape for sweep-edge-like artifact (sweepEdge removed from artifact graph). */
type SweepEdgeLike = { segId: string; sweepId?: string }
/** Resolved graph selection (artifact + codeRef). SelectionV2 resolved via resolveSelectionV2. */
export type ResolvedGraphSelection = { codeRef: CodeRef; artifact?: Artifact }
import { err } from '@src/lib/trap'

export type { Artifact, ArtifactId, SegmentArtifact } from '@src/lang/wasm'

export function defaultArtifactGraph(): ArtifactGraph {
  return new Map()
}

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

export interface CapArtifactRich extends BaseArtifact {
  type: 'cap'
  subType: CapSubType
  faceCodeRef: CodeRef
  edgeCuts: Array<EdgeCut>
  paths: Array<PathArtifact>
  sweep?: SweepArtifact
}
export interface WallArtifactRich extends BaseArtifact {
  type: 'wall'
  id: ArtifactId
  segment: PathArtifact
  edgeCuts: Array<EdgeCut>
  sweep: SweepArtifact
  paths: Array<PathArtifact>
  faceCodeRef: CodeRef
}

export type EngineCommand = WebSocketRequest

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
  if (key == null || key === '') {
    return new Error(`No artifact found with key ${key}`)
  }
  const artifact = map.get(key)
  if (!artifact) {
    return new Error(`No artifact found with key ${key}`)
  }
  if (!types.includes(artifact?.type)) {
    return new Error(`Expected ${types.join(',')} but got ${artifact?.type}`)
  }
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

export function expandWall(
  wall: WallArtifact,
  artifactGraph: ArtifactGraph
): WallArtifactRich {
  const { pathIds, sweepId: _s, ...keptProperties } = wall
  const paths = pathIds?.length
    ? Array.from(
        getArtifactsOfTypes(
          { keys: wall.pathIds, types: ['path'] },
          artifactGraph
        ).values()
      )
    : []
  const sweep = artifactGraph.get(wall.sweepId) as SweepArtifact
  const segment = getArtifactOfTypes(
    { key: wall.segId, types: ['segment'] },
    artifactGraph
  )
  const edgeCuts =
    !err(segment) && segment.edgeCutId
      ? Array.from(
          getArtifactsOfTypes(
            { keys: [segment.edgeCutId], types: ['edgeCut'] },
            artifactGraph
          ).values()
        )
      : []
  return {
    type: 'wall',
    ...keptProperties,
    paths,
    sweep,
    segment: artifactGraph.get(wall.segId) as PathArtifact,
    edgeCuts,
  }
}
export function expandCap(
  cap: CapArtifact,
  artifactGraph: ArtifactGraph
): CapArtifactRich {
  const { pathIds, sweepId: _s, ...keptProperties } = cap
  const paths = pathIds?.length
    ? Array.from(
        getArtifactsOfTypes(
          { keys: cap.pathIds, types: ['path'] },
          artifactGraph
        ).values()
      )
    : []
  const maybeSweep = getArtifactOfTypes(
    { key: cap.sweepId, types: ['sweep'] },
    artifactGraph
  )
  const sweep = err(maybeSweep) ? undefined : maybeSweep
  const edgeCuts =
    sweep == null
      ? []
      : Array.from(
          getArtifactsOfTypes(
            { keys: [sweep.pathId], types: ['path'] },
            artifactGraph
          ).values()
        ).flatMap((path) =>
          path.segIds.flatMap((segId) => {
            const segment = getArtifactOfTypes(
              { key: segId, types: ['segment'] },
              artifactGraph
            )
            if (err(segment) || !segment.edgeCutId) return []
            const edgeCut = getArtifactOfTypes(
              { key: segment.edgeCutId, types: ['edgeCut'] },
              artifactGraph
            )
            return err(edgeCut) ? [] : [edgeCut]
          })
        )
  return {
    type: 'cap',
    ...keptProperties,
    paths,
    sweep,
    edgeCuts,
  }
}

export function getCapCodeRef(
  cap: CapArtifact,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const sweepId = cap.sweepId
  if (sweepId == null || sweepId === '') {
    return new Error('cap has no sweepId')
  }
  const sweep = getArtifactOfTypes(
    { key: sweepId, types: ['sweep'] },
    artifactGraph
  )
  if (err(sweep)) return sweep
  const pathId = sweep.pathId
  if (pathId == null || pathId === '') {
    return new Error('sweep has no pathId')
  }
  const path = getArtifactOfTypes(
    { key: pathId, types: ['path'] },
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
  const segId = wall.segId
  if (segId == null || segId === '') {
    return new Error('wall has no segId')
  }
  const seg = getArtifactOfTypes(
    { key: segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}

export function getSweepEdgeCodeRef(
  edge: SweepEdgeLike,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const seg = getArtifactOfTypes(
    { key: edge.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}
/** Resolve the consumed segment id from EdgeCut via Segment.edgeCutId. */
export function getEdgeCutConsumedEdgeId(
  edge: EdgeCut,
  artifactGraph: ArtifactGraph
): string | null {
  return getSegmentForEdgeCut(edge.id, artifactGraph)?.id ?? null
}

export function getSegmentForEdgeCut(
  edgeCutId: string,
  artifactGraph: ArtifactGraph
): SegmentArtifact | null {
  for (const artifact of artifactGraph.values()) {
    if (artifact.type !== 'segment') continue
    if (artifact.edgeCutId !== edgeCutId) continue
    return artifact
  }
  return null
}

export function getEdgeCutConsumedCodeRef(
  edge: EdgeCut,
  artifactGraph: ArtifactGraph
): CodeRef | Error {
  const consumedEdgeId = getEdgeCutConsumedEdgeId(edge, artifactGraph)
  if (consumedEdgeId == null || consumedEdgeId === '') {
    return new Error('edgeCut has no consumed segment')
  }
  const seg = getArtifactOfTypes(
    { key: consumedEdgeId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}

/**
 * When the engine returns a path id for a cap face (e.g. tagged end cap),
 * find a cap that belongs to a sweep using this path. Prefers 'end' cap.
 */
export function getCapForPathId(
  pathId: ArtifactId,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'cap' }> | Error {
  let foundCap: Extract<Artifact, { type: 'cap' }> | undefined
  for (const artifact of artifactGraph.values()) {
    if (artifact.type !== 'sweep') continue
    const sweep = artifact as SweepArtifact
    if (sweep.pathId !== pathId) continue
    const sweepId = sweep.id
    for (const a of artifactGraph.values()) {
      if (a.type !== 'cap') continue
      const cap = a as { sweepId?: string; subType?: string }
      if (cap.sweepId !== sweepId) continue
      if (cap.subType === 'end') return a
      if (!foundCap) foundCap = a
    }
    return foundCap ?? new Error(`No cap found for path ${pathId}`)
  }
  return new Error(`No cap found for path ${pathId}`)
}

export function getSweepFromSuspectedSweepSurface(
  id: ArtifactId,
  artifactGraph: ArtifactGraph
): SweepArtifact | Error {
  let faceArtifact:
    | Extract<Artifact, { type: 'wall' | 'cap' | 'edgeCut' }>
    | undefined
  const direct = getArtifactOfTypes(
    { key: id, types: ['wall', 'cap', 'edgeCut'] },
    artifactGraph
  )
  if (!err(direct)) {
    faceArtifact = direct
  } else {
    const capForPath = getCapForPathId(id, artifactGraph)
    if (!err(capForPath)) {
      faceArtifact = capForPath
    } else {
      return direct
    }
  }
  if (faceArtifact.type === 'wall' || faceArtifact.type === 'cap') {
    const sweepId = (faceArtifact as { sweepId?: string }).sweepId
    if (sweepId == null || sweepId === '') {
      return new Error('wall/cap has no sweepId')
    }
    return getArtifactOfTypes({ key: sweepId, types: ['sweep'] }, artifactGraph)
  }
  const consumedEdgeId = getEdgeCutConsumedEdgeId(faceArtifact, artifactGraph)
  if (consumedEdgeId == null || consumedEdgeId === '') {
    return new Error('edgeCut has no consumed segment')
  }
  const segOrEdge = getArtifactOfTypes(
    { key: consumedEdgeId, types: ['segment'] },
    artifactGraph
  )
  if (err(segOrEdge)) return segOrEdge
  const segment = segOrEdge as SegmentArtifact
  if ((segment as { type?: string }).type === 'segment') {
    const pathId = segment.pathId
    if (pathId == null || pathId === '') {
      return new Error('segment has no pathId')
    }
    const path = getArtifactOfTypes(
      { key: pathId, types: ['path'] },
      artifactGraph
    )
    if (err(path)) return path
    const pathSweepId = (path as { sweepId?: string }).sweepId
    if (!pathSweepId) return new Error('Path does not have a sweepId')
    return getArtifactOfTypes(
      { key: pathSweepId, types: ['sweep'] },
      artifactGraph
    )
  }
  return new Error('Could not resolve sweep from edge')
}

export function getCommonFacesForEdge(
  artifact: SegmentArtifact,
  artifactGraph: ArtifactGraph
): Extract<Artifact, { type: 'wall' | 'cap' }>[] | Error {
  const wall = getArtifactOfTypes(
    { key: artifact.surfaceId ?? '', types: ['wall'] },
    artifactGraph
  )
  if (err(wall)) return wall

  const path = getArtifactOfTypes(
    { key: artifact.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path

  const sketchPlaneFace = getArtifactOfTypes(
    { key: path.planeId, types: ['wall', 'cap'] },
    artifactGraph
  )
  if (!err(sketchPlaneFace) && sketchPlaneFace.id !== wall.id) {
    return [wall, sketchPlaneFace]
  }

  const startCap = [...artifactGraph.values()].find(
    (candidate): candidate is Extract<Artifact, { type: 'cap' }> =>
      candidate.type === 'cap' &&
      candidate.sweepId === path.sweepId &&
      candidate.subType === 'start'
  )
  if (startCap) return [wall, startCap]

  const anyCap = [...artifactGraph.values()].find(
    (candidate): candidate is Extract<Artifact, { type: 'cap' }> =>
      candidate.type === 'cap' && candidate.sweepId === path.sweepId
  )
  if (anyCap) return [wall, anyCap]

  return new Error('No common face found')
}

export function getSweepArtifactFromSelection(
  selection: ResolvedGraphSelection,
  artifactGraph: ArtifactGraph
): SweepArtifact | Error {
  let sweepArtifact: Artifact | null = null
  if (selection.artifact?.type === 'segment') {
    const pathId = selection.artifact.pathId
    if (pathId == null || pathId === '') {
      return new Error('segment artifact has no pathId; cannot resolve sweep')
    }
    const _pathArtifact = getArtifactOfTypes(
      { key: pathId, types: ['path'] },
      artifactGraph
    )
    if (err(_pathArtifact)) return _pathArtifact
    const pathSweepId = (_pathArtifact as { sweepId?: string }).sweepId
    if (!pathSweepId) return new Error('Path does not have a sweepId')
    const _artifact = getArtifactOfTypes(
      { key: pathSweepId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (
    selection.artifact?.type === 'cap' ||
    selection.artifact?.type === 'wall'
  ) {
    const sweepId = (selection.artifact as { sweepId?: string }).sweepId
    if (sweepId == null || sweepId === '') {
      return new Error('wall/cap has no sweepId')
    }
    const _artifact = getArtifactOfTypes(
      { key: sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (selection.artifact?.type === 'primitiveFace') {
    const _artifact = getArtifactOfTypes(
      { key: selection.artifact.solidId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (selection.artifact?.type === 'primitiveEdge') {
    const path = getArtifactOfTypes(
      { key: selection.artifact.solidId, types: ['path'] },
      artifactGraph
    )
    if (err(path)) return path
    const _artifact = getArtifactOfTypes(
      { key: path.sweepId!, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (selection.artifact?.type === 'edgeCut') {
    // Handle edgeCut by getting its consumed edge (segment; sweepEdge removed from artifact graph / selectionsV2)
    const consumedEdgeId = getEdgeCutConsumedEdgeId(
      selection.artifact,
      artifactGraph
    )
    if (consumedEdgeId != null && consumedEdgeId !== '') {
      const segOrEdge = getArtifactOfTypes(
        { key: consumedEdgeId, types: ['segment'] },
        artifactGraph
      )
      if (!err(segOrEdge)) {
        return getSweepArtifactFromSelection(
          {
            artifact: segOrEdge,
            codeRef: selection.codeRef,
          },
          artifactGraph
        )
      }
    }
    return new Error(
      'edgeCut artifact has no consumed segment; cannot resolve sweep'
    )
  }
  if (!sweepArtifact) return new Error('No sweep artifact found')

  return sweepArtifact
}

export function getCodeRefsByArtifactId(
  id: string,
  artifactGraph: ArtifactGraph
): Array<CodeRef> | null {
  const artifact = artifactGraph.get(id)
  if (artifact?.type === 'compositeSolid') {
    return [artifact.codeRef]
  } else if (artifact?.type === 'solid2d') {
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

function getPlaneFromPath(
  path: PathArtifact,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  const plane = getArtifactOfTypes(
    { key: path.planeId, types: ['plane', 'wall', 'cap'] },
    graph
  )
  if (err(plane)) return plane
  return plane
}

function getPlaneFromSegment(
  segment: SegmentArtifact,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  const path = getArtifactOfTypes(
    { key: segment.pathId, types: ['path'] },
    graph
  )
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
}
function getPlaneFromSolid2D(
  solid2D: Solid2D,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  const path = getArtifactOfTypes(
    { key: solid2D.pathId, types: ['path'] },
    graph
  )
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
}
function getPlaneFromCap(
  cap: CapArtifact,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  const sweep = getArtifactOfTypes(
    { key: cap.sweepId, types: ['sweep'] },
    graph
  )
  if (err(sweep)) return sweep
  const path = getArtifactOfTypes({ key: sweep.pathId, types: ['path'] }, graph)
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
}
function getPlaneFromWall(
  wall: WallArtifact,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  const sweep = getArtifactOfTypes(
    { key: wall.sweepId, types: ['sweep'] },
    graph
  )
  if (err(sweep)) return sweep
  const path = getArtifactOfTypes({ key: sweep.pathId, types: ['path'] }, graph)
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
}
function _getPlaneFromSweepEdge(edge: SweepEdgeLike, graph: ArtifactGraph) {
  if (edge.sweepId == null) return new Error('SweepEdgeLike has no sweepId')
  const sweep = getArtifactOfTypes(
    { key: edge.sweepId, types: ['sweep'] },
    graph
  )
  if (err(sweep)) return sweep
  const path = getArtifactOfTypes({ key: sweep.pathId, types: ['path'] }, graph)
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
}
function getPlaneFromStartSketchOnFace(
  sketch: StartSketchOnFace,
  graph: ArtifactGraph
) {
  const plane = getArtifactOfTypes(
    { key: sketch.faceId, types: ['plane'] },
    graph
  )
  return plane
}
function getPlaneFromStartSketchOnPlane(
  sketch: StartSketchOnPlane,
  graph: ArtifactGraph
) {
  const plane = getArtifactOfTypes(
    { key: sketch.planeId, types: ['plane'] },
    graph
  )
  return plane
}

// TODO: stubbed out for now.
function getPlaneFromSketchBlock(
  sketchBlock: Extract<Artifact, { type: 'sketchBlock' }>,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  // If the sketch block is on a default plane, planeId will be null/undefined
  if (!sketchBlock.planeId) {
    return new Error(
      'Sketch block is on a default plane, which is not in the artifact graph'
    )
  }
  // Get the plane artifact (could be plane, wall, or cap)
  const plane = getArtifactOfTypes(
    { key: sketchBlock.planeId, types: ['plane', 'wall', 'cap'] },
    graph
  )
  return plane
}

export function getPlaneFromArtifact(
  artifact: Artifact | undefined,
  graph: ArtifactGraph
): PlaneArtifact | WallArtifact | CapArtifact | Error {
  if (!artifact) return new Error(`Artifact is undefined`)
  if (artifact.type === 'plane') return artifact
  if (artifact.type === 'path') return getPlaneFromPath(artifact, graph)
  if (artifact.type === 'segment') return getPlaneFromSegment(artifact, graph)
  if (artifact.type === 'solid2d') return getPlaneFromSolid2D(artifact, graph)
  if (
    // if the user selects a face with sketch on it (pathIds.length), they probably wanted to edit that sketch,
    // not the sketch for the underlying sweep sketch
    (artifact.type === 'wall' || artifact.type === 'cap') &&
    artifact?.pathIds?.length
  )
    return artifact
  if (artifact.type === 'cap') return getPlaneFromCap(artifact, graph)
  if (artifact.type === 'wall') return getPlaneFromWall(artifact, graph)
  if (artifact.type === 'startSketchOnFace')
    return getPlaneFromStartSketchOnFace(artifact, graph)
  if (artifact.type === 'startSketchOnPlane')
    return getPlaneFromStartSketchOnPlane(artifact, graph)
  if (artifact.type === 'sketchBlock') {
    return getPlaneFromSketchBlock(artifact, graph)
  }
  return new Error(`Artifact type ${artifact.type} does not have a plane`)
}

const onlyConsecutivePaths = (
  orderedNodePaths: PathToNode[],
  originalPath: PathToNode,
  ast: Program
): PathToNode[] => {
  if (!orderedNodePaths.length) {
    return []
  }
  const isExprSafe = (index: number, ast: Program): boolean => {
    // we allow expressions between profiles, but only basic math expressions 5 + 6 etc
    // because 5 + doSomeMath() might be okay, but we can't know if it's an abstraction on a stdlib
    // call that involves a engine call, and we can't have that in sketch-mode/mock-execution
    const expr = ast.body?.[index]
    if (!expr) {
      return false
    }
    if (expr.type === 'ImportStatement' || expr.type === 'ReturnStatement') {
      return false
    }
    if (expr.type === 'VariableDeclaration') {
      const init = expr.declaration?.init
      if (!init) return false
      if (init.type === 'CallExpressionKw') {
        return false
      }
      if (init.type === 'BinaryExpression' && isNodeSafe(init)) {
        return true
      }
      if (init.type === 'Literal' || init.type === 'MemberExpression') {
        return true
      }
    }
    return false
  }
  const originalIndex = Number(
    orderedNodePaths.find(
      (path) => path[1][0] === originalPath[1][0]
    )?.[1]?.[0] || 0
  )

  const minIndex = Number(orderedNodePaths[0][1][0])
  const maxIndex = Number(orderedNodePaths[orderedNodePaths.length - 1][1][0])
  const pathIndexMap: any = {}
  orderedNodePaths.forEach((path) => {
    const bodyIndex = Number(path[1][0])
    pathIndexMap[bodyIndex] = path
  })
  const safePaths: PathToNode[] = []

  // traverse expressions in either direction from the profile selected
  // when the user entered sketch mode
  for (let i = originalIndex; i <= maxIndex; i++) {
    if (pathIndexMap[i]) {
      safePaths.push(pathIndexMap[i])
    } else if (!isExprSafe(i, ast)) {
      break
    }
  }
  for (let i = originalIndex - 1; i >= minIndex; i--) {
    if (pathIndexMap[i]) {
      safePaths.unshift(pathIndexMap[i])
    } else if (!isExprSafe(i, ast)) {
      break
    }
  }
  return safePaths
}

export function getPathsFromPlaneArtifact(
  planeArtifact: PlaneArtifact | WallArtifact | CapArtifact,
  artifactGraph: ArtifactGraph,
  ast: Program
): PathToNode[] {
  const nodePaths: PathToNode[] = []
  for (const pathId of planeArtifact.pathIds) {
    const path = artifactGraph.get(pathId)
    if (!path) continue
    if ('codeRef' in path && path.codeRef) {
      // TODO should figure out why upstream the path is bad
      const isNodePathBad = path.codeRef.pathToNode.length < 2
      nodePaths.push(
        isNodePathBad
          ? getNodePathFromSourceRange(ast, path.codeRef.range)
          : path.codeRef.pathToNode
      )
    }
  }
  if (nodePaths.length === 0) {
    return []
  }
  return onlyConsecutivePaths(nodePaths, nodePaths[0], ast)
}

export function getPathsFromArtifact({
  sketchPathToNode,
  artifact,
  artifactGraph,
  ast,
}: {
  sketchPathToNode: PathToNode
  artifact?: Artifact
  artifactGraph: ArtifactGraph
  ast: Program
}): PathToNode[] | Error {
  const plane = getPlaneFromArtifact(artifact, artifactGraph)
  if (err(plane)) return plane
  const paths = getArtifactsOfTypes(
    { keys: plane.pathIds, types: ['path'] },
    artifactGraph
  )
  let nodePaths = [...paths.values()]
    .map((path) => path.codeRef.pathToNode)
    .sort((a, b) => Number(a[1][0]) - Number(b[1][0]))
  return onlyConsecutivePaths(nodePaths, sketchPathToNode, ast)
}

function isNodeSafe(node: Expr): boolean {
  if (node.type === 'Literal' || node.type === 'MemberExpression') {
    return true
  }
  if (node.type === 'BinaryExpression') {
    return isNodeSafe(node.left) && isNodeSafe(node.right)
  }
  return false
}

/**
 * Get an artifact from a code source range.
 * @param preferredType - When set (e.g. 'helix' when clicking Helix in feature tree), return that artifact type if it matches the range.
 */
export function getArtifactFromRange(
  range: SourceRange,
  artifactGraph: ArtifactGraph,
  preferredType?: Artifact['type']
): Artifact | null {
  let firstCandidate: Artifact | null = null
  let favoredCandidate: Artifact | null = null
  let preferredMatch: Artifact | null = null
  for (const artifact of artifactGraph.values()) {
    const codeRef = getFaceCodeRef(artifact)
    if (codeRef) {
      const match =
        codeRef?.range[0] === range[0] && codeRef.range[1] === range[1]
      if (match) {
        if (preferredType && artifact.type === preferredType) {
          preferredMatch = artifact
        }
        // Favor explicit preferredType first, then sketchBlock, then helix/path, then first match.
        if (artifact.type === 'sketchBlock') {
          favoredCandidate = artifact
        } else if (
          (artifact.type === 'helix' || artifact.type === 'path') &&
          favoredCandidate == null
        ) {
          favoredCandidate = favoredCandidate ?? artifact
        }
        firstCandidate = firstCandidate ?? artifact
      }
    }
  }
  if (preferredMatch) return preferredMatch
  if (favoredCandidate) return favoredCandidate
  // When preferredType is set (e.g. 'helix' from feature tree) but no exact match, try containment either way
  if (preferredType) {
    for (const artifact of artifactGraph.values()) {
      if (artifact.type !== preferredType) continue
      const codeRef = getFaceCodeRef(artifact)
      if (!codeRef) continue
      const opContainsArtifact =
        range[0] <= codeRef.range[0] && range[1] >= codeRef.range[1]
      const artifactContainsOp =
        codeRef.range[0] <= range[0] && codeRef.range[1] >= range[1]
      if (opContainsArtifact || artifactContainsOp) return artifact
    }
  }
  // When explicitly selecting helix from feature tree but no range matched, prefer the first helix so the selection resolves (e.g. single-helix sweep test)
  if (preferredType === 'helix') {
    const firstHelix = [...artifactGraph.values()].find(
      (a) => a.type === 'helix'
    )
    if (firstHelix) return firstHelix
  }
  return firstCandidate
}

export function getFaceCodeRef(
  artifact: Artifact | Plane | Wall | Cap
): CodeRef | null {
  if ('faceCodeRef' in artifact) {
    return artifact.faceCodeRef
  }
  if ('codeRef' in artifact) {
    return artifact.codeRef
  }
  return null
}

/**
 * Utility to filter down the artifact graph to artifacts that we
 * on the frontend deem "bodies". There is no fixed definition of a "body"
 * in the engine, but we mean: Solid3Ds of any kind, as well as 3D curves like helices.
 */
export function getBodiesFromArtifactGraph(artifactGraph: ArtifactGraph) {
  const artifacts = filterArtifacts(
    {
      types: ['compositeSolid', 'sweep'],
      predicate: (a) => !a.consumed,
    },
    artifactGraph
  )

  return artifacts
}
