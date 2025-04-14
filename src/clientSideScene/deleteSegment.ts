import toast from 'react-hot-toast'

import type { Node } from '@rust/kcl-lib/bindings/Node'

import { confirmModal } from '@src/clientSideScene/confirmModal'
import { executeAstMock } from '@src/lang/langHelpers'
import { deleteSegmentFromPipeExpression } from '@src/lang/modifyAst'
import { findUsesOfTagInPipe } from '@src/lang/queryAst'
import type { PathToNode, Program } from '@src/lang/wasm'
import { parse, recast, resultIsOk } from '@src/lang/wasm'
import {
  codeManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { SketchDetails } from '@src/machines/modelingMachine'

export async function deleteSegment({
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

  modifiedAst = deleteSegmentFromPipeExpression(
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
  await sceneEntitiesManager.updateAstAndRejigSketch(
    pathToNode,
    sketchDetails.sketchNodePaths,
    sketchDetails.planeNodePath,
    modifiedAst,
    sketchDetails.zAxis,
    sketchDetails.yAxis,
    sketchDetails.origin
  )

  // Now 'Set sketchDetails' is called with the modified pathToNode
}
