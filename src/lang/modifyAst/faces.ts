import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { mutateAstWithTagForSketchSegment } from '@src/lang/modifyAst/addEdgeTreatment'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'

export function addShell({
  ast,
  artifactGraph,
  solids,
  faces,
  thickness,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  faces: Selections
  thickness: KclCommandValue
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const facesExprs = getFacesExprsFromSelection(
    modifiedAst,
    faces,
    artifactGraph
  )
  const facesExpr = createVariableExpressionsArray(facesExprs)
  if (!facesExpr) {
    return new Error('No faces found in the selection')
  }

  const call = createCallExpressionStdLibKw('shell', sketchesExpr, [
    createLabeledArg('faces', facesExpr),
    createLabeledArg('thickness', valueOrVariable(thickness)),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in thickness && thickness.variableName) {
    insertVariableAndOffsetPathToNode(thickness, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst(
    modifiedAst,
    call,
    nodeToEdit,
    vars.pathIfPipe
  )
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

function getFacesExprsFromSelection(
  ast: Node<Program>,
  faces: Selections,
  artifactGraph: ArtifactGraph
) {
  return faces.graphSelections.flatMap((face) => {
    if (!face.artifact) {
      console.warn('No artifact found for face', face)
      return []
    }
    const artifact = face.artifact
    if (artifact.type === 'cap') {
      return createLiteral(artifact.subType)
    } else if (artifact.type === 'wall') {
      const key = artifact.segId
      const segmentArtifact = getArtifactOfTypes(
        { key, types: ['segment'] },
        artifactGraph
      )
      if (err(segmentArtifact) || segmentArtifact.type !== 'segment') {
        console.warn('No segment found for face', face)
        return []
      }

      const tagResult = mutateAstWithTagForSketchSegment(
        ast,
        segmentArtifact.codeRef.pathToNode
      )
      if (err(tagResult)) {
        console.warn(
          'Failed to mutate ast with tag for sketch segment',
          tagResult
        )
        return []
      }

      return createLocalName(tagResult.tag)
    } else {
      console.warn('Face was not a cap or wall', face)
      return []
    }
  })
}
