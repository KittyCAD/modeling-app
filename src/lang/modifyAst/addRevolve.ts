import { err } from 'lib/trap'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import {
  Program,
  PathToNode,
  Expr,
  CallExpression,
  PipeExpression,
  VariableDeclarator,
  CallExpressionKw,
} from 'lang/wasm'
import { Selections } from 'lib/selections'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import {
  createLiteral,
  createCallExpressionStdLib,
  createObjectExpression,
  createIdentifier,
  createPipeExpression,
  findUniqueName,
  createVariableDeclaration,
} from 'lang/modifyAst'
import { getNodeFromPath } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  mutateAstWithTagForSketchSegment,
  getEdgeTagCall,
} from 'lang/modifyAst/addEdgeTreatment'
export function revolveSketch(
  ast: Node<Program>,
  pathToSketchNode: PathToNode,
  shouldPipe = false,
  angle: Expr = createLiteral(4),
  axisOrEdge: string,
  axis: string,
  edge: Selections
):
  | {
      modifiedAst: Node<Program>
      pathToSketchNode: PathToNode
      pathToRevolveArg: PathToNode
    }
  | Error {
  const clonedAst = structuredClone(ast)
  const sketchNode = getNodeFromPath(clonedAst, pathToSketchNode)
  if (err(sketchNode)) return sketchNode

  let generatedAxis
  let axisDeclaration: PathToNode | null = null

  if (axisOrEdge === 'Edge') {
    const pathToAxisSelection = getNodePathFromSourceRange(
      clonedAst,
      edge.graphSelections[0]?.codeRef.range
    )
    const lineNode = getNodeFromPath<CallExpression | CallExpressionKw>(
      clonedAst,
      pathToAxisSelection,
      ['CallExpression', 'CallExpressionKw']
    )
    if (err(lineNode)) return lineNode

    const tagResult = mutateAstWithTagForSketchSegment(
      clonedAst,
      pathToAxisSelection
    )

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
    }
  } else {
    generatedAxis = createLiteral(axis)
  }

  /* Original Code */
  const { node: sketchExpression } = sketchNode

  // determine if sketchExpression is in a pipeExpression or not
  const sketchPipeExpressionNode = getNodeFromPath<PipeExpression>(
    clonedAst,
    pathToSketchNode,
    'PipeExpression'
  )
  if (err(sketchPipeExpressionNode)) return sketchPipeExpressionNode
  const { node: sketchPipeExpression } = sketchPipeExpressionNode
  const isInPipeExpression = sketchPipeExpression.type === 'PipeExpression'

  const sketchVariableDeclaratorNode = getNodeFromPath<VariableDeclarator>(
    clonedAst,
    pathToSketchNode,
    'VariableDeclarator'
  )
  if (err(sketchVariableDeclaratorNode)) return sketchVariableDeclaratorNode
  const {
    node: sketchVariableDeclarator,
    shallowPath: sketchPathToDecleration,
  } = sketchVariableDeclaratorNode

  if (!generatedAxis) return new Error('Generated axis selection is missing.')

  const revolveCall = createCallExpressionStdLib('revolve', [
    createObjectExpression({
      angle: angle,
      axis: generatedAxis,
    }),
    createIdentifier(sketchVariableDeclarator.id.name),
  ])

  if (shouldPipe) {
    const pipeChain = createPipeExpression(
      isInPipeExpression
        ? [...sketchPipeExpression.body, revolveCall]
        : [sketchExpression as any, revolveCall]
    )

    sketchVariableDeclarator.init = pipeChain
    const pathToRevolveArg: PathToNode = [
      ...sketchPathToDecleration,
      ['init', 'VariableDeclarator'],
      ['body', ''],
      [pipeChain.body.length - 1, 'index'],
      ['arguments', 'CallExpression'],
      [0, 'index'],
    ]

    return {
      modifiedAst: clonedAst,
      pathToSketchNode,
      pathToRevolveArg,
    }
  }

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name = findUniqueName(clonedAst, KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE)
  const VariableDeclaration = createVariableDeclaration(name, revolveCall)
  const sketchIndexInPathToNode =
    sketchPathToDecleration.findIndex((a) => a[0] === 'body') + 1
  const sketchIndexInBody = sketchPathToDecleration[sketchIndexInPathToNode][0]
  let insertIndex = sketchIndexInBody

  if (typeof insertIndex !== 'number')
    return new Error('expected insertIndex to be a number')

  // If an axis was selected in KCL, find the max index to insert the revolve command
  if (axisDeclaration) {
    const axisIndexInPathToNode =
      axisDeclaration.findIndex((a) => a[0] === 'body') + 1
    const axisIndex = axisDeclaration[axisIndexInPathToNode][0]

    if (typeof axisIndex !== 'number')
      return new Error('expected axisIndex to be a number')

    insertIndex = Math.max(insertIndex, axisIndex)
  }

  clonedAst.body.splice(insertIndex + 1, 0, VariableDeclaration)

  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [insertIndex + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]

  return {
    modifiedAst: clonedAst,
    pathToSketchNode: [...pathToSketchNode.slice(0, -1), [-1, 'index']],
    pathToRevolveArg,
  }
}
