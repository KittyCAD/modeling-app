import { PathToNode, Program, SourceRange } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAst'

interface CommonCommandProperties {
  range: SourceRange
  pathToNode: PathToNode
}

interface ExtrudeArtifact extends CommonCommandProperties {
  type: 'extrude'
  target: string
}

export interface StartPathArtifact extends CommonCommandProperties {
  type: 'startPath'
  extrusions: string[]
}

export interface SegmentArtifact extends CommonCommandProperties {
  type: 'segment'
  subType: 'segment' | 'closeSegment'
  pathId: string
}

interface ExtrudeCapArtifact extends CommonCommandProperties {
  type: 'extrudeCap'
  additionalData: {
    type: 'cap'
    info: 'start' | 'end'
  }
  segmentId: string
}
interface ExtrudeWallArtifact extends CommonCommandProperties {
  type: 'extrudeWall'
  segmentId: string
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
          target: command2.target,
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
            extrusions: targetArtifact?.extrusions
              ? [...targetArtifact?.extrusions, id]
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
          extrusions: [],
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
              // ...parent,
              type: 'extrudeCap',
              additionalData: {
                type: 'cap',
                info: face.cap === 'bottom' ? 'start' : 'end',
              },
              range: parent.range,
              pathToNode: parent.pathToNode,
              segmentId:
                edgeArtifact?.type === 'segment' ? edgeArtifact.pathId : '',
            },
          })
        }
        const curveArtifact = prevArtifactMap[face?.curve_id || '']
        if (curveArtifact?.type === 'segment' && face?.face_id) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              ...curveArtifact,
              type: 'extrudeWall',
              range: curveArtifact.range,
              pathToNode: curveArtifact.pathToNode,
              segmentId: curveArtifact.pathId,
            },
          })
        }
      })
    }
  }
  return artifacts
}
