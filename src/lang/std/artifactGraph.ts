import { PathToNode, Program, SourceRange } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { err } from 'lib/trap'

export type ArtifactId = string

interface CommonCommandProperties {
  range: SourceRange
  pathToNode: PathToNode
}

export interface PlaneArtifact {
  type: 'plane'
  pathIds: Array<ArtifactId>
  codeRef: CommonCommandProperties
}
export interface PlaneArtifactRich {
  type: 'plane'
  paths: Array<PathArtifact>
  codeRef: CommonCommandProperties
}

export interface PathArtifact {
  type: 'path'
  planeId: ArtifactId
  segIds: Array<ArtifactId>
  sweepId: ArtifactId
  solid2dId?: ArtifactId
  codeRef: CommonCommandProperties
}

interface solid2D {
  type: 'solid2D'
  pathId: ArtifactId
}
export interface PathArtifactRich {
  type: 'path'
  plane: PlaneArtifact | WallArtifact
  segments: Array<SegmentArtifact>
  sweep: SweepArtifact
  codeRef: CommonCommandProperties
}

export interface SegmentArtifact {
  type: 'segment'
  pathId: ArtifactId
  surfaceId: ArtifactId
  edgeIds: Array<ArtifactId>
  edgeCutId?: ArtifactId
  codeRef: CommonCommandProperties
}
interface SegmentArtifactRich {
  type: 'segment'
  path: PathArtifact
  surf: WallArtifact
  edges: Array<SweepEdge>
  edgeCut?: EdgeCut
  codeRef: CommonCommandProperties
}

/** A Sweep is a more generic term for extrude, revolve, loft and sweep*/
interface SweepArtifact {
  type: 'sweep'
  subType: 'extrusion' | 'revolve'
  pathId: string
  surfaceIds: Array<string>
  edgeIds: Array<string>
  codeRef: CommonCommandProperties
}
interface SweepArtifactRich {
  type: 'sweep'
  subType: 'extrusion' | 'revolve'
  path: PathArtifact
  surfaces: Array<WallArtifact | CapArtifact>
  edges: Array<SweepEdge>
  codeRef: CommonCommandProperties
}

interface WallArtifact {
  type: 'wall'
  segId: ArtifactId
  edgeCutEdgeIds: Array<ArtifactId>
  sweepId: ArtifactId
  pathIds: Array<ArtifactId>
}
interface CapArtifact {
  type: 'cap'
  subType: 'start' | 'end'
  edgeCutEdgeIds: Array<ArtifactId>
  sweepId: ArtifactId
  pathIds: Array<ArtifactId>
}

interface SweepEdge {
  type: 'sweepEdge'
  segId: ArtifactId
  sweepId: ArtifactId
  subType: 'opposite' | 'adjacent'
}

/** A edgeCut is a more generic term for both fillet or chamfer */
interface EdgeCut {
  type: 'edgeCut'
  subType: 'fillet' | 'chamfer'
  consumedEdgeId: ArtifactId
  edgeIds: Array<ArtifactId>
  surfaceId: ArtifactId
  codeRef: CommonCommandProperties
}

interface EdgeCutEdge {
  type: 'edgeCutEdge'
  edgeCutId: ArtifactId
  surfaceId: ArtifactId
}

export type Artifact =
  | PlaneArtifact
  | PathArtifact
  | SegmentArtifact
  | SweepArtifact
  | WallArtifact
  | CapArtifact
  | SweepEdge
  | EdgeCut
  | EdgeCutEdge
  | solid2D

export type ArtifactGraph = Map<ArtifactId, Artifact>

export type EngineCommand = Models['WebSocketRequest_type']

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

export interface ResponseMap {
  [commandId: string]: OkWebSocketResponseData
}
export interface OrderedCommand {
  command: EngineCommand
  range: SourceRange
}

/** Creates a graph of artifacts from a list of ordered commands and their responses
 * muting the Map should happen entirely this function, other functions called within
 * should return data on how to update the map, and not do so directly.
 */
