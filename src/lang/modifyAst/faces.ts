import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { OpArg, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
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
import { mutateAstWithTagForSketchSegment } from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getEdgeCutMeta,
  getSelectedPlaneAsNode,
  getVariableExprsFromSelection,
  retrieveSelectionsFromOpArg,
  valueOrVariable,
} from '@src/lang/queryAst'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getFaceCodeRef,
  getSweepFromSuspectedSweepSurface,
} from '@src/lang/std/artifactGraph'
import type {
  Artifact,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableMap,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type {
  Selection,
  Selections,
  EdgeCutInfo,
} from '@src/machines/modelingSharedTypes'

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
  const result = buildSolidsAndFacesExprs(
    faces,
    artifactGraph,
    modifiedAst,
    nodeToEdit
  )
  if (err(result)) {
    return result
  }

  const { solidsExpr, facesExpr, pathIfPipe } = result
  const call = createCallExpressionStdLibKw('shell', solidsExpr, [
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
    pathIfNewPipe: pathIfPipe,
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

export function addHole({
  ast,
  artifactGraph,
  face,
  cutAt,
  holeBody,
  blindDepth,
  blindDiameter,
  holeType,
  counterboreDepth,
  counterboreDiameter,
  countersinkAngle,
  countersinkDiameter,
  holeBottom,
  drillPointAngle,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  face: Selections
  cutAt: KclCommandValue
  holeBody: 'blind'
  blindDepth?: KclCommandValue
  blindDiameter?: KclCommandValue
  holeType: 'simple' | 'counterbore' | 'countersink'
  counterboreDepth?: KclCommandValue
  counterboreDiameter?: KclCommandValue
  countersinkAngle?: KclCommandValue
  countersinkDiameter?: KclCommandValue
  holeBottom: 'flat' | 'drill'
  drillPointAngle?: KclCommandValue
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
  // Setting this to 'false' is likely breaking hole on hole.
  // This is believed to be due to an empty nodePath and pathToNode on the subtract artifact,
  // see https://github.com/KittyCAD/modeling-app/issues/8616
  const lastChildLookup = false
  const result = buildSolidsAndFacesExprs(
    face,
    artifactGraph,
    modifiedAst,
    nodeToEdit,
    lastChildLookup
  )
  if (err(result)) {
    return result
  }

  const { solidsExpr, facesExpr, pathIfPipe } = result

  // Prep the big label args
  let holeBodyNode: Node<CallExpressionKw> | undefined
  if (holeBody === 'blind' && blindDepth && blindDiameter) {
    holeBodyNode = createCallExpressionStdLibKw('hole::blind', null, [
      createLabeledArg('depth', valueOrVariable(blindDepth)),
      createLabeledArg('diameter', valueOrVariable(blindDiameter)),
    ])
  } else {
    return new Error('Unsupported hole body type')
  }

  let holeBottomNode: Node<CallExpressionKw> | undefined
  if (holeBottom === 'flat') {
    holeBottomNode = createCallExpressionStdLibKw('hole::flat', null, [])
  } else if (holeBottom === 'drill' && drillPointAngle) {
    holeBottomNode = createCallExpressionStdLibKw('hole::drill', null, [
      createLabeledArg('pointAngle', valueOrVariable(drillPointAngle)),
    ])
  } else {
    return new Error('Unsupported hole bottom type or missing parameters')
  }

  let holeTypeNode: Node<CallExpressionKw> | undefined
  if (holeType === 'simple') {
    holeTypeNode = createCallExpressionStdLibKw('hole::simple', null, [])
  } else if (
    holeType === 'counterbore' &&
    counterboreDepth &&
    counterboreDiameter
  ) {
    holeTypeNode = createCallExpressionStdLibKw('hole::counterbore', null, [
      createLabeledArg('depth', valueOrVariable(counterboreDepth)),
      createLabeledArg('diameter', valueOrVariable(counterboreDiameter)),
    ])
  } else if (
    holeType === 'countersink' &&
    countersinkAngle &&
    countersinkDiameter
  ) {
    holeTypeNode = createCallExpressionStdLibKw('hole::countersink', null, [
      createLabeledArg('angle', valueOrVariable(countersinkAngle)),
      createLabeledArg('diameter', valueOrVariable(countersinkDiameter)),
    ])
  } else {
    return new Error('Unsupported hole type or missing parameters')
  }

  // TODO: should there be a createCallExpression for modules?
  const call = createCallExpressionStdLibKw('hole::hole', solidsExpr, [
    createLabeledArg('face', facesExpr),
    createLabeledArg('cutAt', valueOrVariable(cutAt)),
    createLabeledArg('holeBottom', holeBottomNode),
    createLabeledArg('holeBody', holeBodyNode),
    createLabeledArg('holeType', holeTypeNode),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in cutAt && cutAt.variableName) {
    insertVariableAndOffsetPathToNode(cutAt, modifiedAst, nodeToEdit)
  }
  if (blindDepth && 'variableName' in blindDepth && blindDepth.variableName) {
    insertVariableAndOffsetPathToNode(blindDepth, modifiedAst, nodeToEdit)
  }
  if (
    blindDiameter &&
    'variableName' in blindDiameter &&
    blindDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(blindDiameter, modifiedAst, nodeToEdit)
  }
  if (
    counterboreDepth &&
    'variableName' in counterboreDepth &&
    counterboreDepth.variableName
  ) {
    insertVariableAndOffsetPathToNode(counterboreDepth, modifiedAst, nodeToEdit)
  }
  if (
    counterboreDiameter &&
    'variableName' in counterboreDiameter &&
    counterboreDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      counterboreDiameter,
      modifiedAst,
      nodeToEdit
    )
  }
  if (
    countersinkAngle &&
    'variableName' in countersinkAngle &&
    countersinkAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(countersinkAngle, modifiedAst, nodeToEdit)
  }
  if (
    countersinkDiameter &&
    'variableName' in countersinkDiameter &&
    countersinkDiameter.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      countersinkDiameter,
      modifiedAst,
      nodeToEdit
    )
  }
  if (
    drillPointAngle &&
    'variableName' in drillPointAngle &&
    drillPointAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(drillPointAngle, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.HOLE,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addOffsetPlane({
  ast,
  artifactGraph,
  variables,
  plane,
  offset,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  plane: Selections
  offset: KclCommandValue
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
  let planeExpr: Expr | undefined
  const hasFaceToOffset = plane.graphSelections.some(
    (sel) =>
      sel.artifact?.type === 'cap' ||
      sel.artifact?.type === 'wall' ||
      sel.artifact?.type === 'edgeCut'
  )
  if (hasFaceToOffset) {
    const result = buildSolidsAndFacesExprs(
      plane,
      artifactGraph,
      modifiedAst,
      nodeToEdit
    )
    if (err(result)) {
      return result
    }

    const { solidsExpr, facesExpr } = result
    planeExpr = createCallExpressionStdLibKw('planeOf', solidsExpr, [
      createLabeledArg('face', facesExpr),
    ])
  } else {
    planeExpr = getSelectedPlaneAsNode(plane, variables)
    if (!planeExpr) {
      return new Error('No plane found in the selection')
    }
  }

  const call = createCallExpressionStdLibKw('offsetPlane', planeExpr, [
    createLabeledArg('offset', valueOrVariable(offset)),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in offset && offset.variableName) {
    insertVariableAndOffsetPathToNode(offset, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: undefined,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PLANE,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

// Utilities

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
    } else if (artifact.type === 'wall' || artifact.type === 'edgeCut') {
      let targetArtifact: Artifact | undefined
      let edgeCutMeta: EdgeCutInfo | null = null
      if (artifact.type === 'wall') {
        const key = artifact.segId
        const segmentArtifact = getArtifactOfTypes(
          { key, types: ['segment'] },
          artifactGraph
        )
        if (err(segmentArtifact) || segmentArtifact.type !== 'segment') {
          console.warn('No segment found for face', face)
          return []
        }

        targetArtifact = segmentArtifact
      } else {
        targetArtifact = artifact
        edgeCutMeta = getEdgeCutMeta(artifact, ast, artifactGraph)
      }

      const tagResult = mutateAstWithTagForSketchSegment(
        ast,
        targetArtifact.codeRef.pathToNode,
        edgeCutMeta
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
      console.warn('Face was not a cap or wall or chamfer', face)
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
      const result = candidates.get(v.value)
      if (result) {
        graphSelections.push(result)
      } else {
        console.warn(
          'retrieveFaceSelectionsFromOpArgs result is missing and not a selection'
        )
      }
    } else if (
      v.type === 'TagIdentifier' &&
      v.artifact_id &&
      candidates.has(v.artifact_id)
    ) {
      const result = candidates.get(v.artifact_id)
      if (result) {
        graphSelections.push(result)
      } else {
        console.warn(
          'retrieveFaceSelectionsFromOpArgs result from artifact_id is missing and not a selection'
        )
      }
    } else {
      console.warn('Face value is not a String or TagIdentifier', v)
      continue
    }
  }

  const faces = { graphSelections, otherSelections: [] }
  return { solids, faces }
}

export function retrieveNonDefaultPlaneSelectionFromOpArg(
  planeArg: OpArg,
  artifactGraph: ArtifactGraph
): Selections | Error {
  if (planeArg.value.type !== 'Plane') {
    return new Error(
      'Unsupported case for edit flows at the moment, check the KCL code'
    )
  }

  const planeArtifact = getArtifactOfTypes(
    {
      key: planeArg.value.artifact_id,
      types: ['plane', 'planeOfFace'],
    },
    artifactGraph
  )
  if (err(planeArtifact)) {
    return new Error("Couldn't retrieve plane or planeOfFace artifact")
  }

  if (planeArtifact.type === 'plane') {
    return {
      graphSelections: [
        {
          artifact: planeArtifact,
          codeRef: planeArtifact.codeRef,
        },
      ],
      otherSelections: [],
    }
  } else if (planeArtifact.type === 'planeOfFace') {
    const faceArtifact = getArtifactOfTypes(
      { key: planeArtifact.faceId, types: ['cap', 'wall', 'edgeCut'] },
      artifactGraph
    )
    if (err(faceArtifact)) {
      return new Error("Couldn't retrieve face artifact for planeOfFace")
    }

    const codeRef = getFaceCodeRef(faceArtifact)
    if (!codeRef) {
      return new Error("Couldn't retrieve code reference for face artifact")
    }

    return {
      graphSelections: [
        {
          artifact: faceArtifact,
          codeRef,
        },
      ],
      otherSelections: [],
    }
  }

  return new Error('Unsupported plane artifact type')
}

export function buildSolidsAndFacesExprs(
  faces: Selections,
  artifactGraph: ArtifactGraph,
  modifiedAst: Node<Program>,
  nodeToEdit?: PathToNode,
  lastChildLookup = true
) {
  const solids: Selections = {
    graphSelections: faces.graphSelections.flatMap((f) => {
      if (!f.artifact) return []
      const sweep = getSweepFromSuspectedSweepSurface(
        f.artifact.id,
        artifactGraph
      )
      if (err(sweep) || !sweep) return []
      return {
        artifact: sweep as Artifact,
        codeRef: sweep.codeRef,
      }
    }),
    otherSelections: [],
  }
  // Map the sketches selection into a list of kcl expressions to be passed as unlabeled argument
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

  const pathIfPipe = vars.pathIfPipe
  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const facesExprs = getFacesExprsFromSelection(
    modifiedAst,
    faces,
    artifactGraph
  )
  const facesExpr = createVariableExpressionsArray(facesExprs)
  if (!facesExpr) {
    return new Error('No faces found in the selection')
  }

  return { solidsExpr, facesExpr, pathIfPipe }
}
