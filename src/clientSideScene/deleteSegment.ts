import toast from 'react-hot-toast'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { confirmModal } from '@src/clientSideScene/confirmModal'
import { executeAstMock } from '@src/lang/langHelpers'
import { deleteSegmentOrTopLevelStatementFromPipeExpression } from '@src/lang/modifyAst'
import {
  findUsesOfTagInPipe,
  getNodeFromPath,
  stringifyPathToNode,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { parse, recast, resultIsOk } from '@src/lang/wasm'
import {
  codeManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
  sceneInfra,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { SketchDetails } from '@src/machines/modelingSharedTypes'
import { getPathsFromArtifact } from '@src/lang/std/artifactGraph'

export async function deleteSegmentOrTopLevelStatement({
  pathToNode,
  sketchDetails,
}: {
  pathToNode: PathToNode
  sketchDetails: SketchDetails | null
}) {
  let modifiedAst: Node<Program> | Error = kclManager.ast
  const dependentRanges = findUsesOfTagInPipe(modifiedAst, pathToNode)

  const shouldContinueSegDelete = dependentRanges.length
    ? await confirmModal({
        text: `At least ${dependentRanges.length} segment rely on the segment you're deleting.\nDo you want to continue and unconstrain these segments?`,
        isOpen: true,
      })
    : true

  if (!shouldContinueSegDelete) return

  modifiedAst = deleteSegmentOrTopLevelStatementFromPipeExpression(
    dependentRanges,
    modifiedAst,
    kclManager.variables,
    codeManager.code,
    pathToNode
  )
  if (err(modifiedAst)) return Promise.reject(modifiedAst)

  const newCode = recast(modifiedAst)
  const pResult = parse(newCode)
  if (err(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
  modifiedAst = pResult.program

  const testExecute = await executeAstMock({
    ast: modifiedAst,
    usePrevMemory: false,
    rustContext: rustContext,
  })
  if (testExecute.errors.length) {
    toast.error('Segment tag used outside of current Sketch. Could not delete.')
    return
  }

  if (!sketchDetails) return
  try {
    sketchDetails = updateSketchDetails(
      modifiedAst,
      testExecute.execState.artifactGraph,
      sketchDetails
    )

    await sceneEntitiesManager.updateAstAndRejigSketch(
      sketchDetails.sketchEntryNodePath,
      sketchDetails.sketchNodePaths,
      sketchDetails.planeNodePath,
      modifiedAst,
      sketchDetails.zAxis,
      sketchDetails.yAxis,
      sketchDetails.origin
    )
    // } else {
    //   // If there are no sketchNodePaths left, just tear down the sketch because updateAstAndRejigSketch and setupSketch
    //   // doesn't work well if sketchNodePaths is empty. Similar to:
    //   // https://github.com/KittyCAD/modeling-app/pull/8368/files#diff-5b3927b16824249515f7aa8762bd6c9c9ba641a023bb6d0a75b75331326cf4aaR1916-R1917
    //   sceneInfra.resetMouseListeners()
    //   sceneEntitiesManager.tearDownSketch({ removeAxis: false })
    // }

    // Update the machine context.sketchDetails so subsequent interactions use fresh paths
    sceneInfra.modelingSend({
      type: 'Update sketch details',
      data: {
        sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
        sketchNodePaths: sketchDetails.sketchNodePaths,
        planeNodePath: sketchDetails.planeNodePath,
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_err) {
    console.warn(_err)
    // When deleting the last startProfile in a sketch, the above updateAstAndRejigSketch fails because prepareTruncatedAst
    // calls getNodeFromPath with a path that no longer exists (we just deleted it)..
  }
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
    let entryNode = getNodeFromPath(
      modifiedAst,
      sketchEntryNodePath,
      undefined,
      undefined,
      true
    )
    if (err(entryNode)) {
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
