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
  codeRef: CommonCommandProperties
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
}

interface ExtrudeEdge {
  type: 'extrudeEdge'
  segId: string
  extrusionId: string
  blendId: string
}

/** A blend is a fillet or chamfer */
interface Blend {
  type: 'blend'
  SubType: 'fillet' | 'chamfer'
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

export type ArtifactMapV2 =
  | _PlaneArtifact
  | _PathArtifact
  | _SegmentArtifact
  | _ExtrusionArtifact
  | _WallArtifact
  | _CapArtifact
  | ExtrudeEdge
  | Blend
  | BlendEdge

interface ExtrudeArtifact extends CommonCommandProperties {
  type: 'extrude'
  pathId: string
}

export interface StartPathArtifact extends CommonCommandProperties {
  type: 'startPath'
  extrusionIds: string[]
}

export interface SegmentArtifact extends CommonCommandProperties {
  type: 'segment'
  subType: 'segment' | 'closeSegment'
  pathId: string
}

interface ExtrudeCapArtifact extends CommonCommandProperties {
  type: 'extrudeCap'
  cap: 'start' | 'end'
  pathId: string
}
interface ExtrudeWallArtifact extends CommonCommandProperties {
  type: 'extrudeWall'
  pathId: string
}

interface PatternInstance extends CommonCommandProperties {
  type: 'patternInstance'
}

export type ArtifactMapCommand =
  | ExtrudeArtifact
  | StartPathArtifact
  | ExtrudeCapArtifact
  | ExtrudeWallArtifact
  | SegmentArtifact
  | PatternInstance

export type EngineCommand = Models['WebSocketRequest_type']

type OkWebSocketResponseData = Models['OkWebSocketResponseData_type']

/**
 * The ArtifactMap is a client-side representation of the artifacts that
 * have been sent to the server-side engine. It is used to keep track of
 * the state of each command, and to resolve the promise that was returned.
 * It is also used to keep track of what entities are in the engine scene,
 * so that we can associate IDs returned from the engine with the
 * lines of KCL code that generated them.
 */
export interface ArtifactMap {
  [commandId: string]: ArtifactMapCommand
}

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
}): ArtifactMap {
  const artifactMap: ArtifactMap = {}
  orderedCommands.forEach(({ command, range }) => {
    // expect all to be `modeling_cmd_req` as batch commands have
    // already been expanded before being added to orderedCommands
    if (command.type !== 'modeling_cmd_req') return
    const id = command.cmd_id
    const response = responseMap[id]
    const artifacts = handleIndividualResponse({
      id,
      pendingMsg: {
        command,
        range,
      },
      response,
      ast,
      prevArtifactMap: artifactMap,
    })
    artifacts.forEach(({ commandId, artifact }) => {
      artifactMap[commandId] = artifact
    })
  })
  return artifactMap
}

