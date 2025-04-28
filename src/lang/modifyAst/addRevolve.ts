import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  getEdgeTagCall,
  mutateAstWithTagForSketchSegment,
} from '@src/lang/modifyAst/addEdgeTreatment'
import { getNodeFromPath } from '@src/lang/queryAst'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type {
  CallExpressionKw,
  Expr,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'

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
  angle: Expr
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
  const getAxisResult = getAxisExpressionAndIndex(
    axisOrEdge,
    axis,
    edge,
    modifiedAst
  )
  if (err(getAxisResult)) return getAxisResult
  const { generatedAxis } = getAxisResult
  if (!generatedAxis) return new Error('Generated axis selection is missing.')

  let sketchesArg: Expr | null = null
  if (sketches.length === 1) {
    if (sketches[0].type !== 'PipeSubstitution') {
      sketchesArg = sketches[0]
    }
    // Keep it null if it's a pipe substitution
  } else {
    sketchesArg = createArrayExpression(sketches)
  }
  const call = createCallExpressionStdLibKw('revolve', sketchesArg, [
    createLabeledArg('angle', angle),
    createLabeledArg('axis', generatedAxis),
  ])
  // index of the 'length' arg above. If you reorder the labeled args above,
  // make sure to update this too.
  const argIndex = 0

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

    // Replace the existing call with the new one
    Object.assign(result.node, call)
    pathToNode = nodeToEdit
  } else {
    // We're not creating a pipe expression,
    // but rather a separate constant for the extrusion
    const name = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE
    )
    const variable = createVariableDeclaration(name, call)
    // TODO: Check if we should instead find a good index to insert at
    modifiedAst.body.push(variable)
    pathToNode = [
      ['body', ''],
      [modifiedAst.body.length - 1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['arguments', 'CallExpressionKw'],
      [argIndex, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
    ]
  }

  return {
    modifiedAst,
    pathToNode,
  }
}
