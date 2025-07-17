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
  getEdgeTagCall,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getNodeFromPath,
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { PathToNode, Program, VariableDeclaration } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'

export function addExtrude({
  ast,
  sketches,
  length,
  symmetric,
  bidirectionalLength,
  twistAngle,
  method,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  length: KclCommandValue
  symmetric?: boolean
  bidirectionalLength?: KclCommandValue
  twistAngle?: KclCommandValue
  method?: string
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
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, nodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Extra labeled args expressions
  const symmetricExpr = symmetric
    ? [createLabeledArg('symmetric', createLiteral(symmetric))]
    : []
  const bidirectionalLengthExpr = bidirectionalLength
    ? [
        createLabeledArg(
          'bidirectionalLength',
          valueOrVariable(bidirectionalLength)
        ),
      ]
    : []
  const twistAngleExpr = twistAngle
    ? [createLabeledArg('twistAngle', valueOrVariable(twistAngle))]
    : []
  const methodExpr = method
    ? [createLabeledArg('method', createLocalName(method))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('extrude', sketchesExpr, [
    createLabeledArg('length', valueOrVariable(length)),
    ...symmetricExpr,
    ...bidirectionalLengthExpr,
    ...twistAngleExpr,
    ...methodExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, nodeToEdit)
  }
  if (
    bidirectionalLength &&
    'variableName' in bidirectionalLength &&
    bidirectionalLength.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      bidirectionalLength,
      modifiedAst,
      nodeToEdit
    )
  }
  if (twistAngle && 'variableName' in twistAngle && twistAngle.variableName) {
    insertVariableAndOffsetPathToNode(twistAngle, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.EXTRUDE,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addSweep({
  ast,
  sketches,
  path,
  sectional,
  relativeTo,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  path: Selections
  sectional?: boolean
  relativeTo?: string
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
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, nodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Find the path declaration for the labeled argument
  const pathDeclaration = getNodeFromPath<VariableDeclaration>(
    ast,
    path.graphSelections[0].codeRef.pathToNode,
    'VariableDeclaration'
  )
  if (err(pathDeclaration)) {
    return pathDeclaration
  }

  // Extra labeled args expressions
  const pathExpr = createLocalName(pathDeclaration.node.declaration.id.name)
  const sectionalExpr = sectional
    ? [createLabeledArg('sectional', createLiteral(sectional))]
    : []
  const relativeToExpr = relativeTo
    ? [createLabeledArg('relativeTo', createLiteral(relativeTo))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('sweep', sketchesExpr, [
    createLabeledArg('path', pathExpr),
    ...sectionalExpr,
    ...relativeToExpr,
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SWEEP,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addLoft({
  ast,
  sketches,
  vDegree,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  vDegree?: KclCommandValue
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
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, nodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Extra labeled args expressions
  const vDegreeExpr = vDegree
    ? [createLabeledArg('vDegree', valueOrVariable(vDegree))]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('loft', sketchesExpr, [
    ...vDegreeExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (vDegree && 'variableName' in vDegree && vDegree.variableName) {
    insertVariableAndOffsetPathToNode(vDegree, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.LOFT,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addRevolve({
  ast,
  sketches,
  angle,
  axisOrEdge,
  axis,
  edge,
  symmetric,
  bidirectionalAngle,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  angle: KclCommandValue
  axisOrEdge: 'Axis' | 'Edge'
  axis?: string
  edge?: Selections
  symmetric?: boolean
  bidirectionalAngle?: KclCommandValue
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
  const vars = getVariableExprsFromSelection(sketches, modifiedAst, nodeToEdit)
  if (err(vars)) {
    return vars
  }

  // Retrieve axis expression depending on mode
  const getAxisResult = getAxisExpressionAndIndex(
    axisOrEdge,
    axis,
    edge,
    modifiedAst
  )
  if (err(getAxisResult) || !getAxisResult.generatedAxis) {
    return new Error('Generated axis selection is missing.')
  }

  // Extra labeled args expressions
  const symmetricExpr = symmetric
    ? [createLabeledArg('symmetric', createLiteral(symmetric))]
    : []
  const bidirectionalAngleExpr = bidirectionalAngle
    ? [
        createLabeledArg(
          'bidirectionalAngle',
          valueOrVariable(bidirectionalAngle)
        ),
      ]
    : []

  const sketchesExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    createLabeledArg('axis', getAxisResult.generatedAxis),
    ...symmetricExpr,
    ...bidirectionalAngleExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, nodeToEdit)
  }

  if (
    bidirectionalAngle &&
    'variableName' in bidirectionalAngle &&
    bidirectionalAngle.variableName
  ) {
    insertVariableAndOffsetPathToNode(
      bidirectionalAngle,
      modifiedAst,
      nodeToEdit
    )
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE,
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

export function getAxisExpressionAndIndex(
  axisOrEdge: 'Axis' | 'Edge',
  axis: string | undefined,
  edge: Selections | undefined,
  ast: Node<Program>
) {
  let generatedAxis
  let axisDeclaration: PathToNode | null = null
  let axisIndexIfAxis: number | undefined = undefined

  if (axisOrEdge === 'Edge' && edge) {
    const pathToAxisSelection = getNodePathFromSourceRange(
      ast,
      edge.graphSelections[0]?.codeRef.range
    )
    const tagResult = mutateAstWithTagForSketchSegment(ast, pathToAxisSelection)

    // Have the tag whether it is already created or a new one is generated
    if (err(tagResult)) return tagResult
    const { tag } = tagResult
    const axisSelection = edge?.graphSelections[0]?.artifact
    if (!axisSelection) return new Error('Generated axis selection is missing.')
    generatedAxis = getEdgeTagCall(tag, axisSelection)
    if (
      axisSelection.type === 'segment' ||
      axisSelection.type === 'path' ||
      axisSelection.type === 'edgeCut'
    ) {
      axisDeclaration = axisSelection.codeRef.pathToNode
      if (!axisDeclaration)
        return new Error('Expected to find axis declaration')
      const axisIndexInPathToNode =
        axisDeclaration.findIndex((a) => a[0] === 'body') + 1
      const value = axisDeclaration[axisIndexInPathToNode][0]
      if (typeof value !== 'number')
        return new Error('expected axis index value to be a number')
      axisIndexIfAxis = value
    }
  } else if (axisOrEdge === 'Axis' && axis) {
    generatedAxis = createLocalName(axis)
  }

  return {
    generatedAxis,
    axisIndexIfAxis,
  }
}