function handleIndividualResponse({
  id,
  pendingMsg,
  response,
  ast,
  prevArtifactMap,
}: {
  id: string
  pendingMsg: {
    command: EngineCommand
    range: SourceRange
  }
  response: OkWebSocketResponseData
  ast: Program
  prevArtifactMap: ArtifactMap
}): Array<{
  commandId: string
  artifact: ArtifactMapCommand
}> {
  const command = pendingMsg
  if (command?.command?.type !== 'modeling_cmd_req') return []
  if (response?.type !== 'modeling') return []
  const command2 = command.command.cmd

  const range = command.range
  const pathToNode = getNodePathFromSourceRange(ast, range)
  const modelingResponse = response.data.modeling_response

  const artifacts: Array<{
    commandId: string
    artifact: ArtifactMapCommand
  }> = []

  if (command) {
    if (
      command2.type !== 'extrude' &&
      command2.type !== 'extend_path' &&
      command2.type !== 'solid3d_get_extrusion_face_info' &&
      command2.type !== 'start_path' &&
      command2.type !== 'close_path'
    ) {
    }
    if (command2.type === 'extrude') {
      artifacts.push({
        commandId: id,
        artifact: {
          type: 'extrude',
          range,
          pathToNode,
          pathId: command2.target,
        },
      })

      const targetArtifact = { ...prevArtifactMap[command2.target] }
      if (targetArtifact?.type === 'startPath') {
        artifacts.push({
          commandId: command2.target,
          artifact: {
            ...targetArtifact,
            type: 'startPath',
            range: targetArtifact.range,
            pathToNode: targetArtifact.pathToNode,
            extrusionIds: targetArtifact?.extrusionIds
              ? [...targetArtifact?.extrusionIds, id]
              : [id],
          },
        })
      }
    }
    if (command2.type === 'extend_path') {
      artifacts.push({
        commandId: id,
        artifact: {
          type: 'segment',
          subType: 'segment',
          range,
          pathToNode,
          pathId: command2.path,
        },
      })
    }
    if (command2.type === 'close_path')
      artifacts.push({
        commandId: id,
        artifact: {
          type: 'segment',
          subType: 'closeSegment',
          range,
          pathToNode,
          pathId: command2.path_id,
        },
      })
    if (command2.type === 'start_path') {
      artifacts.push({
        commandId: id,
        artifact: {
          type: 'startPath',
          range,
          pathToNode,
          extrusionIds: [],
        },
      })
    }
    if (
      (command2.type === 'entity_linear_pattern' &&
        modelingResponse.type === 'entity_linear_pattern') ||
      (command2.type === 'entity_circular_pattern' &&
        modelingResponse.type === 'entity_circular_pattern')
    ) {
      // TODO this is not working perfectly, maybe it's like a selection filter issue
      // but when clicking on a instance it does put the cursor somewhat relevant but
      // edges and what not do not highlight the correct segment.
      const entities = modelingResponse.data.entity_ids
      entities?.forEach((entity: string) => {
        artifacts.push({
          commandId: entity,
          artifact: {
            range: range,
            pathToNode,
            type: 'patternInstance',
          },
        })
      })
    }
    if (
      command2.type === 'solid3d_get_extrusion_face_info' &&
      modelingResponse.type === 'solid3d_get_extrusion_face_info'
    ) {
      const edgeArtifact = prevArtifactMap[command2.edge_id]
      const parent =
        edgeArtifact?.type === 'segment'
          ? prevArtifactMap[edgeArtifact.pathId]
          : null
      modelingResponse.data.faces.forEach((face) => {
        if (
          face.cap !== 'none' &&
          face.face_id &&
          parent?.type === 'startPath'
        ) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              type: 'extrudeCap',
              cap: face.cap === 'bottom' ? 'start' : 'end',
              range: parent.range,
              pathToNode: parent.pathToNode,
              pathId:
                edgeArtifact?.type === 'segment' ? edgeArtifact.pathId : '',
            },
          })
        }
        const curveArtifact = prevArtifactMap[face?.curve_id || '']
        if (curveArtifact?.type === 'segment' && face?.face_id) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              type: 'extrudeWall',
              range: curveArtifact.range,
              pathToNode: curveArtifact.pathToNode,
              pathId: curveArtifact.pathId,
            },
          })
        }
      })
    }
  }
  return artifacts
}

export function createLinker({
  orderedCommands,
  responseMap,
  ast,
}: {
  orderedCommands: Array<OrderedCommand>
  responseMap: ResponseMap
  ast: Program
}) {
  const myMap = new Map<string, ArtifactMapV2>()
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
          pathIds: [...existingPlane.pathIds, id],
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
      // if (
      //   response.type === 'modeling' &&
      //   response.data.modeling_response.type === 'close_path'
      // ) {
      //   // TODO: the face_id should be the solid2d face, which should be added to the artifactMap
      //   console.log(
      //     'close face_id should be solid2d',
      //     response.data.modeling_response.data.face_id
      //   )
      // }
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
      response.data.modeling_response.data.faces.forEach(
        ({ curve_id, cap, face_id }) => {
          if (cap === 'none' && curve_id && face_id) {
            const path = myMap.get(cmd.object_id)
            const seg = myMap.get(curve_id)
            if (path?.type === 'path' && seg?.type === 'segment') {
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
          } else if ((cap === 'top' || cap === 'bottom') && face_id) {
            const path = myMap.get(cmd.object_id)
            if (path?.type === 'path') {
              myMap.set(face_id, {
                type: 'cap',
                subType: cap === 'bottom' ? 'start' : 'end',
                blendEdgeIds: [],
                extrusionId: path.extrusionId,
              })
              const extrusion = myMap.get(path.extrusionId)
              if (extrusion?.type !== 'extrusion') return
              myMap.set(path.extrusionId, {
                ...extrusion,
                surfIds: [...extrusion.surfIds, face_id],
              })
            }
          }
        }
      )
    } else if (cmd.type === 'solid3d_fillet_edge') {
      myMap.set(id, {
        type: 'blend',
        SubType: cmd.cut_type,
        consumedEdgeId: cmd.edge_id,
        edgeIds: [],
        surfId: '',
        codeRef: { range, pathToNode },
      })
    }
  })
  return myMap
}

