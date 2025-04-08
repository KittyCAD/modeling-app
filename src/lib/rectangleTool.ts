import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  ARG_ANGLE,
  ARG_END_ABSOLUTE,
  ARG_LENGTH,
  ARG_TAG,
} from '@src/lang/constants'
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
} from '@src/lang/create'
import { mutateKwArg } from '@src/lang/modifyAst'
import {
  isArrayExpression,
  isBinaryExpression,
  isCallExpression,
  isLiteral,
  isLiteralValueNumber,
} from '@src/lang/util'
import type { CallExpressionKw, Expr, PipeExpression } from '@src/lang/wasm'
import { roundOff } from '@src/lib/utils'

function angledLine(
  angle: Expr,
  length: Expr,
  tag?: string
): Node<CallExpressionKw> {
  const args = [
    createLabeledArg(ARG_ANGLE, angle),
    createLabeledArg(ARG_LENGTH, length),
  ]
  if (tag) {
    args.push(createLabeledArg(ARG_TAG, createTagDeclarator(tag)))
  }
  return createCallExpressionStdLibKw('angledLine', null, args)
}

/**
 * It does not create the startSketchOn and it does not create the startProfileAt.
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn(XY)
 *  |> startProfileAt([0, 0], %)
 *  |> angledLine(angle = 0, length = 0, tag = $a)
 *  |> angledLine(angle = segAng(a) - 90, length = 0, tag = $b)
 *  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
 *  |> close()
 */
export const getRectangleCallExpressions = (
  rectangleOrigin: [number, number],
  tag: string
) => {
  return [
    angledLine(
      createLiteral(0), // 0 deg
      createLiteral(0), // This will be the width of the rectangle
      tag
    ),
    angledLine(
      createBinaryExpression([
        createCallExpressionStdLib('segAng', [createLocalName(tag)]),
        '+',
        createLiteral(90),
      ]), // 90 offset from the previous line
      createLiteral(0) // This will be the height of the rectangle
    ),
    angledLine(
      createCallExpressionStdLib('segAng', [createLocalName(tag)]), // same angle as the first line
      createUnaryExpression(
        createCallExpressionStdLib('segLen', [createLocalName(tag)]),
        '-'
      ) // negative height
    ),
    createCallExpressionStdLibKw('line', null, [
      createLabeledArg(
        ARG_END_ABSOLUTE,
        createArrayExpression([
          createCallExpressionStdLib('profileStartX', [
            createPipeSubstitution(),
          ]),
          createCallExpressionStdLib('profileStartY', [
            createPipeSubstitution(),
          ]),
        ])
      ),
    ]), // close the rectangle
    createCallExpressionStdLibKw('close', null, []),
  ]
}

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
  const firstEdge = pipeExpression.body[1] as CallExpressionKw
  mutateKwArg('angle', firstEdge, createLiteral(x >= 0 ? 0 : 180))
  mutateKwArg('length', firstEdge, createLiteral(Math.abs(x)))
  const secondEdge = pipeExpression.body[2] as CallExpressionKw
  // 90 offset from the previous line
  mutateKwArg(
    'angle',
    secondEdge,
    createBinaryExpression([
      createCallExpressionStdLib('segAng', [createLocalName(tag)]),
      Math.sign(y) === Math.sign(x) ? '+' : '-',
      createLiteral(90),
    ])
  )
  // This will be the height of the rectangle
  mutateKwArg('length', secondEdge, createLiteral(Math.abs(y)))
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
