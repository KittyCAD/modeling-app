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
  blendId?: string
  codeRef: CommonCommandProperties
}
interface SegmentArtifact {
  type: 'segment'
  path: _PathArtifact
  surf: _WallArtifact
  edges: Array<_ExtrudeEdge>
  blend?: _Blend
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
  blendEdgeIds: Array<string>
  extrusionId: string
  pathIds: Array<string>
}
interface _CapArtifact {
  type: 'cap'
  subType: 'start' | 'end'
  blendEdgeIds: Array<string>
  extrusionId: string
  pathIds: Array<string>
}

interface _ExtrudeEdge {
  type: 'extrudeEdge'
  segId: string
  extrusionId: string
  blendId: string
}

/** A blend is a fillet or chamfer */
interface _Blend {
  type: 'blend'
  subType: 'fillet' | 'chamfer'
  consumedEdgeId: string
  edgeIds: Array<string>
  surfId: string
  codeRef: CommonCommandProperties
}

interface BlendEdge {
  type: 'blendEdge'
  blendId: string
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
  | _Blend
  | BlendEdge
  | _solid2D

export type ArtifactMap = Map<string, Artifact>

export type EngineCommand = Models['WebSocketRequest_type']

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

export interface ResponseMap {
  [commandId: string]: OkWebSocketResponseData
}
export interface OrderedCommand {
  command: EngineCommand
  range: SourceRange
}

export function createArtifactMap({
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
  orderedCommands.forEach(({ command, range }) => {
    const pathToNode = getNodePathFromSourceRange(ast, range)

    // expect all to be `modeling_cmd_req` as batch commands have
    // already been expanded before being added to orderedCommands
    if (command.type !== 'modeling_cmd_req') return
    const id = command.cmd_id
    const response = responseMap[id]
    const cmd = command.cmd
    if (cmd.type === 'enable_sketch_mode') {
      currentPlaneId = cmd.entity_id
      const plane = myMap.get(currentPlaneId)
      const pathIds = plane?.type === 'plane' ? plane?.pathIds : []
      const codeRef =
        plane?.type === 'plane' ? plane?.codeRef : { range, pathToNode }
      const existingPlane = myMap.get(currentPlaneId)
      if (existingPlane?.type === 'wall') {
        myMap.set(currentPlaneId, {
          type: 'wall',
          segId: existingPlane.segId,
          blendEdgeIds: existingPlane.blendEdgeIds,
          extrusionId: existingPlane.extrusionId,
          pathIds: existingPlane.pathIds,
        })
      } else {
        myMap.set(currentPlaneId, {
          type: 'plane',
          pathIds,
          codeRef,
        })
      }
    } else if (cmd.type === 'sketch_mode_disable') {
      currentPlaneId = ''
    } else if (cmd.type === 'start_path') {
      myMap.set(id, {
        type: 'path',
        segIds: [],
        planeId: currentPlaneId,
        extrusionId: '',
        codeRef: { range, pathToNode },
      })
      const plane = myMap.get(currentPlaneId)
      const codeRef =
        plane?.type === 'plane' ? plane?.codeRef : { range, pathToNode }
      if (plane?.type === 'plane') {
        myMap.set(currentPlaneId, {
          type: 'plane',
          pathIds: [...plane.pathIds, id],
          codeRef,
        })
      }
      if (plane?.type === 'wall') {
        myMap.set(currentPlaneId, {
          type: 'wall',
          segId: plane.segId,
          blendEdgeIds: plane.blendEdgeIds,
          extrusionId: plane.extrusionId,
          pathIds: [...plane.pathIds, id],
        })
      }
    } else if (cmd.type === 'extend_path' || cmd.type === 'close_path') {
      const pathId = cmd.type === 'extend_path' ? cmd.path : cmd.path_id
      myMap.set(id, {
        type: 'segment',
        pathId,
        surfId: '',
        edgeIds: [],
        codeRef: { range, pathToNode },
      })
      const path = myMap.get(pathId)
      if (path?.type === 'path')
        myMap.set(pathId, {
          ...path,
          segIds: [...path.segIds, id],
        })
      if (
        response.type === 'modeling' &&
        response.data.modeling_response.type === 'close_path'
      ) {
        myMap.set(response.data.modeling_response.data.face_id, {
          type: 'solid2D',
          pathId: pathId,
        })
        const path = myMap.get(pathId)
        if (path?.type === 'path')
          myMap.set(pathId, {
            ...path,
            solid2dId: response.data.modeling_response.data.face_id,
          })
      }
    } else if (cmd.type === 'extrude') {
      myMap.set(id, {
        type: 'extrusion',
        pathId: cmd.target,
        surfIds: [],
        edgeIds: [],
        codeRef: { range, pathToNode },
      })
      const path = myMap.get(cmd.target)
      if (path?.type === 'path')
        myMap.set(cmd.target, {
          ...path,
          extrusionId: id,
        })
    } else if (
      cmd.type === 'solid3d_get_extrusion_face_info' &&
      response.type === 'modeling' &&
      response.data.modeling_response.type === 'solid3d_get_extrusion_face_info'
    ) {
      let lastPath: _PathArtifact
      response.data.modeling_response.data.faces.forEach(
        ({ curve_id, cap, face_id }) => {
          if (cap === 'none' && curve_id && face_id) {
            const seg = myMap.get(curve_id)
            if (seg?.type !== 'segment') return
            const path = myMap.get(seg.pathId)
            if (path?.type === 'path' && seg?.type === 'segment') {
              lastPath = path
              myMap.set(face_id, {
                type: 'wall',
                segId: curve_id,
                blendEdgeIds: [],
                extrusionId: path.extrusionId,
                pathIds: [],
              })
              myMap.set(curve_id, {
                ...seg,
                surfId: face_id,
              })
              const extrusion = myMap.get(path.extrusionId)
              if (extrusion?.type === 'extrusion') {
                myMap.set(path.extrusionId, {
                  ...extrusion,
                  surfIds: [...extrusion.surfIds, face_id],
                })
              }
            }
          }
        }
      )
      response.data.modeling_response.data.faces.forEach(({ cap, face_id }) => {
        if ((cap === 'top' || cap === 'bottom') && face_id) {
          // const path = myMap.get(cmd.object_id)
          const path = lastPath
          if (path?.type === 'path') {
            myMap.set(face_id, {
              type: 'cap',
              subType: cap === 'bottom' ? 'start' : 'end',
              blendEdgeIds: [],
              extrusionId: path.extrusionId,
              pathIds: [],
            })
            const extrusion = myMap.get(path.extrusionId)
            if (extrusion?.type !== 'extrusion') return
            myMap.set(path.extrusionId, {
              ...extrusion,
              surfIds: [...extrusion.surfIds, face_id],
            })
          }
        }
      })
    } else if (cmd.type === 'solid3d_fillet_edge') {
      myMap.set(id, {
        type: 'blend',
        subType: cmd.cut_type,
        consumedEdgeId: cmd.edge_id,
        edgeIds: [],
        surfId: '',
        codeRef: { range, pathToNode },
      })
      const consumedEdge = myMap.get(cmd.edge_id)
      if (consumedEdge?.type === 'segment') {
        myMap.set(cmd.edge_id, {
          ...consumedEdge,
          blendId: id,
        })
      }
    }
  })
  return myMap
}

/** filter map items of a specific type */
export function filterArtifacts<T extends Artifact['type'][]>(
  map: ArtifactMap,
  types: T,
  predicate?: (value: Extract<Artifact, { type: T[number] }>) => boolean
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

export function getArtifactsOfType<T extends Artifact['type'][]>(
  keys: string[],
  map: ArtifactMap,
  types: T,
  predicate?: (value: Extract<Artifact, { type: T[number] }>) => boolean
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

function getArtifactOfType<T extends Artifact['type']>(
  key: string,
  map: ArtifactMap,
  type: T
): Extract<Artifact, { type: T }> | Error {
  const artifact = map.get(key)
  if (artifact?.type !== type)
    return new Error(`Expected ${type} but got ${artifact?.type}`)
  return artifact as Extract<Artifact, { type: T }>
}

export function getArtifactOfTypes<T extends Artifact['type'][]>(
  key: string,
  map: ArtifactMap,
  types: T
): Extract<Artifact, { type: T[number] }> | Error {
  const artifact = map.get(key)
  if (!artifact) return new Error(`No artifact found with key ${key}`)
  if (!types.includes(artifact?.type))
    return new Error(`Expected ${types} but got ${artifact?.type}`)
  return artifact as Extract<Artifact, { type: T[number] }>
}

export function expandPlane(
  plane: _PlaneArtifact,
  artifactMap: ArtifactMap
): PlaneArtifact {
  const paths = getArtifactsOfType(plane.pathIds, artifactMap, ['path'])
  return {
    type: 'plane',
    paths: Array.from(paths.values()),
    codeRef: plane.codeRef,
  }
}

export function expandPath(
  path: _PathArtifact,
  artifactMap: ArtifactMap
): PathArtifact | Error {
  const segs = getArtifactsOfType(path.segIds, artifactMap, ['segment'])
  const extrusion = getArtifactOfType(
    path.extrusionId,
    artifactMap,
    'extrusion'
  )
  const plane = getArtifactOfTypes(path.planeId, artifactMap, ['plane', 'wall'])
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
  artifactMap: ArtifactMap
): ExtrusionArtifact | Error {
  const surfs = getArtifactsOfType(extrusion.surfIds, artifactMap, [
    'wall',
    'cap',
  ])
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
  artifactMap: ArtifactMap
): SegmentArtifact | Error {
  const path = getArtifactOfTypes(segment.pathId, artifactMap, ['path'])
  const surf = getArtifactOfTypes(segment.surfId, artifactMap, ['wall'])
  const edges = getArtifactsOfType(segment.edgeIds, artifactMap, [
    'extrudeEdge',
  ])
  const blend = segment.blendId
    ? getArtifactOfType(segment.blendId, artifactMap, 'blend')
    : undefined
  if (err(path)) return path
  if (err(surf)) return surf
  if (err(blend)) return blend

  return {
    type: 'segment',
    path,
    surf,
    edges: Array.from(edges.values()),
    blend,
    codeRef: segment.codeRef,
  }
}

export function getCapCodeRef(
  cap: _CapArtifact,
  artifactMap: ArtifactMap
): CommonCommandProperties | Error {
  const extrusion = getArtifactOfType(cap.extrusionId, artifactMap, 'extrusion')
  if (err(extrusion)) return extrusion
  const path = getArtifactOfType(extrusion.pathId, artifactMap, 'path')
  if (err(path)) return path
  return path.codeRef
}

export function getSolid2dCodeRef(
  solid2D: _solid2D,
  artifactMap: ArtifactMap
): CommonCommandProperties | Error {
  const path = getArtifactOfType(solid2D.pathId, artifactMap, 'path')
  if (err(path)) return path
  return path.codeRef
}

export function getWallCodeRef(
  wall: _WallArtifact,
  artifactMap: ArtifactMap
): CommonCommandProperties | Error {
  const seg = getArtifactOfType(wall.segId, artifactMap, 'segment')
  if (err(seg)) return seg
  return seg.codeRef
}

export function getExtrusionFromSuspectedExtrudeSurface(
  id: string,
  artifactMap: ArtifactMap
): _ExtrusionArtifact | Error {
  const artifact = getArtifactOfTypes(id, artifactMap, ['wall', 'cap'])
  if (err(artifact)) return artifact
  return getArtifactOfTypes(artifact.extrusionId, artifactMap, ['extrusion'])
}

export function getExtrusionFromSuspectedPath(
  id: string,
  artifactMap: ArtifactMap
): _ExtrusionArtifact | Error {
  const path = getArtifactOfTypes(id, artifactMap, ['path'])
  if (err(path)) return path
  return getArtifactOfTypes(path.extrusionId, artifactMap, ['extrusion'])
}
