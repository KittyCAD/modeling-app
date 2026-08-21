import type { MlToolResult } from '@kittycad/lib'
import type { FileEntry } from '@src/lib/project'
import type { MlEphantManagerActor } from '@src/lib/zookeeper/mlEphantManagerMachine'
import type { RequestedKCLFileDelete } from '@src/machines/systemIO/utils'
import type { ConnectionManager } from '@src/network/connectionManager'

export interface MlEphantNewFileRequestProps {
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
  filesToDelete?: RequestedKCLFileDelete[]
  exchangeId?: number
}

// Watch MlEphant for any responses that require files to be created.
export const watchForNewFileRequestsFromMlEphant = (
  mlEphantManagerActor: MlEphantManagerActor,
  getEngineCommandManager: () => ConnectionManager | undefined,
  fn: (props: MlEphantNewFileRequestProps) => void
) => {
  let lastId: number | undefined
  const subscription = mlEphantManagerActor.subscribe((next) => {
    if (next.context.lastMessageId === lastId) {
      return
    }
    lastId = next.context.lastMessageId

    if (next.context.lastMessageType === 'delta') {
      return
    }

    const exchanges = next.context.conversation?.exchanges ?? []
    const lastExchange = exchanges[exchanges.length - 1]
    if (lastExchange === undefined) {
      return
    }
    const lastResponse = (lastExchange.responses ?? []).slice(-1)[0] ?? {}
    if (!('tool_output' in lastResponse)) {
      return
    }

    // We don't know what project to write to, so do nothing.
    if (!next.context.projectNameCurrentlyOpened) {
      return
    }

    const fileNamesToDelete = new Set(
      lastExchange.responses.flatMap((response) => {
        if (!('reasoning' in response)) {
          return []
        }
        if (
          response.reasoning.type !== 'deleted_kcl_file' &&
          response.reasoning.type !== 'deleted_project_file'
        ) {
          return []
        }
        return response.reasoning.file_name
      })
    )

    fn({
      toolOutput: lastResponse.tool_output.result,
      projectNameCurrentlyOpened: next.context.projectNameCurrentlyOpened,
      fileFocusedOnInEditor: next.context.fileFocusedOnInEditor,
      filesToDelete: Array.from(fileNamesToDelete, (requestedFileName) => ({
        requestedFileName,
      })),
      exchangeId: exchanges.length - 1,
    })

    // Clear selections since new model
    getEngineCommandManager()?.modelingSend({
      type: 'Set selection',
      data: { selection: undefined, selectionType: 'singleCodeCursor' },
    })
  })

  return () => {
    subscription.unsubscribe()
  }
}
