import { err } from 'lib/trap'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import {
  Program,
  PathToNode,
  Expr,
  CallExpression,
  PipeExpression,
  VariableDeclarator,
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
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import {
  mutateAstWithTagForSketchSegment,
  getEdgeTagCall,
} from 'lang/modifyAst/addEdgeTreatment'
export function revolveSketch(
  ast: Node<Program>,
  pathToSketchNode: PathToNode,
  shouldPipe = false,
  angle: Expr = createLiteral(4),
  axisOrEdge: String,
  axis: String,
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

  if (axisOrEdge === 'Edge') {
    console.log('1')
    // testing code
    const pathToAxisSelection = getNodePathFromSourceRange(
      clonedAst,
      edge.graphSelections[0]?.codeRef.range
    )
    const lineNode = getNodeFromPath<CallExpression>(
      clonedAst,
      pathToAxisSelection,
      'CallExpression'
    )
    console.log('2')
    if (err(lineNode)) return lineNode

    console.log('3')
    // TODO Kevin: What if |> close(%)?
    // TODO Kevin: What if opposite edge
    // TODO Kevin: What if the edge isn't planar to the sketch?
    // TODO Kevin: add a tag.
    const tagResult = mutateAstWithTagForSketchSegment(
      clonedAst,
      pathToAxisSelection
    )

    console.log('4')
    // Have the tag whether it is already created or a new one is generated
    if (err(tagResult)) return tagResult
    const { tag } = tagResult
    const axisSelection = edge?.graphSelections[0]?.artifact
    generatedAxis = getEdgeTagCall(tag, axisSelection)
    console.log('5')
  } else {
    generatedAxis = createLiteral(axis)
    console.log('6')
  }
  console.log('7')

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
  console.log('8')

  const sketchVariableDeclaratorNode = getNodeFromPath<VariableDeclarator>(
    clonedAst,
    pathToSketchNode,
    'VariableDeclarator'
  )
  if (err(sketchVariableDeclaratorNode)) return sketchVariableDeclaratorNode
  console.log('9')
  const {
    node: sketchVariableDeclarator,
    shallowPath: sketchPathToDecleration,
  } = sketchVariableDeclaratorNode
  console.log('10')

  if (!generatedAxis) return new Error('Axis selection is missing.')

  console.log('generatexAxis', generatedAxis)
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
  if (typeof sketchIndexInBody !== 'number')
    return new Error('expected sketchIndexInBody to be a number')
  clonedAst.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
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
