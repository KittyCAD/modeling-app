import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from 'lang/modifyAst'
import {
  getEdgeTagCall,
  mutateAstWithTagForSketchSegment,
} from 'lang/modifyAst/addEdgeTreatment'
import {
  ARG_INDEX_FIELD,
  LABELED_ARG_FIELD,
  getNodeFromPath,
} from 'lang/queryAst'
import { getSafeInsertIndex } from 'lang/queryAst/getSafeInsertIndex'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { Expr, PathToNode, Program, VariableDeclarator } from 'lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import { Selections } from 'lib/selections'
import { err } from 'lib/trap'

import { Node } from '@rust/kcl-lib/bindings/Node'

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
    generatedAxis = createLiteral(axis)
  }

  return {
    generatedAxis,
    axisIndexIfAxis,
  }
}

export function revolveSketch(
  ast: Node<Program>,
  pathToSketchNode: PathToNode,
  angle: Expr,
  axisOrEdge: 'Axis' | 'Edge',
  axis: string | undefined,
  edge: Selections | undefined,
  variableName?: string,
  insertIndex?: number
):
  | {
      modifiedAst: Node<Program>
      pathToSketchNode: PathToNode
      pathToRevolveArg: PathToNode
    }
  | Error {
  const clonedAst = structuredClone(ast)
  const sketchVariableDeclaratorNode = getNodeFromPath<VariableDeclarator>(
    clonedAst,
    pathToSketchNode,
    'VariableDeclarator'
  )
  if (err(sketchVariableDeclaratorNode)) return sketchVariableDeclaratorNode
  const { node: sketchVariableDeclarator } = sketchVariableDeclaratorNode

  const getAxisResult = getAxisExpressionAndIndex(
    axisOrEdge,
    axis,
    edge,
    clonedAst
  )
  if (err(getAxisResult)) return getAxisResult
  const { generatedAxis } = getAxisResult
  if (!generatedAxis) return new Error('Generated axis selection is missing.')

  const revolveCall = createCallExpressionStdLibKw(
    'revolve',
    createLocalName(sketchVariableDeclarator.id.name),
    [createLabeledArg('angle', angle), createLabeledArg('axis', generatedAxis)]
  )

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name =
    variableName ??
    findUniqueName(clonedAst, KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE)
  const variableDeclaration = createVariableDeclaration(name, revolveCall)
  const bodyInsertIndex =
    insertIndex ?? getSafeInsertIndex(revolveCall, clonedAst)
  clonedAst.body.splice(bodyInsertIndex, 0, variableDeclaration)
  const argIndex = 0
  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [bodyInsertIndex, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]

  return {
    modifiedAst: clonedAst,
    pathToSketchNode: [...pathToSketchNode.slice(0, -1), [-1, 'index']],
    pathToRevolveArg,
  }
}
