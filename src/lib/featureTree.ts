import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { KclManager } from '@src/lang/KclManager'
import { sourceRangeToUtf16 } from '@src/lang/errors'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from '@src/lang/modifyAst/deleteSelection'
import { artifactToEntityRef, findOperationArtifact } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  codeRefFromRange,
  getArtifactFromRange,
  getArtifactsMatchingPathToNode,
} from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  type EnterEditFlowProps,
  type HideOperation,
  enterEditFlow,
  getHideOpByArtifactId,
} from '@src/lib/operations'
import type RustContext from '@src/lib/rustContext'
import { err } from '@src/lib/trap'
import { type CommandBarActorType } from '@src/machines/commandBarMachine'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { ActorRefFrom } from 'xstate'

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

export function sendSelectionEvent(input: {
  sourceRange: SourceRange
  kclManager: KclManager
  modelingSend: ActorRefFrom<typeof modelingMachine>['send']
  /** When clicking an operation in the feature tree, pass e.g. 'helix' so we resolve that artifact type */
  preferredArtifactType?: Artifact['type']
}) {
  const artifact =
    getArtifactFromRange(
      input.sourceRange,
      input.kclManager.artifactGraph,
      input.preferredArtifactType
    ) ?? undefined
  // Artifact graph uses byte-offset ranges; editor/codeRef use UTF-16. Use raw range for artifact lookup, UTF-16 for codeRef.
  const codeRef = codeRefFromRange(
    sourceRangeToUtf16(input.sourceRange, input.kclManager.code),
    input.kclManager.ast
  )
  let entityRef = artifact
    ? artifactToEntityRef(
        artifact.type,
        artifact.id,
        artifact.type === 'segment'
          ? (artifact as { pathId: string }).pathId
          : undefined
      )
    : undefined
  if (artifact && !entityRef) {
    if (artifact.type === 'path') {
      entityRef = { type: 'solid2d', solid2d_id: String(artifact.id) }
    } else if (artifact.type === 'helix') {
      entityRef = { type: 'solid2d_edge', edge_id: String(artifact.id) }
    }
  }

  const selection = { entityRef, codeRef }

  input.modelingSend({
    type: 'Set selection',
    data: {
      selectionType: 'singleCodeCursor',
      selection,
      scrollIntoView: true,
    },
  })
}