/** filter map items of a specific type */
export function filterArtifacts<T extends ArtifactMapV2['type'][]>(
  map: Map<string, ArtifactMapV2>,
  types: T,
  predicate?: (value: Extract<ArtifactMapV2, { type: T[number] }>) => boolean
) {
  return new Map(
    Array.from(map).filter(
      ([_, value]) =>
        types.includes(value.type) &&
        (!predicate ||
          predicate(value as Extract<ArtifactMapV2, { type: T[number] }>))
    )
  ) as Map<string, Extract<ArtifactMapV2, { type: T[number] }>>
}

export function getArtifactsOfType<T extends ArtifactMapV2['type'][]>(
  keys: string[],
  map: Map<string, ArtifactMapV2>,
  types: T,
  predicate?: (value: Extract<ArtifactMapV2, { type: T[number] }>) => boolean
): Map<string, Extract<ArtifactMapV2, { type: T[number] }>> {
  return new Map(
    [...map].filter(
      ([key, value]) =>
        keys.includes(key) &&
        types.includes(value.type) &&
        (!predicate ||
          predicate(value as Extract<ArtifactMapV2, { type: T[number] }>))
    )
  ) as Map<string, Extract<ArtifactMapV2, { type: T[number] }>>
}

function getArtifactOfType<T extends ArtifactMapV2['type']>(
  key: string,
  map: Map<string, ArtifactMapV2>,
  type: T
): Extract<ArtifactMapV2, { type: T }> | Error {
  const artifact = map.get(key)
  if (artifact?.type !== type)
    return new Error(`Expected ${type} but got ${artifact?.type}`)
  return artifact as Extract<ArtifactMapV2, { type: T }>
}

export function getArtifactOfTypes<T extends ArtifactMapV2['type'][]>(
  key: string,
  map: Map<string, ArtifactMapV2>,
  types: T
): Extract<ArtifactMapV2, { type: T[number] }> | Error {
  const artifact = map.get(key)
  if (!artifact) return new Error(`No artifact found with key ${key}`)
  if (!types.includes(artifact?.type))
    return new Error(`Expected ${types} but got ${artifact?.type}`)
  return artifact as Extract<ArtifactMapV2, { type: T[number] }>
}

export function expandPlane(
  plane: _PlaneArtifact,
  artifactMap: Map<string, ArtifactMapV2>
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
  artifactMap: Map<string, ArtifactMapV2>
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
  artifactMap: Map<string, ArtifactMapV2>
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

export function getCapCodeRef(
  cap: _CapArtifact,
  artifactMap: Map<string, ArtifactMapV2>
): CommonCommandProperties | Error {
  const extrusion = getArtifactOfType(cap.extrusionId, artifactMap, 'extrusion')
  if (err(extrusion)) return extrusion
  const path = getArtifactOfType(extrusion.pathId, artifactMap, 'path')
  if (err(path)) return path
  return path.codeRef
}

export function getWallCodeRef(
  wall: _WallArtifact,
  artifactMap: Map<string, ArtifactMapV2>
): CommonCommandProperties | Error {
  const seg = getArtifactOfType(wall.segId, artifactMap, 'segment')
  if (err(seg)) return seg
  return seg.codeRef
}

export function getExtrusionFromSuspectedExtrudeSurface(
  id: string,
  artifactMap: Map<string, ArtifactMapV2>
): _ExtrusionArtifact | Error {
  const artifact = getArtifactOfTypes(id, artifactMap, ['wall', 'cap'])
  if (err(artifact)) return artifact
  return getArtifactOfTypes(artifact.extrusionId, artifactMap, ['extrusion'])
}

export function getExtrusionFromSuspectedPath(
  id: string,
  artifactMap: Map<string, ArtifactMapV2>
): _ExtrusionArtifact | Error {
  const path = getArtifactOfTypes(id, artifactMap, ['path'])
  if (err(path)) return path
  return getArtifactOfTypes(path.extrusionId, artifactMap, ['extrusion'])
}
