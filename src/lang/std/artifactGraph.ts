import { PathToNode, Program, SourceRange } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { err } from 'lib/trap'

interface CommonCommandProperties {
  range: SourceRange
  pathToNode: PathToNode
}

export interface _PlaneArtifact {
  type: 'plane'
  pathIds: Array<string>
  codeRef: CommonCommandProperties
}
export interface PlaneArtifact {
  type: 'plane'
  paths: Array<_PathArtifact>
  codeRef: CommonCommandProperties
}

export interface _PathArtifact {
  type: 'path'
  planeId: string
  segIds: Array<string>
  extrusionId: string
  solid2dId?: string
  codeRef: CommonCommandProperties
}

interface _solid2D {
  type: 'solid2D'
  pathId: string
}
export interface PathArtifact {
  type: 'path'
  plane: _PlaneArtifact | _WallArtifact
  segs: Array<_SegmentArtifact>
  extrusion: _ExtrusionArtifact
  codeRef: CommonCommandProperties
}

interface _SegmentArtifact {
  type: 'segment'
  pathId: string
  surfId: string
  edgeIds: Array<string>
  edgeCutId?: string
  codeRef: CommonCommandProperties
}
interface SegmentArtifact {
  type: 'segment'
  path: _PathArtifact
  surf: _WallArtifact
  edges: Array<_ExtrudeEdge>
  edgeCut?: _EdgeCut
  codeRef: CommonCommandProperties
}

interface _ExtrusionArtifact {
  type: 'extrusion'
  pathId: string
  surfIds: Array<string>
  edgeIds: Array<string>
  codeRef: CommonCommandProperties
}
interface ExtrusionArtifact {
  type: 'extrusion'
  pathId: string
  surfs: Array<_WallArtifact | _CapArtifact>
  edges: Array<string>
  codeRef: CommonCommandProperties
}

interface _WallArtifact {
  type: 'wall'
  segId: string
  edgeCutEdgeIds: Array<string>
  extrusionId: string
  pathIds: Array<string>
}
interface _CapArtifact {
  type: 'cap'
  subType: 'start' | 'end'
  edgeCutEdgeIds: Array<string>
  extrusionId: string
  pathIds: Array<string>
}

interface _ExtrudeEdge {
  type: 'extrudeEdge'
  segId: string
  extrusionId: string
  edgeId: string
}

/** A edgeCut is a more generic term for both fillet or chamfer */
interface _EdgeCut {
  type: 'edgeCut'
  subType: 'fillet' | 'chamfer'
  consumedEdgeId: string
  edgeIds: Array<string>
  surfId: string
  codeRef: CommonCommandProperties
}

interface EdgeCutEdge {
  type: 'edgeCutEdge'
  edgeCutId: string
  surfId: string
}

export type Artifact =
  | _PlaneArtifact
  | _PathArtifact
  | _SegmentArtifact
  | _ExtrusionArtifact
  | _WallArtifact
  | _CapArtifact
  | _ExtrudeEdge
  | _EdgeCut
  | EdgeCutEdge
  | _solid2D

export type ArtifactGraph = Map<string, Artifact>

export type EngineCommand = Models['WebSocketRequest_type']

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

export interface ResponseMap {
  [commandId: string]: OkWebSocketResponseData
}
export interface OrderedCommand {
  command: EngineCommand
  range: SourceRange
}

