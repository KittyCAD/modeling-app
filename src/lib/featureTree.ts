import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { KclManager } from '@src/lang/KclManager'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  deletionErrorMessage,
  deleteSelectionPromise,
} from '@src/lang/modifyAst/deleteSelection'
import { findOperationArtifact } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { err } from '@src/lib/trap'
import { type CommandBarActorType } from '@src/machines/commandBarMachine'
import {
  type EnterEditFlowProps,
  enterEditFlow,
  getHideOpByArtifactId,
  type HideOperation,
} from '@src/lib/operations'
import {
  codeRefFromRange,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import type { ActorRefFrom } from 'xstate'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { sourceRangeToUtf16, toUtf16 } from '@src/lang/errors'

export interface FeatureTreeVisibilityState {
  canToggleVisibility: boolean
  hideOperation?: HideOperation
  targetArtifact?: Artifact
}

export function resolveFeatureTreeVisibility(input: {
  item: Operation
  variableName?: string
  operations: Operation[]
  artifactGraph: ArtifactGraph
  code: string
}): FeatureTreeVisibilityState {
  const { item, variableName, operations, artifactGraph, code } = input

  if (item.type === 'StdLibCall' && item.name === 'helix') {
    const operationArtifact = findOperationArtifact(item, artifactGraph)
    const hideOperation = operationArtifact
      ? getHideOpByArtifactId(operations, operationArtifact.id)
      : undefined
    return {
      canToggleVisibility: true,
      hideOperation,
      targetArtifact: operationArtifact ?? undefined,
    }
  }

  if (item.type !== 'SketchSolve') {
    return { canToggleVisibility: false }
  }

  const artifact = getArtifactFromRange(item.sourceRange, artifactGraph)
  if (artifact?.type !== 'sketchBlock') {
    return { canToggleVisibility: false }
  }

  const hideOperationByVariableName = variableName
    ? findHideOperationByVariableName({
        variableName,
        operations,
        code,
      })
    : undefined

  return {
    canToggleVisibility: true,
    hideOperation:
      hideOperationByVariableName ??
      getHideOpByArtifactId(operations, artifact.id),
    targetArtifact: artifact,
  }
}

function findHideOperationByVariableName(input: {
  variableName: string
  operations: Operation[]
  code: string
}): HideOperation | undefined {
  const { variableName, operations, code } = input
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const variablePattern = new RegExp(`\\b${escaped}\\b`)

  return operations.find((operation): operation is HideOperation => {
    if (!(operation.type === 'StdLibCall' && operation.name === 'hide')) {
      return false
    }
    if (!operation.unlabeledArg) {
      return false
    }
    const [start, end] = operation.unlabeledArg.sourceRange
    const argSource = code.slice(toUtf16(start, code), toUtf16(end, code))
    return variablePattern.test(argSource)
  })
}

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
