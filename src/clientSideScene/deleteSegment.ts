import toast from 'react-hot-toast'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { confirmModal } from '@src/clientSideScene/confirmModal'
import { executeAstMock } from '@src/lang/langHelpers'
import { deleteSegmentOrProfileFromPipeExpression } from '@src/lang/modifyAst'
import {
  findUsesOfTagInPipe,
  getNodeFromPath,
  stringifyPathToNode,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { parse, recast, resultIsOk } from '@src/lang/wasm'
import { err, isErr } from '@src/lib/trap'
import type { SketchDetails } from '@src/machines/modelingSharedTypes'

import { getConstraintInfoKw } from '@src/lang/std/sketch'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import {
  getEventForSegmentSelection,
  updateExtraSegments,
} from '@src/lib/selections'

import { getPathsFromArtifact } from '@src/lang/std/artifactGraph'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type RustContext from '@src/lib/rustContext'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

export async function deleteSegmentOrProfile({
  pathToNode,
  sketchDetails,
  dependencies
}: {
  pathToNode: PathToNode
  sketchDetails: SketchDetails | null,
  dependencies: {
    kclManager: KclManager,
    codeManager: CodeManager,
    wasmInstance?: ModuleType,
    rustContext: RustContext,
    sceneEntitiesManager: SceneEntities,
    sceneInfra: SceneInfra
  }
}) {
  console.log('I GOT HERE!!')
  let modifiedAst: Node<Program> | Error = dependencies.kclManager.ast
  const dependentRanges = findUsesOfTagInPipe(modifiedAst, pathToNode)

  const shouldContinueSegDelete = dependentRanges.length
    ? await confirmModal({
      text: `At least ${dependentRanges.length} segment rely on the segment you're deleting.\nDo you want to continue and unconstrain these segments?`,
      isOpen: true,
    })
    : true

  if (!shouldContinueSegDelete) return

  modifiedAst = deleteSegmentOrProfileFromPipeExpression(
    dependentRanges,
    modifiedAst,
    dependencies.kclManager.variables,
    dependencies.codeManager.code,
    pathToNode,
    getConstraintInfoKw,
    removeSingleConstraint,
    transformAstSketchLines
  )
  if (err(modifiedAst)) return Promise.reject(modifiedAst)

  const newCode = recast(modifiedAst, dependencies.wasmInstance)
  const pResult = parse(newCode, dependencies.wasmInstance)
  if (err(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
  modifiedAst = pResult.program

  const testExecute = await executeAstMock({
    ast: modifiedAst,
    usePrevMemory: false,
    rustContext: dependencies.rustContext,
  })
  if (testExecute.errors.length) {
    toast.error('Segment tag used outside of current Sketch. Could not delete.')
    return
  }

  if (!sketchDetails) {
    return
  }

  sketchDetails = updateSketchDetails(
    modifiedAst,
    testExecute.execState.artifactGraph,
    sketchDetails
  )

  await dependencies.sceneEntitiesManager.updateAstAndRejigSketch(
    sketchDetails.sketchEntryNodePath,
    sketchDetails.sketchNodePaths,
    sketchDetails.planeNodePath,
    modifiedAst,
    sketchDetails.zAxis,
    sketchDetails.yAxis,
    sketchDetails.origin,
    getEventForSegmentSelection,
    updateExtraSegments
  )

  // Update the machine context.sketchDetails so subsequent interactions use fresh paths
  dependencies.sceneInfra.modelingSend({
    type: 'Update sketch details',
    data: {
      sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
      sketchNodePaths: sketchDetails.sketchNodePaths,
      planeNodePath: sketchDetails.planeNodePath,
    },
  })
}

// Updates stale sketchDetails after an AST modification, typically when deleting top level statements which can cause
// sketchNodePaths and sketchEntryNodePath to become invalid in the new artifactgraph.
// Fixes sketchEntryNodePath, sketchNodePaths and planeNodePath if needed.
function updateSketchDetails(
  modifiedAst: Node<Program>,
  artifactGraph: ArtifactGraph,
  sketchDetails: SketchDetails
): SketchDetails {
  const planeNodePath = stringifyPathToNode(sketchDetails.planeNodePath)
  let planeArtifact = artifactGraph.values().find((artifact) => {
    return (
      artifact.type === 'plane' &&
      stringifyPathToNode(artifact.codeRef.pathToNode) === planeNodePath
    )
  })
  if (!planeArtifact) {
    console.warn(
      'Could not find plane artifact for sketch with path',
      planeNodePath
    )
    planeArtifact = artifactGraph.values().find((artifact) => {
      return artifact.type === 'plane'
    })
  }
  if (planeArtifact?.type !== 'plane') {
    console.error('Could not find plane artifact for sketch')
  }

  let sketchEntryNodePath = sketchDetails.sketchEntryNodePath

  try {
    const entryNode = getNodeFromPath(
      modifiedAst,
      sketchEntryNodePath,
      undefined,
      undefined,
      true
    )
    if (isErr(entryNode)) {
      // sketchEntryNodePath is not valid anymore in the new AST (could have been deleted just now) -> find a valid path
      sketchEntryNodePath =
        artifactGraph.values().find((artifact) => {
          return artifact.type === 'path'
        })?.codeRef.pathToNode || []
    }
  } catch (e) {
    console.log(e)
  }

  let sketchNodePaths = getPathsFromArtifact({
    artifact: planeArtifact,
    sketchPathToNode: sketchEntryNodePath,
    artifactGraph: artifactGraph,
    ast: modifiedAst,
  })
  if (err(sketchNodePaths)) {
    console.error(sketchNodePaths)
    sketchNodePaths = sketchDetails.sketchNodePaths
  }

  return {
    sketchEntryNodePath,
    sketchNodePaths,
    planeNodePath:
      planeArtifact?.type === 'plane'
        ? planeArtifact.codeRef.pathToNode
        : sketchDetails.planeNodePath,
    zAxis: sketchDetails.zAxis,
    yAxis: sketchDetails.yAxis,
    origin: sketchDetails.origin,
    animateTargetId: sketchDetails.animateTargetId,
    expressionIndexToDelete: sketchDetails.expressionIndexToDelete,
  }
}
