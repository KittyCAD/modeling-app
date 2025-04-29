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
import {
  getEdgeTagCall,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import { getNodeFromPath, valueOrVariable } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import type {
  KclCommandValue,
  KclExpressionWithVariable,
} from '@src/lib/commandTypes'
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
  sketches: Expr[]
  length: KclCommandValue
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  let sketchesExpr = createSketchExpression(sketches)
  const call = createCallExpressionStdLibKw('extrude', sketchesExpr, [
    createLabeledArg('length', valueOrVariable(length)),
  ])

  // Insert the length variable if the user has provided a variable name
  if ('variableName' in length && length.variableName) {
    insertVariable(length, modifiedAst, nodeToEdit)
  }

  let pathToNode: PathToNode = []
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
  sketches: Expr[]
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
  const modifiedAst = structuredClone(ast)

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

  let sketchesExpr = createSketchExpression(sketches)
  const call = createCallExpressionStdLibKw('revolve', sketchesExpr, [
    createLabeledArg('angle', valueOrVariable(angle)),
    createLabeledArg('axis', getAxisResult.generatedAxis),
  ])

  // Insert the angle variable if the user has provided a variable name
  if ('variableName' in angle && angle.variableName) {
    insertVariable(angle, modifiedAst, nodeToEdit)
  }

  let pathToNode: PathToNode = []
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

export function addSweep({
  ast,
  sketches,
  trajectoryDeclarator,
  sectional,
  nodeToEdit,
}: {
  ast: Node<Program>
  sketches: Expr[]
  trajectoryDeclarator: VariableDeclarator
  sectional?: boolean
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  let sketchesExpr = createSketchExpression(sketches)
  const call = createCallExpressionStdLibKw('sweep', sketchesExpr, [
    createLabeledArg('path', createLocalName(trajectoryDeclarator.id.name)),
    ...(sectional
      ? [createLabeledArg('sectional', createLiteral(sectional))]
      : []),
  ])

  let pathToNode: PathToNode = []
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

// Utilities

function createSketchExpression(sketches: Expr[]) {
  let sketchesExpr: Expr | null = null
  if (sketches.length === 1) {
    if (sketches[0].type !== 'PipeSubstitution') {
      sketchesExpr = sketches[0]
    }
    // Keep it null if it's a pipe substitution
  } else {
    sketchesExpr = createArrayExpression(sketches)
  }
  return sketchesExpr
}

function insertVariable(
  length: KclExpressionWithVariable,
  modifiedAst: Node<Program>,
  nodeToEdit: PathToNode | undefined
) {
  const insertIndex = length.insertIndex
  modifiedAst.body.splice(insertIndex, 0, length.variableDeclarationAst)
  if (
    nodeToEdit &&
    typeof nodeToEdit[1][0] === 'number' &&
    insertIndex <= nodeToEdit[1][0]
  ) {
    nodeToEdit[1][0] += 1
  }
}

function createPathToNode(modifiedAst: Node<Program>): PathToNode {
  return [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
  ]
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
        return new Error('Expected to fine axis declaration')
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
