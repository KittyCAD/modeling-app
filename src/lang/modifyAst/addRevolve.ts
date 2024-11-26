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
import { mutateAstWithTagForSketchSegment } from 'lang/modifyAst/addFillet'
export function revolveSketch(
  ast: Node<Program>,
  pathToNode: PathToNode,
  shouldPipe = false,
  angle: Expr = createLiteral(4),
  axis: Selections
):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
      pathToRevolveArg: PathToNode
    }
  | Error {
  const clonedAst = structuredClone(ast)
  const _node1 = getNodeFromPath(clonedAst, pathToNode)
  if (err(_node1)) return _node1

  // testing code
  const pathToAxisSelection = getNodePathFromSourceRange(
    clonedAst,
    axis.graphSelections[0]?.codeRef.range
  )

  const lineNode = getNodeFromPath<CallExpression>(
    clonedAst,
    pathToAxisSelection,
    'CallExpression'
  )

  if (err(lineNode)) return lineNode

  console.log('axis node path', pathToAxisSelection)
  console.log('line call expression', lineNode)
  console.log('axis selection from artifact graph', axis.graphSelections[0])

  // TODO Kevin: What if |> close(%)?
  // TODO Kevin: What if opposite edge
  // TODO Kevin: What if the edge isn't planar to the sketch?

  // TODO Kevin: add a tag.
  // This adds a tag, need to find a tag if one already exists.
  // Does this mutate brick something?
  const tagResult = mutateAstWithTagForSketchSegment(
    clonedAst,
    pathToAxisSelection
  )
  if (err(tagResult)) return tagResult
  const { tag, modifiedAst } = tagResult

  console.log('my tag!', tag)

  /* Original Code */
  const { node: sketchExpression } = _node1

  // determine if sketchExpression is in a pipeExpression or not
  const _node2 = getNodeFromPath<PipeExpression>(
    clonedAst,
    pathToNode,
    'PipeExpression'
  )
  if (err(_node2)) return _node2
  const { node: pipeExpression } = _node2

  const isInPipeExpression = pipeExpression.type === 'PipeExpression'

  const _node3 = getNodeFromPath<VariableDeclarator>(
    clonedAst,
    pathToNode,
    'VariableDeclarator'
  )
  if (err(_node3)) return _node3
  const { node: variableDeclarator, shallowPath: pathToDecleration } = _node3

  const revolveCall = createCallExpressionStdLib('revolve', [
    createObjectExpression({
      angle: angle,
      axis: createLiteral('Y'),
    }),
    createIdentifier(variableDeclarator.id.name),
  ])

  if (shouldPipe) {
    const pipeChain = createPipeExpression(
      isInPipeExpression
        ? [...pipeExpression.body, revolveCall]
        : [sketchExpression as any, revolveCall]
    )

    variableDeclarator.init = pipeChain
    const pathToRevolveArg: PathToNode = [
      ...pathToDecleration,
      ['init', 'VariableDeclarator'],
      ['body', ''],
      [pipeChain.body.length - 1, 'index'],
      ['arguments', 'CallExpression'],
      [0, 'index'],
    ]

    return {
      modifiedAst: clonedAst,
      pathToNode,
      pathToRevolveArg,
    }
  }

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name = findUniqueName(clonedAst, KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE)
  const VariableDeclaration = createVariableDeclaration(name, revolveCall)
  const sketchIndexInPathToNode =
    pathToDecleration.findIndex((a) => a[0] === 'body') + 1
  const sketchIndexInBody = pathToDecleration[sketchIndexInPathToNode][0]
  if (typeof sketchIndexInBody !== 'number')
    return new Error('expected sketchIndexInBody to be a number')
  clonedAst.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
    ['declarations', 'VariableDeclaration'],
    [0, 'index'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst: clonedAst,
    pathToNode: [...pathToNode.slice(0, -1), [-1, 'index']],
    pathToRevolveArg,
  }
}