export function createArtifactGraph({
  orderedCommands,
  responseMap,
  ast,
}: {
  orderedCommands: Array<OrderedCommand>
  responseMap: ResponseMap
  ast: Program
}) {
  const myMap = new Map<string, Artifact>()
  let currentPlaneId = ''

  const getArtifact = (id: string) => myMap.get(id)
  orderedCommands.forEach((orderedCommand) => {
    if (orderedCommand.command?.type === 'modeling_cmd_req') {
      if (orderedCommand.command.cmd.type === 'enable_sketch_mode') {
        currentPlaneId = orderedCommand.command.cmd.entity_id
      }
      if (orderedCommand.command.cmd.type === 'sketch_mode_disable') {
        currentPlaneId = ''
      }
    }
    const modArr = getArtifactsToUpdate({
      orderedCommand,
      responseMap,
      getArtifact,
      currentPlaneId,
      ast,
    })
    modArr.forEach(({ id, artifact }) => {
      const oldArtifact = myMap.get(id)
      if (oldArtifact?.type !== artifact.type) {
        myMap.set(id, artifact)
        return
      }
      const mergedArtifact = { ...oldArtifact, ...artifact }
      Object.entries(artifact).forEach(([propName, value]) => {
        const otherValue = (oldArtifact as any)[propName]
        if (Array.isArray(value) && Array.isArray(otherValue)) {
          ;(mergedArtifact as any)[propName] = [
            ...new Set([...otherValue, ...value]),
          ]
        }
      })
      myMap.set(id, mergedArtifact)
    })
  })
  return myMap
}

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
  getArtifact: (id: string) => Artifact | undefined
  currentPlaneId: string
  ast: Program
}): Array<{
  id: string
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
            extrusionId: existingPlane.extrusionId,
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
        extrusionId: '',
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
          extrusionId: plane.extrusionId,
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
        surfId: '',
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
      response.type === 'modeling' &&
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
  } else if (cmd.type === 'extrude') {
    returnArr.push({
      id,
      artifact: {
        type: 'extrusion',
        pathId: cmd.target,
        surfIds: [],
        edgeIds: [],
        codeRef: { range, pathToNode },
      },
    })
    const path = getArtifact(cmd.target)
    if (path?.type === 'path')
      returnArr.push({
        id: cmd.target,
        artifact: { ...path, extrusionId: id },
      })
    return returnArr
  } else if (
    cmd.type === 'solid3d_get_extrusion_face_info' &&
    response.type === 'modeling' &&
    response.data.modeling_response.type === 'solid3d_get_extrusion_face_info'
  ) {
    let lastPath: _PathArtifact
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
                extrusionId: path.extrusionId,
                pathIds: [],
              },
            })
            returnArr.push({
              id: curve_id,
              artifact: { ...seg, surfId: face_id },
            })
            const extrusion = getArtifact(path.extrusionId)
            if (extrusion?.type === 'extrusion') {
              returnArr.push({
                id: path.extrusionId,
                artifact: {
                  ...extrusion,
                  surfIds: [face_id],
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
              extrusionId: path.extrusionId,
              pathIds: [],
            },
          })
          const extrusion = getArtifact(path.extrusionId)
          if (extrusion?.type !== 'extrusion') return
          returnArr.push({
            id: path.extrusionId,
            artifact: {
              ...extrusion,
              surfIds: [face_id],
            },
          })
        }
      }
    })
    return returnArr
  } else if (cmd.type === 'solid3d_fillet_edge') {
    returnArr.push({
      id,
      artifact: {
        type: 'edgeCut',
        subType: cmd.cut_type,
        consumedEdgeId: cmd.edge_id,
        edgeIds: [],
        surfId: '',
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
  ) as Map<string, Extract<Artifact, { type: T[number] }>>
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
): Map<string, Extract<Artifact, { type: T[number] }>> {
  return new Map(
    [...map].filter(
      ([key, value]) =>
        keys.includes(key) &&
        types.includes(value.type) &&
        (!predicate ||
          predicate(value as Extract<Artifact, { type: T[number] }>))
    )
  ) as Map<string, Extract<Artifact, { type: T[number] }>>
}

export function getArtifactOfTypes<T extends Artifact['type'][]>(
  {
    key,
    types,
  }: {
    key: string
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
  plane: _PlaneArtifact,
  artifactGraph: ArtifactGraph
): PlaneArtifact {
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
  path: _PathArtifact,
  artifactGraph: ArtifactGraph
): PathArtifact | Error {
  const segs = getArtifactsOfTypes(
    { keys: path.segIds, types: ['segment'] },
    artifactGraph
  )
  const extrusion = getArtifactOfTypes(
    {
      key: path.extrusionId,
      types: ['extrusion'],
    },
    artifactGraph
  )
  const plane = getArtifactOfTypes(
    { key: path.planeId, types: ['plane', 'wall'] },
    artifactGraph
  )
  if (err(extrusion)) return extrusion
  if (err(plane)) return plane
  return {
    type: 'path',
    segs: Array.from(segs.values()),
    extrusion,
    plane,
    codeRef: path.codeRef,
  }
}

export function expandExtrusion(
  extrusion: _ExtrusionArtifact,
  artifactGraph: ArtifactGraph
): ExtrusionArtifact | Error {
  const surfs = getArtifactsOfTypes(
    { keys: extrusion.surfIds, types: ['wall', 'cap'] },
    artifactGraph
  )
  return {
    type: 'extrusion',
    surfs: Array.from(surfs.values()),
    edges: extrusion.edgeIds,
    pathId: extrusion.pathId,
    codeRef: extrusion.codeRef,
  }
}

export function expandSegment(
  segment: _SegmentArtifact,
  artifactGraph: ArtifactGraph
): SegmentArtifact | Error {
  const path = getArtifactOfTypes(
    { key: segment.pathId, types: ['path'] },
    artifactGraph
  )
  const surf = getArtifactOfTypes(
    { key: segment.surfId, types: ['wall'] },
    artifactGraph
  )
  const edges = getArtifactsOfTypes(
    { keys: segment.edgeIds, types: ['extrudeEdge'] },
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
  cap: _CapArtifact,
  artifactGraph: ArtifactGraph
): CommonCommandProperties | Error {
  const extrusion = getArtifactOfTypes(
    { key: cap.extrusionId, types: ['extrusion'] },
    artifactGraph
  )
  if (err(extrusion)) return extrusion
  const path = getArtifactOfTypes(
    { key: extrusion.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(path)) return path
  return path.codeRef
}

export function getSolid2dCodeRef(
  solid2D: _solid2D,
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
  wall: _WallArtifact,
  artifactGraph: ArtifactGraph
): CommonCommandProperties | Error {
  const seg = getArtifactOfTypes(
    { key: wall.segId, types: ['segment'] },
    artifactGraph
  )
  if (err(seg)) return seg
  return seg.codeRef
}

export function getExtrusionFromSuspectedExtrudeSurface(
  id: string,
  artifactGraph: ArtifactGraph
): _ExtrusionArtifact | Error {
  const artifact = getArtifactOfTypes(
    { key: id, types: ['wall', 'cap'] },
    artifactGraph
  )
  if (err(artifact)) return artifact
  return getArtifactOfTypes(
    { key: artifact.extrusionId, types: ['extrusion'] },
    artifactGraph
  )
}

export function getExtrusionFromSuspectedPath(
  id: string,
  artifactGraph: ArtifactGraph
): _ExtrusionArtifact | Error {
  const path = getArtifactOfTypes({ key: id, types: ['path'] }, artifactGraph)
  if (err(path)) return path
  return getArtifactOfTypes(
    { key: path.extrusionId, types: ['extrusion'] },
    artifactGraph
  )
}
