import {
  createArrayExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeExpression,
  createPipeSubstitution,
  createTagDeclarator,
  findUniqueName,
} from 'lang/modifyAst'
import { roundOff } from './utils'
import {
  PathToNode,
  Program,
  VariableDeclaration,
  parse,
  recast,
} from 'lang/wasm'
import { getNodeFromPath } from 'lang/queryAst'
import { trap } from './trap'

/**
 * Hide away the working with the AST
 */
export async function addCircleToSketchAst({
  sourceAst,
  sketchPathToNode,
  circleOrigin,
}: {
  sourceAst: Program
  sketchPathToNode?: PathToNode
  circleOrigin?: [number, number]
}) {
  let _ast = JSON.parse(JSON.stringify(sourceAst))

  const _node1 = getNodeFromPath<VariableDeclaration>(
    _ast,
    sketchPathToNode || [],
    'VariableDeclaration'
  )
  if (trap(_node1)) return Promise.reject(_node1)

  const tag = findUniqueName(_ast, 'circle')

  const _node2 = getNodeFromPath<VariableDeclaration>(
    _ast,
    sketchPathToNode || [],
    'VariableDeclaration'
  )
  if (trap(_node2)) return Promise.reject(_node2)
  const startSketchOn = _node2.node?.declarations

  const startSketchOnInit = startSketchOn?.[0]?.init
  startSketchOn[0].init = createPipeExpression([
    startSketchOnInit,
    ...getCircleCallExpressions({
      center: circleOrigin,
      tag,
    }),
  ])

  const maybeModdedAst = parse(recast(_ast))
  if (trap(maybeModdedAst)) return Promise.reject(maybeModdedAst)
  return Promise.resolve(maybeModdedAst)
}

/**
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn('XY')
 *   |> startProfileAt([0, 0], %)
 *   |> circle([0, 0], 0, %) <- this line
 */
export function getCircleCallExpressions({
  center = [0, 0],
  radius = 10,
  tag,
}: {
  center?: [number, number]
  radius?: number
  tag: string
}) {
  return [
    createCallExpressionStdLib('circle', [
      createArrayExpression([
        createLiteral(roundOff(center[0])),
        createLiteral(roundOff(center[1])),
      ]),
      createLiteral(roundOff(radius)),
      createPipeSubstitution(),
      createTagDeclarator(tag),
    ]),
  ]
}
