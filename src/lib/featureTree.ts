import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { KclManager } from '@src/lang/KclManager'
import type { Artifact, SourceRange } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  deletionErrorMessage,
  deleteSelectionPromise,
} from '@src/lang/modifyAst/deleteSelection'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { err } from '@src/lib/trap'
import { type CommandBarActorType } from '@src/machines/commandBarMachine'
import { type EnterEditFlowProps, enterEditFlow } from '@src/lib/operations'

export function sendDeleteCommand(input: {
  artifact: Artifact | undefined
  targetSourceRange: SourceRange | undefined
  systemDeps: {
    kclManager: KclManager
    rustContext: RustContext
    sceneEntitiesManager: SceneEntities
  }
}) {
  return new Promise((resolve, reject) => {
    const { targetSourceRange, artifact } = input
    if (!targetSourceRange) {
      reject(new Error(deletionErrorMessage))
      return
    }

    const pathToNode = getNodePathFromSourceRange(
      input.systemDeps.kclManager.ast,
      targetSourceRange
    )
    const selection = {
      codeRef: {
        range: targetSourceRange,
        pathToNode,
      },
      artifact,
    }
    deleteSelectionPromise({ selection, systemDeps: input.systemDeps })
      .then((result) => {
        if (err(result)) {
          reject(result)
          return
        }
        resolve(result)
      })
      .catch(reject)
  })
}

export function prepareEditCommand(
  input: EnterEditFlowProps & {
    commandBarSend: CommandBarActorType['send']
  }
) {
  return new Promise((resolve, reject) => {
    const { commandBarSend, ...editFlowProps } = input
    enterEditFlow(editFlowProps)
      .then((result) => {
        if (err(result)) {
          reject(result)
          return
        }
        input.commandBarSend(result)
        resolve(result)
      })
      .catch(reject)
  })
}
