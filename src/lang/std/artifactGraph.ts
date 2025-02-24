import {
  Expr,
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
import { Selection } from 'lib/selections'
import { err } from 'lib/trap'
import { Cap, Plane, Wall } from 'wasm-lib/kcl/bindings/Artifact'
import { CapSubType } from 'wasm-lib/kcl/bindings/Artifact'

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

export interface PathArtifactRich extends BaseArtifact {
  type: 'path'
  /** A path must always lie on a plane */
  plane: PlaneArtifact | WallArtifact | CapArtifact
  /** A path must always contain 0 or more segments */
  segments: Array<SegmentArtifact>
  /** A path may not result in a sweep artifact */
  sweep: SweepArtifact | null
  codeRef: CodeRef
}

interface SegmentArtifactRich extends BaseArtifact {
  type: 'segment'
  path: PathArtifact
  surf: WallArtifact
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

export function expandWall(
  wall: WallArtifact,
  artifactGraph: ArtifactGraph
): WallArtifactRich {
  const { pathIds, sweepId: _s, edgeCutEdgeIds, ...keptProperties } = wall
  const paths = pathIds?.length
    ? Array.from(
        getArtifactsOfTypes(
          { keys: wall.pathIds, types: ['path'] },
          artifactGraph
        ).values()
      )
    : []
  const sweep = artifactGraph.get(wall.sweepId) as SweepArtifact
  const edgeCuts = edgeCutEdgeIds?.length
    ? Array.from(
        getArtifactsOfTypes(
          { keys: wall.edgeCutEdgeIds, types: ['edgeCut'] },
          artifactGraph
        ).values()
      )
    : []
  const segment = artifactGraph.get(wall.segId) as PathArtifact
  return {
    type: 'wall',
    ...keptProperties,
    paths,
    sweep,
    segment,
    edgeCuts,
  }
}
export function expandCap(
  cap: CapArtifact,
  artifactGraph: ArtifactGraph
): CapArtifactRich {
  const { pathIds, sweepId: _s, edgeCutEdgeIds, ...keptProperties } = cap
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
  const edgeCuts = edgeCutEdgeIds?.length
    ? Array.from(
        getArtifactsOfTypes(
          { keys: cap.edgeCutEdgeIds, types: ['edgeCut'] },
          artifactGraph
        ).values()
      )
    : []
  return {
    type: 'cap',
    ...keptProperties,
    paths,
    sweep,
    edgeCuts,
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
  if (!surf) return new Error('Segment does not have a surface')

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

export function getSweepArtifactFromSelection(
  selection: Selection,
  artifactGraph: ArtifactGraph
): SweepArtifact | Error {
  let sweepArtifact: Artifact | null = null
  if (selection.artifact?.type === 'sweepEdge') {
    const _artifact = getArtifactOfTypes(
      { key: selection.artifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (selection.artifact?.type === 'segment') {
    const _pathArtifact = getArtifactOfTypes(
      { key: selection.artifact.pathId, types: ['path'] },
      artifactGraph
    )
    if (err(_pathArtifact)) return _pathArtifact
    if (!_pathArtifact.sweepId) return new Error('Path does not have a sweepId')
    const _artifact = getArtifactOfTypes(
      { key: _pathArtifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  } else if (selection.artifact?.type === 'cap' || selection.artifact?.type === 'wall') {
    const _artifact = getArtifactOfTypes(
      { key: selection.artifact.sweepId, types: ['sweep'] },
      artifactGraph
    )
    if (err(_artifact)) return _artifact
    sweepArtifact = _artifact
  }
  if (!sweepArtifact) return new Error('No sweep artifact found')

  return sweepArtifact
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
function getPlaneFromSweepEdge(edge: SweepEdge, graph: ArtifactGraph) {
  const sweep = getArtifactOfTypes(
    { key: edge.sweepId, types: ['sweep'] },
    graph
  )
  if (err(sweep)) return sweep
  const path = getArtifactOfTypes({ key: sweep.pathId, types: ['path'] }, graph)
  if (err(path)) return path
  return getPlaneFromPath(path, graph)
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
  if (artifact.type === 'sweepEdge')
    return getPlaneFromSweepEdge(artifact, graph)
  return new Error(`Artifact type ${artifact.type} does not have a plane`)
}

const onlyConsecutivePaths = (
  orderedNodePaths: PathToNode[],
  originalPath: PathToNode,
  ast: Program
): PathToNode[] => {
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
      if (init.type === 'CallExpression') {
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
  planeArtifact: PlaneArtifact,
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
 * Get an artifact from a code source range
 */
export function getArtifactFromRange(
  range: SourceRange,
  artifactGraph: ArtifactGraph
): Artifact | null {
  for (const artifact of artifactGraph.values()) {
    const codeRef = getFaceCodeRef(artifact)
    if (codeRef) {
      const match =
        codeRef?.range[0] === range[0] && codeRef.range[1] === range[1]
      if (match) return artifact
    }
  }
  return null
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
