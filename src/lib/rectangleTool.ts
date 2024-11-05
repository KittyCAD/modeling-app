import {
  createArrayExpression,
  createBinaryExpression,
  createCallExpressionStdLib,
  createIdentifier,
  createLiteral,
  createPipeSubstitution,
  createTagDeclarator,
  createUnaryExpression,
} from 'lang/modifyAst'
import { ArrayExpression, CallExpression, PipeExpression } from 'lang/wasm'
import { isOverlap, roundOff } from 'lib/utils'

/**
 * TODO Kevin: This is a lie, it does not create the startSketchOn
 * and it does not create the startProfileAt.
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn('XY')
 *  |> startProfileAt([0, 0], %)
 *  |> angledLine([0, 0], %, $a)
 *  |> angledLine([segAng(a) - 90, 0], %, $b)
 *  |> angledLine([segAng(a), -segLen(a)], %, $c)
 *  |> close(%)
 */
export const getRectangleCallExpressions = (
  rectangleOrigin: [number, number],
  tags: [string, string, string]
) => [
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createLiteral(0), // 0 deg
      createLiteral(0), // This will be the width of the rectangle
    ]),
    createPipeSubstitution(),
    createTagDeclarator(tags[0]),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createBinaryExpression([
        createCallExpressionStdLib('segAng', [createIdentifier(tags[0])]),
        '+',
        createLiteral(90),
      ]), // 90 offset from the previous line
      createLiteral(0), // This will be the height of the rectangle
    ]),
    createPipeSubstitution(),
    createTagDeclarator(tags[1]),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createCallExpressionStdLib('segAng', [createIdentifier(tags[0])]), // same angle as the first line
      createUnaryExpression(
        createCallExpressionStdLib('segLen', [createIdentifier(tags[0])]),
        '-'
      ), // negative height
    ]),
    createPipeSubstitution(),
    createTagDeclarator(tags[2]),
  ]),
  createCallExpressionStdLib('lineTo', [
    createArrayExpression([
      createCallExpressionStdLib('profileStartX', [createPipeSubstitution()]),
      createCallExpressionStdLib('profileStartY', [createPipeSubstitution()]),
    ]),
    createPipeSubstitution(),
  ]), // close the rectangle
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
  x: number, // rename to deltaX
  y: number, // rename to deltaY
  tag: string,
  originX?: number,
  originY?: number
) {
  let startX = originX - Math.abs(x)
  let startY = originY - Math.abs(y)

  console.log(originX, originY)
  console.log(x, y)
  console.log(startX, startY)
  console.log(pipeExpression)
  console.log('==============')

  // pipeExpression.body[1] is startProfileAt
  ;((pipeExpression.body[1] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createLiteral(roundOff(startX)),
    createLiteral(roundOff(startY)),
  ])

  const twoX = x * 2
  const twoY = y * 2

  ;((pipeExpression.body[2] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createLiteral(pipeExpression.body[2].arguments[0].elements[0].value),
    createLiteral(Math.abs(twoX)),
  ])
  ;((pipeExpression.body[3] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createBinaryExpression([
      createCallExpressionStdLib('segAng', [createIdentifier(tag)]),
      pipeExpression.body[3].arguments[0].elements[0].operator,
      createLiteral(90),
    ]), // 90 offset from the previous line
    createLiteral(Math.abs(twoY)), // This will be the height of the rectangle
  ])
}
