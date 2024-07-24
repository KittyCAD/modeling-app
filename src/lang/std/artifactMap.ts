import { PathToNode, Program, SourceRange } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAst'

interface CommonCommandProperties {
  range: SourceRange
  pathToNode: PathToNode
}

interface ExtrudeArtifact extends CommonCommandProperties {
  commandType: 'extrude'
  target: string
  parentId: string
}

interface startPathArtifact extends CommonCommandProperties {
  commandType: 'startPath'
  extrusions: string[]
  parentId?: string
}

interface SegmentArtifact extends CommonCommandProperties {
  commandType: 'segment'
  parentId: string
}
interface CloseArtifact extends CommonCommandProperties {
  commandType: 'closeSegment'
  parentId: string
}

interface ExtrudeCapArtifact extends CommonCommandProperties {
  commandType: 'extrudeCap'
  additionalData: {
    type: 'cap'
    info: 'start' | 'end'
  }
  parentId?: string
}
interface ExtrudeWallArtifact extends CommonCommandProperties {
  commandType: 'extrudeWall'
  parentId?: string
}

interface OtherShit extends CommonCommandProperties {
  commandType: 'otherShit'
  parentId?: string
}

export type ArtifactMapCommand =
  | ExtrudeArtifact
  | startPathArtifact
  | ExtrudeCapArtifact
  | ExtrudeWallArtifact
  | SegmentArtifact
  | CloseArtifact
  | OtherShit

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
      const artifact = {
        range: range,
        pathToNode,
        commandType: 'otherShit',
        parentId: '',
      } as ArtifactMapCommand
      artifacts.push({
        commandId: id,
        artifact,
      })
    }
    if (command2.type === 'extrude') {
      artifacts.push({
        commandId: id,
        artifact: {
          commandType: 'extrude',
          range,
          pathToNode,
          target: command2.target,
          parentId: command2.target,
        },
      })

      const targetArtifact = { ...prevArtifactMap[command2.target] }
      if (targetArtifact?.commandType === 'startPath') {
        artifacts.push({
          commandId: command2.target,
          artifact: {
            ...targetArtifact,
            commandType: 'startPath',
            range: targetArtifact.range,
            pathToNode: targetArtifact.pathToNode,
            parentId: targetArtifact.parentId,
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
          commandType: 'segment',
          range,
          pathToNode,
          parentId: command2.path,
        },
      })
    }
    if (command2.type === 'close_path')
      artifacts.push({
        commandId: id,
        artifact: {
          commandType: 'closeSegment',
          range,
          pathToNode,
          parentId: command2.path_id,
        },
      })
    if (command2.type === 'start_path') {
      artifacts.push({
        commandId: id,
        artifact: {
          commandType: 'startPath',
          range,
          pathToNode,
          extrusions: [],
          parentId: '',
        },
      })
    }
    if (
      (command2.type === 'entity_linear_pattern' &&
        modelingResponse.type === 'entity_linear_pattern') ||
      (command2.type === 'entity_circular_pattern' &&
        modelingResponse.type === 'entity_circular_pattern')
    ) {
      const entities = modelingResponse.data.entity_ids
      entities?.forEach((entity: string) => {
        artifacts.push({
          commandId: entity,
          artifact: {
            range: range,
            pathToNode,
            commandType: 'otherShit',
            parentId: '',
          } as ArtifactMapCommand,
        })
      })
    }
    if (
      command2.type === 'solid3d_get_extrusion_face_info' &&
      modelingResponse.type === 'solid3d_get_extrusion_face_info'
    ) {
      const edgeArtifact = prevArtifactMap[command2.edge_id]
      const parent =
        edgeArtifact?.commandType === 'segment'
          ? prevArtifactMap[edgeArtifact.parentId]
          : null
      modelingResponse.data.faces.forEach((face) => {
        if (
          face.cap !== 'none' &&
          face.face_id &&
          parent?.commandType === 'startPath'
        ) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              ...parent,
              commandType: 'extrudeCap',
              additionalData: {
                type: 'cap',
                info: face.cap === 'bottom' ? 'start' : 'end',
              },
            },
          })
        }
        const curveArtifact = prevArtifactMap[face?.curve_id || '']
        if (curveArtifact && face?.face_id) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              ...curveArtifact,
              commandType: 'extrudeWall',
            },
          })
        }
      })
    }
  } else if (command) {
    artifacts.push({
      commandId: id,
      artifact: {
        commandType: command2.type,
        range,
        pathToNode,
      } as ArtifactMapCommand & { extrusions?: string[] },
    })
  }
  return artifacts
}