export function createArtifactGraph({
  orderedCommands,
  responseMap,
  ast,
}: {
  orderedCommands: Array<OrderedCommand>
  responseMap: ResponseMap
  ast: Program
}) {
  const myMap = new Map<ArtifactId, Artifact>()

  /** see docstring for {@link getArtifactsToUpdate} as to why this is needed */
  let currentPlaneId = ''

  orderedCommands.forEach((orderedCommand) => {
    if (orderedCommand.command?.type === 'modeling_cmd_req') {
      if (orderedCommand.command.cmd.type === 'enable_sketch_mode') {
        currentPlaneId = orderedCommand.command.cmd.entity_id
      }
      if (orderedCommand.command.cmd.type === 'sketch_mode_disable') {
        currentPlaneId = ''
      }
    }
    const artifactsToUpdate = getArtifactsToUpdate({
      orderedCommand,
      responseMap,
      getArtifact: (id: ArtifactId) => myMap.get(id),
      currentPlaneId,
      ast,
    })
    artifactsToUpdate.forEach(({ id, artifact }) => {
      const mergedArtifact = mergeArtifacts(myMap.get(id), artifact)
      myMap.set(id, mergedArtifact)
    })
  })
  return myMap
}

/** Merges two artifacts, since our artifacts only contain strings and arrays of string for values we coerce that
 * but maybe types can be improved here.
 */
function mergeArtifacts(
  oldArtifact: Artifact | undefined,
  newArtifact: Artifact
): Artifact {
  // only has string and array of strings
  interface GenericArtifact {
    [key: string]: string | Array<string>
  }
  if (!oldArtifact) return newArtifact
  // merging artifacts of different types should never happen, but if it does, just return the new artifact
  if (oldArtifact.type !== newArtifact.type) return newArtifact
  const _oldArtifact = oldArtifact as any as GenericArtifact
  const mergedArtifact = { ...oldArtifact, ...newArtifact } as GenericArtifact
  Object.entries(newArtifact as any as GenericArtifact).forEach(
    ([propName, value]) => {
      const otherValue = _oldArtifact[propName]
      if (Array.isArray(value) && Array.isArray(otherValue)) {
        mergedArtifact[propName] = [...new Set([...otherValue, ...value])]
      }
    }
  )
  return mergedArtifact as any as Artifact
}

/**
 * Processes a single command and it's response in order to populate the artifact map
 * It does not mutate the map directly, but returns an array of artifacts to update
 *
 * @param currentPlaneId is only needed for `start_path` commands because this command does not have a pathId
 * instead it relies on the id used with the `enable_sketch_mode` command, so this much be kept track of
 * outside of this function. It would be good to update the `start_path` command to include the planeId so we
 * can remove this.
 */
