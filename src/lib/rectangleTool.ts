import {
  createArrayExpression,
  createBinaryExpression,
  createCallExpressionStdLib,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createPipeSubstitution,
  createTagDeclarator,
  createUnaryExpression,
} from 'lang/modifyAst'
import { ARG_END_ABSOLUTE } from 'lang/std/sketch'
import {
  isArrayExpression,
  isBinaryExpression,
  isCallExpression,
  isLiteral,
  isLiteralValueNumber,
} from 'lang/util'
import { ArrayExpression, CallExpression, PipeExpression } from 'lang/wasm'
import { roundOff } from 'lib/utils'

/**
 * It does not create the startSketchOn and it does not create the startProfileAt.
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn(XY)
 *  |> startProfileAt([0, 0], %)
 *  |> angledLine([0, 0], %, $a)
 *  |> angledLine([segAng(a) - 90, 0], %, $b)
 *  |> angledLine([segAng(a), -segLen(a)], %, $c)
 *  |> close()
 */
export const getRectangleCallExpressions = (
  rectangleOrigin: [number, number],
  tag: string
) => [
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createLiteral(0), // 0 deg
      createLiteral(0), // This will be the width of the rectangle
    ]),
    createPipeSubstitution(),
    createTagDeclarator(tag),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createBinaryExpression([
        createCallExpressionStdLib('segAng', [createLocalName(tag)]),
        '+',
        createLiteral(90),
      ]), // 90 offset from the previous line
      createLiteral(0), // This will be the height of the rectangle
    ]),
    createPipeSubstitution(),
  ]),
  createCallExpressionStdLib('angledLine', [
    createArrayExpression([
      createCallExpressionStdLib('segAng', [createLocalName(tag)]), // same angle as the first line
      createUnaryExpression(
        createCallExpressionStdLib('segLen', [createLocalName(tag)]),
        '-'
      ), // negative height
    ]),
    createPipeSubstitution(),
  ]),
  createCallExpressionStdLibKw('line', null, [
    createLabeledArg(
      ARG_END_ABSOLUTE,
      createArrayExpression([
        createCallExpressionStdLib('profileStartX', [createPipeSubstitution()]),
        createCallExpressionStdLib('profileStartY', [createPipeSubstitution()]),
      ])
    ),
  ]), // close the rectangle
  createCallExpressionStdLibKw('close', null, []),
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
  ;((pipeExpression.body[1] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createLiteral(x >= 0 ? 0 : 180),
    createLiteral(Math.abs(x)),
  ])
  ;((pipeExpression.body[2] as CallExpression)
    .arguments[0] as ArrayExpression) = createArrayExpression([
    createBinaryExpression([
      createCallExpressionStdLib('segAng', [createLocalName(tag)]),
      Math.sign(y) === Math.sign(x) ? '+' : '-',
      createLiteral(90),
    ]), // 90 offset from the previous line
    createLiteral(Math.abs(y)), // This will be the height of the rectangle
  ])
}

/**
 * Mutates the pipeExpression to update the center rectangle sketch
 * @param pipeExpression
 * @param x
 * @param y
 * @param tag
 */
export function updateCenterRectangleSketch(
  pipeExpression: PipeExpression,
  deltaX: number,
  deltaY: number,
  tag: string,
  originX: number,
  originY: number
) {
  let startX = originX - Math.abs(deltaX)
  let startY = originY - Math.abs(deltaY)

  let callExpression = pipeExpression.body[0]
  if (isCallExpression(callExpression)) {
    const arrayExpression = callExpression.arguments[0]
    if (isArrayExpression(arrayExpression)) {
      callExpression.arguments[0] = createArrayExpression([
        createLiteral(roundOff(startX)),
        createLiteral(roundOff(startY)),
      ])
    }
  }

  const twoX = deltaX * 2
  const twoY = deltaY * 2

  callExpression = pipeExpression.body[1]
  if (isCallExpression(callExpression)) {
    const arrayExpression = callExpression.arguments[0]
    if (isArrayExpression(arrayExpression)) {
      const literal = arrayExpression.elements[0]
      if (isLiteral(literal)) {
        if (isLiteralValueNumber(literal.value)) {
          callExpression.arguments[0] = createArrayExpression([
            createLiteral(literal.value),
            createLiteral(Math.abs(twoX)),
          ])
        }
      }
    }
  }

  callExpression = pipeExpression.body[2]
  if (isCallExpression(callExpression)) {
    const arrayExpression = callExpression.arguments[0]
    if (isArrayExpression(arrayExpression)) {
      const binaryExpression = arrayExpression.elements[0]
      if (isBinaryExpression(binaryExpression)) {
        callExpression.arguments[0] = createArrayExpression([
          createBinaryExpression([
            createCallExpressionStdLib('segAng', [createLocalName(tag)]),
            binaryExpression.operator,
            createLiteral(90),
          ]), // 90 offset from the previous line
          createLiteral(Math.abs(twoY)), // This will be the height of the rectangle
        ])
      }
    }
  }
}
