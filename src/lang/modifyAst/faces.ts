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
  retrieveSelectionsFromOpArg,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { Selection, Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { mutateAstWithTagForSketchSegment } from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getSweepArtifactFromSelection,
} from '@src/lang/std/artifactGraph'
import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'

export function addShell({
  ast,
  artifactGraph,
  faces,
  thickness,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
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
  // Inferring solids from the faces selection, maybe someday we can expose this but no need for now
  const solids: Selections = {
    graphSelections: faces.graphSelections.flatMap((f) => {
      const sweep = getSweepArtifactFromSelection(f, artifactGraph)
      if (err(sweep) || !sweep) return []
      return {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }),
    otherSelections: [],
  }
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
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
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SHELL,
  })
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

// Sort of an opposite of getFacesExprsFromSelection above, used for edit flows
export function retrieveFaceSelectionsFromOpArgs(
  solidsArg: OpArg,
  facesArg: OpArg,
  artifactGraph: ArtifactGraph
) {
  const solids = retrieveSelectionsFromOpArg(solidsArg, artifactGraph)
  if (err(solids)) {
    return solids
  }

  // TODO: need to support multiple solids there
  const sweepArtifact = solids.graphSelections[0]?.artifact
  if (!sweepArtifact || sweepArtifact.type !== 'sweep') {
    return new Error('No sweep artifact found in solids selection')
  }
  const sweepId = sweepArtifact.id
  const candidates: Map<string, Selection> = new Map()
  for (const artifact of artifactGraph.values()) {
    if (
      artifact.type === 'cap' &&
      artifact.sweepId === sweepId &&
      artifact.subType
    ) {
      const codeRef = getCapCodeRef(artifact, artifactGraph)
      if (err(codeRef)) {
        return codeRef
      }

      candidates.set(artifact.subType, {
        artifact,
        codeRef,
      })
    } else if (
      artifact.type === 'wall' &&
      artifact.sweepId === sweepId &&
      artifact.segId
    ) {
      const segArtifact = getArtifactOfTypes(
        { key: artifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (err(segArtifact)) {
        return segArtifact
      }

      const { codeRef } = segArtifact
      candidates.set(artifact.segId, {
        artifact,
        codeRef,
      })
    }
  }

  // Loop over face value to retrieve the corresponding artifacts and build the graphSelections
  const faceValues: OpKclValue[] = []
  if (facesArg.value.type === 'Array') {
    faceValues.push(...facesArg.value.value)
  } else {
    faceValues.push(facesArg.value)
  }
  const graphSelections: Selection[] = []
  for (const v of faceValues) {
    if (v.type === 'String' && v.value && candidates.has(v.value)) {
      graphSelections.push(candidates.get(v.value)!)
    } else if (
      v.type === 'TagIdentifier' &&
      v.artifact_id &&
      candidates.has(v.artifact_id)
    ) {
      graphSelections.push(candidates.get(v.artifact_id)!)
    } else {
      console.warn('Face value is not a String or TagIdentifier', v)
      continue
    }
  }

  const faces = { graphSelections, otherSelections: [] }
  return { solids, faces }
}