export function getArtifactsToUpdate({
  orderedCommand: { command, range },
  getArtifact,
  responseMap,
  currentPlaneId,
  ast,
}: {
  orderedCommand: OrderedCommand
  responseMap: ResponseMap
  /** Passing in a getter because we don't wan this function to update the map directly */
  getArtifact: (id: ArtifactId) => Artifact | undefined
  currentPlaneId: ArtifactId
  ast: Program
}): Array<{
  id: ArtifactId
  artifact: Artifact
}> {
  const pathToNode = getNodePathFromSourceRange(ast, range)

  // expect all to be `modeling_cmd_req` as batch commands have
  // already been expanded before being added to orderedCommands
  if (command.type !== 'modeling_cmd_req') return []
  const id = command.cmd_id
  const response = responseMap[id]
  const cmd = command.cmd
  const returnArr: ReturnType<typeof getArtifactsToUpdate> = []
  if (!response) return returnArr
  if (cmd.type === 'enable_sketch_mode') {
    const plane = getArtifact(currentPlaneId)
    const pathIds = plane?.type === 'plane' ? plane?.pathIds : []
    const codeRef =
      plane?.type === 'plane' ? plane?.codeRef : { range, pathToNode }
    const existingPlane = getArtifact(currentPlaneId)
    if (existingPlane?.type === 'wall') {
      return [
        {
          id: currentPlaneId,
          artifact: {
            type: 'wall',
            segId: existingPlane.segId,
            edgeCutEdgeIds: existingPlane.edgeCutEdgeIds,
            sweepId: existingPlane.sweepId,
            pathIds: existingPlane.pathIds,
          },
        },
      ]
    } else {
      return [
        { id: currentPlaneId, artifact: { type: 'plane', pathIds, codeRef } },
      ]
    }
  } else if (cmd.type === 'start_path') {
    returnArr.push({
      id,
      artifact: {
        type: 'path',
        segIds: [],
        planeId: currentPlaneId,
        sweepId: '',
        codeRef: { range, pathToNode },
      },
    })
    const plane = getArtifact(currentPlaneId)
    const codeRef =
      plane?.type === 'plane' ? plane?.codeRef : { range, pathToNode }
    if (plane?.type === 'plane') {
      returnArr.push({
        id: currentPlaneId,
        artifact: { type: 'plane', pathIds: [id], codeRef },
      })
    }
    if (plane?.type === 'wall') {
      returnArr.push({
        id: currentPlaneId,
        artifact: {
          type: 'wall',
          segId: plane.segId,
          edgeCutEdgeIds: plane.edgeCutEdgeIds,
          sweepId: plane.sweepId,
          pathIds: [id],
        },
      })
    }
    return returnArr
  } else if (cmd.type === 'extend_path' || cmd.type === 'close_path') {
    const pathId = cmd.type === 'extend_path' ? cmd.path : cmd.path_id
    returnArr.push({
      id,
      artifact: {
        type: 'segment',
        pathId,
        surfaceId: '',
        edgeIds: [],
        codeRef: { range, pathToNode },
      },
    })
    const path = getArtifact(pathId)
    if (path?.type === 'path')
      returnArr.push({
        id: pathId,
        artifact: { ...path, segIds: [id] },
      })
    if (
      response?.type === 'modeling' &&
      response.data.modeling_response.type === 'close_path'
    ) {
      returnArr.push({
        id: response.data.modeling_response.data.face_id,
        artifact: { type: 'solid2D', pathId },
      })
      const path = getArtifact(pathId)
      if (path?.type === 'path')
        returnArr.push({
          id: pathId,
          artifact: {
            ...path,
            solid2dId: response.data.modeling_response.data.face_id,
          },
        })
    }
    return returnArr
  } else if (cmd.type === 'extrude' || cmd.type === 'revolve') {
    const subType = cmd.type === 'extrude' ? 'extrusion' : cmd.type
    returnArr.push({
      id,
      artifact: {
        type: 'sweep',
        subType: subType,
        pathId: cmd.target,
        surfaceIds: [],
        edgeIds: [],
        codeRef: { range, pathToNode },
      },
    })
    const path = getArtifact(cmd.target)
    if (path?.type === 'path')
      returnArr.push({
        id: cmd.target,
        artifact: { ...path, sweepId: id },
      })
    return returnArr
  } else if (
    cmd.type === 'solid3d_get_extrusion_face_info' &&
    response?.type === 'modeling' &&
    response.data.modeling_response.type === 'solid3d_get_extrusion_face_info'
  ) {
    let lastPath: PathArtifact
    response.data.modeling_response.data.faces.forEach(
      ({ curve_id, cap, face_id }) => {
        if (cap === 'none' && curve_id && face_id) {
          const seg = getArtifact(curve_id)
          if (seg?.type !== 'segment') return
          const path = getArtifact(seg.pathId)
          if (path?.type === 'path' && seg?.type === 'segment') {
            lastPath = path
            returnArr.push({
              id: face_id,
              artifact: {
                type: 'wall',
                segId: curve_id,
                edgeCutEdgeIds: [],
                sweepId: path.sweepId,
                pathIds: [],
              },
            })
            returnArr.push({
              id: curve_id,
              artifact: { ...seg, surfaceId: face_id },
            })
            const sweep = getArtifact(path.sweepId)
            if (sweep?.type === 'sweep') {
              returnArr.push({
                id: path.sweepId,
                artifact: {
                  ...sweep,
                  surfaceIds: [face_id],
                },
              })
            }
          }
        }
      }
    )
    response.data.modeling_response.data.faces.forEach(({ cap, face_id }) => {
      if ((cap === 'top' || cap === 'bottom') && face_id) {
        const path = lastPath
        if (path?.type === 'path') {
          returnArr.push({
            id: face_id,
            artifact: {
              type: 'cap',
              subType: cap === 'bottom' ? 'start' : 'end',
              edgeCutEdgeIds: [],
              sweepId: path.sweepId,
              pathIds: [],
            },
          })
          const sweep = getArtifact(path.sweepId)
          if (sweep?.type !== 'sweep') return
          returnArr.push({
            id: path.sweepId,
            artifact: {
              ...sweep,
              surfaceIds: [face_id],
            },
          })
        }
      }
    })
    return returnArr
  } else if (
    // is opposite edge
    (cmd.type === 'solid3d_get_opposite_edge' &&
      response.type === 'modeling' &&
      response.data.modeling_response.type === 'solid3d_get_opposite_edge' &&
      response.data.modeling_response.data.edge) ||
    // or is adjacent edge
    (cmd.type === 'solid3d_get_next_adjacent_edge' &&
      response.type === 'modeling' &&
      response.data.modeling_response.type ===
        'solid3d_get_next_adjacent_edge' &&
      response.data.modeling_response.data.edge)
  ) {
    const wall = getArtifact(cmd.face_id)
    if (wall?.type !== 'wall') return returnArr
    const sweep = getArtifact(wall.sweepId)
    if (sweep?.type !== 'sweep') return returnArr
    const path = getArtifact(sweep.pathId)
    if (path?.type !== 'path') return returnArr
    const segment = getArtifact(cmd.edge_id)
    if (segment?.type !== 'segment') return returnArr

    return [
      {
        id: response.data.modeling_response.data.edge,
        artifact: {
          type: 'sweepEdge',
          subType:
            cmd.type === 'solid3d_get_next_adjacent_edge'
              ? 'adjacent'
              : 'opposite',
          segId: cmd.edge_id,
          sweepId: path.sweepId,
        },
      },
      {
        id: cmd.edge_id,
        artifact: {
          ...segment,
          edgeIds: [response.data.modeling_response.data.edge],
        },
      },
      {
        id: path.sweepId,
        artifact: {
          ...sweep,
          edgeIds: [response.data.modeling_response.data.edge],
        },
      },
    ]
  } else if (cmd.type === 'solid3d_fillet_edge') {
    returnArr.push({
      id,
      artifact: {
        type: 'edgeCut',
        subType: cmd.cut_type,
        consumedEdgeId: cmd.edge_id,
        edgeIds: [],
        surfaceId: '',
        codeRef: { range, pathToNode },
      },
    })
    const consumedEdge = getArtifact(cmd.edge_id)
    if (consumedEdge?.type === 'segment') {
      returnArr.push({
        id: cmd.edge_id,
        artifact: { ...consumedEdge, edgeCutId: id },
      })
    }
    return returnArr
  }
  return []
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
  const sweep = getArtifactOfTypes(
    {
      key: path.sweepId,
      types: ['sweep'],
    },
    artifactGraph
  )
  const plane = getArtifactOfTypes(
    { key: path.planeId, types: ['plane', 'wall'] },
    artifactGraph
  )
  if (err(sweep)) return sweep
  if (err(plane)) return plane
  return {
    type: 'path',
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
  const surf = getArtifactOfTypes(
    { key: segment.surfaceId, types: ['wall'] },
    artifactGraph
  )
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
): CommonCommandProperties | Error {
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
  solid2D: solid2D,
  artifactGraph: ArtifactGraph
): CommonCommandProperties | Error {
  const path = getArtifactOfTypes(
    { key: solid2D.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path
  return path.codeRef
}

export function getWallCodeRef(
  wall: WallArtifact,
  artifactGraph: ArtifactGraph
): CommonCommandProperties | Error {
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
): CommonCommandProperties | Error {
  const seg = getArtifactOfTypes(
    { key: edge.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}
export function getEdgeCuteConsumedCodeRef(
  edge: EdgeCut,
  artifactGraph: ArtifactGraph
): CommonCommandProperties | Error {
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
  return getArtifactOfTypes(
    { key: path.sweepId, types: ['sweep'] },
    artifactGraph
  )
}
