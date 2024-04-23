import {
  createArrayExpression,
  createBinaryExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeSubstitution,
} from 'lang/modifyAst'
import { roundOff } from './utils'
import {
  ArrayExpression,
  CallExpression,
  Literal,
  PipeExpression,
} from 'lang/wasm'

/**
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn('XY')
 *   |> circle([0, 0], 0, %)
 */
export const circleAsCallExpressions = (
  circleOrigin: [number, number],
  tags: [string]
) => [
  createCallExpressionStdLib('circle', [
    createArrayExpression([
      createLiteral(roundOff(circleOrigin[0])),
      createLiteral(roundOff(circleOrigin[1])),
    ]),
    createLiteral(10),
    createPipeSubstitution(),
    createLiteral(tags[0]),
  ]),
]

/**
 * Mutates the pipeExpression to update the circle sketch
 * @param pipeExpression
 * @param x
 * @param y
 * @param tag
 */
export function updateCircleSketch(
  pipeExpression: PipeExpression,
  x: number,
  y: number,
  tag: string
) {
  const circle = pipeExpression.body[1] as CallExpression
  const origin = circle.arguments[0] as ArrayExpression
  const originX = (origin.elements[0] as Literal).value
  const originY = (origin.elements[1] as Literal).value

  const radius = roundOff(
    Math.sqrt((x - Number(originX)) ** 2 + (y - Number(originY)) ** 2)
  )

  ;(circle.arguments[1] as Literal) = createLiteral(radius)
}
