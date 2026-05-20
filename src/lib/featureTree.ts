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
  getArtifactsMatchingPathToNode,
  getArtifactFromRange,
} from '@src/lang/std/artifactGraph'
import type { ActorRefFrom } from 'xstate'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { sourceRangeToUtf16 } from '@src/lang/errors'

export interface FeatureTreeVisibilityState {
  canToggleVisibility: boolean
  hideOperation?: HideOperation
  targetArtifact?: Artifact
}

export function resolveFeatureTreeVisibility(input: {
  item: Operation
  operations: Operation[]
  artifactGraph: ArtifactGraph
}): FeatureTreeVisibilityState {
  const { item, operations, artifactGraph } = input

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

  if (item.type === 'GroupBegin' && item.group.type === 'SketchBlock') {
    const artifact = getArtifactFromRange(item.sourceRange, artifactGraph)
    if (artifact?.type !== 'sketchBlock') {
      return { canToggleVisibility: false }
    }

    return {
      canToggleVisibility: true,
      hideOperation: findSketchHideOperation({
        sketchBlockArtifact: artifact,
        operations,
        artifactGraph,
      }),
      targetArtifact: artifact,
    }
  }

  return { canToggleVisibility: false }
}

function findSketchHideOperation(input: {
  sketchBlockArtifact: Extract<Artifact, { type: 'sketchBlock' }>
  operations: Operation[]
  artifactGraph: ArtifactGraph
}): HideOperation | undefined {
  const { sketchBlockArtifact, operations, artifactGraph } = input
  const directSketchHide = getHideOpByArtifactId(
    operations,
    sketchBlockArtifact.id
  )
  if (directSketchHide) {
    return directSketchHide
  }

  for (const artifact of getArtifactsMatchingPathToNode(
    sketchBlockArtifact.codeRef.pathToNode,
    artifactGraph
  )) {
    if (artifact.id === sketchBlockArtifact.id) {
      continue
    }

    const hideOperation = getHideOpByArtifactId(operations, artifact.id)
    if (hideOperation) {
      return hideOperation
    }
  }

  return undefined
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
