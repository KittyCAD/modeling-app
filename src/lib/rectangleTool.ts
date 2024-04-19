import {
  createArrayExpression,
  createBinaryExpression,
  createCallExpressionStdLib,
  createLiteral,
  createPipeSubstitution,
  createUnaryExpression,
} from 'lang/modifyAst'
import { roundOff } from './utils'
import { ArrayExpression, CallExpression, PipeExpression } from 'lang/wasm'

/**
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn('XY')
 *  |> startProfileAt([0, 0], %)
 *  |> angledLine([0, 0], %, 'a')
 *  |> angledLine([segAng('a', %) - 90, 0], %, 'b')
 *  |> angledLine([segAng('a', %), -segLen('a', %)], %, 'c')
 *  |> close(%)
 */
export const getRectangleCallExpressions = (
  rectangleOrigin: [number, number],
  tags: [string, string, string]
) => [
  createCallExpressionStdLib('startProfileAt', [
    createArrayExpression([
      createLiteral(roundOff(rectangleOrigin[0])),
      createLiteral(roundOff(rectangleOrigin[1])),
    ]),
    createPipeSubstitution(),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createLiteral(0), // 0 deg
      createLiteral(0), // This will be the width of the rectangle
    ]),
    createPipeSubstitution(),
    createLiteral(tags[0]),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createBinaryExpression([
        createCallExpressionStdLib('segAng', [
          createLiteral(tags[0]),
          createPipeSubstitution(),
        ]),
        '+',
        createLiteral(90),
      ]), // 90 offset from the previous line
      createLiteral(0), // This will be the height of the rectangle
    ]),
    createPipeSubstitution(),
    createLiteral(tags[1]),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createCallExpressionStdLib('segAng', [
        createLiteral(tags[0]),
        createPipeSubstitution(),
      ]), // same angle as the first line
      createUnaryExpression(
        createCallExpressionStdLib('segLen', [
          createLiteral(tags[0]),
          createPipeSubstitution(),
        ]),
        '-'
      ), // negative height
    ]),
    createPipeSubstitution(),
    createLiteral(tags[2]),
  ]),
  createCallExpressionStdLib('close', [createPipeSubstitution()]),
]

/**
 * Mutates the pipeExpression to update the rectangle sketch
 * @param pipeExpression
 * @param x
 * @param y
 * @param tag
 */
export function updateRectangleSketch(
  pipeExpression: PipeExpression,
  x: number,
  y: number,
  tag: string
) {
  ;((pipeExpression.body[2] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createLiteral(x >= 0 ? 0 : 180),
    createLiteral(Math.abs(x)),
  ])
  ;((pipeExpression.body[3] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createBinaryExpression([
      createCallExpressionStdLib('segAng', [
        createLiteral(tag),
        createPipeSubstitution(),
      ]),
      Math.sign(y) === Math.sign(x) ? '+' : '-',
      createLiteral(90),
    ]), // 90 offset from the previous line
    createLiteral(Math.abs(y)), // This will be the height of the rectangle
  ])
}
