import { PathToNode, Program, SourceRange } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import { getNodePathFromSourceRange } from 'lang/queryAst'

type CommandTypes = Models['ModelingCmd_type']['type'] | 'batch'

export type ArtifactMapCommand =
  | {
      commandType: 'extrude'
      range: SourceRange
      pathToNode: PathToNode
      target: string
      parentId?: string
    }
  | {
      commandType: 'start_path'
      range: SourceRange
      pathToNode: PathToNode
      extrusions: string[]
      parentId?: string
    }
  | {
      commandType: CommandTypes
      range: SourceRange
      pathToNode: PathToNode
      parentId?: string
      additionalData?:
        | {
            type: 'cap'
            info: 'start' | 'end'
          }
        | {
            type: 'batch-ids'
            ids: string[]
            info?: null
          }
    }

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
  const getParentId = (): string | undefined => {
    if (command2.type === 'extend_path') return command2.path
    if (command2.type === 'solid3d_get_extrusion_face_info') {
      const edgeArtifact = prevArtifactMap[command2.edge_id]
      // edges's parent id is to the original "start_path" artifact
      if (edgeArtifact && edgeArtifact.parentId) {
        return edgeArtifact.parentId
      }
    }
    if (command2.type === 'close_path') return command2.path_id
    if (command2.type === 'extrude') return command2.target
    // handle other commands that have a parent here
  }
  const modelingResponse = response.data.modeling_response

  const artifacts: Array<{
    commandId: string
    artifact: ArtifactMapCommand
  }> = []

  if (command) {
    const parentId = getParentId()
    const artifact = {
      range: range,
      pathToNode,
      commandType: command.command.cmd.type,
      parentId: parentId,
    } as ArtifactMapCommand & { extrusions?: string[] }
    artifacts.push({
      commandId: id,
      artifact,
    })
    if (command2.type === 'extrude') {
      ;(artifact as any).target = command2.target
      if (prevArtifactMap[command2.target]?.commandType === 'start_path') {
        const theArtifact = { ...prevArtifactMap[command2.target] }
        if ((theArtifact as any)?.extrusions?.length) {
          ;(theArtifact as any).extrusions.push(id)
        } else {
          ;(theArtifact as any).extrusions = [id]
        }
        artifacts.push({
          commandId: command2.target,
          artifact: theArtifact,
        })
      }
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
          artifact,
        })
      })
    }
    if (
      command2.type === 'solid3d_get_extrusion_face_info' &&
      modelingResponse.type === 'solid3d_get_extrusion_face_info'
    ) {
      const parent = prevArtifactMap[parentId || '']
      modelingResponse.data.faces.forEach((face) => {
        if (face.cap !== 'none' && face.face_id && parent) {
          artifacts.push({
            commandId: face.face_id,
            artifact: {
              ...parent,
              commandType: 'solid3d_get_extrusion_face_info',
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
              commandType: 'solid3d_get_extrusion_face_info',
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
