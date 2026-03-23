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
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import type { ActorRefFrom } from 'xstate'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { sourceRangeToUtf16 } from '@src/lang/errors'

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
    commandBarActor: CommandBarActorType
  }
) {
  return new Promise((resolve, reject) => {
    const { commandBarActor, ...editFlowProps } = input
    enterEditFlow(editFlowProps)
      .then((result) => {
        if (err(result)) {
          reject(result)
          return
        }
        commandBarActor.send(result)
        resolve(result)
      })
      .catch(reject)
  })
}

export function sendSelectionEvent(
  input: {
    sourceRange: SourceRange
    kclManager: KclManager
    modelingSend: ActorRefFrom<typeof modelingMachine>['send']
  },
  convertRangeToUtf16 = false
) {
  const artifact =
    getArtifactFromRange(input.sourceRange, input.kclManager.artifactGraph) ??
    undefined

  const selection = {
    codeRef: codeRefFromRange(
      convertRangeToUtf16
        ? sourceRangeToUtf16(input.sourceRange, input.kclManager.code)
        : input.sourceRange,
      input.kclManager.ast
    ),
    artifact,
  }

  input.modelingSend({
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection,
      scrollIntoView: true,
    },
  })
}
