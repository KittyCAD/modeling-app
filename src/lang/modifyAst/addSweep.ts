import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { insertVariableAndOffsetPathToNode } from '@src/lang/modifyAst'
import {
  getEdgeTagCall,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  getNodeFromPath,
  getSketchExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'

export function addExtrude({
  ast,
  sketches,
  length,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  length: KclCommandValue
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
  const sketchesExprList = getSketchExprsFromSelection(
    sketches,
    modifiedAst,
    nodeToEdit
  )
  if (err(sketchesExprList)) {
    return sketchesExprList
  }

  const sketchesExpr = createSketchExpression(sketchesExprList)
  const call = createCallExpressionStdLibKw('extrude', sketchesExpr, [
    createLabeledArg('length', valueOrVariable(length)),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, nodeToEdit ?? [])
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  let pathToNode: PathToNode | undefined
  if (nodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      nodeToEdit,
      'CallExpressionKw'
    )
    if (err(result)) {
      return result
    }

    Object.assign(result.node, call)
    pathToNode = nodeToEdit
  } else {
    const name = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.EXTRUDE
    )
    const declaration = createVariableDeclaration(name, call)
    modifiedAst.body.push(declaration)
    pathToNode = createPathToNode(modifiedAst)
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
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  path: Selections
  sectional?: boolean
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
  const sketchesExprList = getSketchExprsFromSelection(
    sketches,
    modifiedAst,
    nodeToEdit
  )
  if (err(sketchesExprList)) {
    return sketchesExprList
  }

  // Extra roundabout to find the trajectory (or path) declaration for the labeled argument
  const pathNodePath = getNodePathFromSourceRange(
    ast,
    path.graphSelections[0].codeRef.range
  )
  const pathDeclaration = getNodeFromPath<VariableDeclaration>(
    ast,
    pathNodePath,
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

  const sketchesExpr = createSketchExpression(sketchesExprList)
  const call = createCallExpressionStdLibKw('sweep', sketchesExpr, [
    createLabeledArg('path', pathExpr),
    ...sectionalExpr,
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  let pathToNode: PathToNode | undefined
  if (nodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      nodeToEdit,
      'CallExpressionKw'
    )
    if (err(result)) {
      return result
    }

    Object.assign(result.node, call)
    pathToNode = nodeToEdit
  } else {
    const name = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.SWEEP
    )
    const declaration = createVariableDeclaration(name, call)
    modifiedAst.body.push(declaration)
    pathToNode = createPathToNode(modifiedAst)
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addLoft({
  ast,
  sketches,
}: {
  ast: Node<Program>
  sketches: Selections
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
  const sketchesExprList = getSketchExprsFromSelection(sketches, modifiedAst)
  if (err(sketchesExprList)) {
    return sketchesExprList
  }

  const sketchesExpr = createSketchExpression(sketchesExprList)
  const call = createCallExpressionStdLibKw('loft', sketchesExpr, [])

  // 3. Just push the declaration to the end
  // Note that Loft doesn't support edit flows yet since it's selection only atm
  const name = findUniqueName(modifiedAst, KCL_DEFAULT_CONSTANT_PREFIXES.LOFT)
  const declaration = createVariableDeclaration(name, call)
  modifiedAst.body.push(declaration)
  const toFirstKwarg = false
  const pathToNode = createPathToNode(modifiedAst, toFirstKwarg)

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
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Selections
  angle: KclCommandValue
  axisOrEdge: 'Axis' | 'Edge'
  axis: string | undefined
  edge: Selections | undefined
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
  const sketchesExprList = getSketchExprsFromSelection(
    sketches,
    modifiedAst,
    nodeToEdit
  )
  if (err(sketchesExprList)) {
    return sketchesExprList
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

  const sketchesExpr = createSketchExpression(sketchesExprList)
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    createLabeledArg('axis', getAxisResult.generatedAxis),
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angle && angle.variableName) {
    insertVariableAndOffsetPathToNode(angle, modifiedAst, nodeToEdit ?? [])
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  let pathToNode: PathToNode | undefined
  if (nodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      nodeToEdit,
      'CallExpressionKw'
    )
    if (err(result)) {
      return result
    }

    Object.assign(result.node, call)
    pathToNode = nodeToEdit
  } else {
    const name = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE
    )
    const declaration = createVariableDeclaration(name, call)
    modifiedAst.body.push(declaration)
    pathToNode = createPathToNode(modifiedAst)
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

// Utilities

function createSketchExpression(sketches: Expr[]) {
  let sketchesExpr: Expr | null = null
  if (sketches.every((s) => s.type === 'PipeSubstitution')) {
    // Keeping null so we don't even put it the % sign
  } else if (sketches.length === 1) {
    sketchesExpr = sketches[0]
  } else {
    sketchesExpr = createArrayExpression(sketches)
  }
  return sketchesExpr
}

function createPathToNode(
  modifiedAst: Node<Program>,
  toFirstKwarg = true
): PathToNode {
  const argIndex = 0 // first kwarg for all sweeps here
  const pathToCall: PathToNode = [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]
  if (toFirstKwarg) {
    pathToCall.push(
      ['arguments', 'CallExpressionKw'],
      [argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD]
    )
  }

  return pathToCall
}

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
