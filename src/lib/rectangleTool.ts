import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  ARG_ANGLE,
  ARG_AT,
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
import { mutateKwArgOnly } from '@src/lang/modifyAst'
import {
  findKwArg,
  isArrayExpression,
  isCallExpressionKw,
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
 * It does not create the startSketchOn and it does not create the startProfile.
 * Returns AST expressions for this KCL code:
 * const yo = startSketchOn(XY)
 *  |> startProfile(at = [0, 0])
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
          createCallExpressionStdLibKw(
            'profileStartX',
            createPipeSubstitution(),
            []
          ),
          createCallExpressionStdLibKw(
            'profileStartY',
            createPipeSubstitution(),
            []
          ),
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
  mutateKwArgOnly('angle', firstEdge, createLiteral(x >= 0 ? 0 : 180))
  mutateKwArgOnly('length', firstEdge, createLiteral(Math.abs(x)))
  const secondEdge = pipeExpression.body[2] as CallExpressionKw
  // 90 offset from the previous line
  mutateKwArgOnly(
    'angle',
    secondEdge,
    createBinaryExpression([
      createCallExpressionStdLib('segAng', [createLocalName(tag)]),
      Math.sign(y) === Math.sign(x) ? '+' : '-',
      createLiteral(90),
    ])
  )
  // This will be the height of the rectangle
  mutateKwArgOnly('length', secondEdge, createLiteral(Math.abs(y)))
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
): undefined | Error {
  let startX = originX - Math.abs(deltaX)
  let startY = originY - Math.abs(deltaY)

  {
    let callExpression = pipeExpression.body[0]
    if (!isCallExpressionKw(callExpression)) {
      return new Error(`Expected call expression, got ${callExpression.type}`)
    }
    const arrayExpression = findKwArg(ARG_AT, callExpression)
    if (!isArrayExpression(arrayExpression)) {
      return new Error(
        `Expected array expression, got ${arrayExpression?.type}`
      )
    }
    const at = createArrayExpression([
      createLiteral(roundOff(startX)),
      createLiteral(roundOff(startY)),
    ])
    mutateKwArgOnly(ARG_AT, callExpression, at)
  }

  const twoX = deltaX * 2
  const twoY = deltaY * 2

  {
    // Should be an angledLine
    const edge0 = pipeExpression.body[1]
    if (!isCallExpressionKw(edge0)) {
      return new Error(
        `Expected rectangle edge 0 to be CallExpressionKw, but it was a ${edge0.type}`
      )
    }
    mutateKwArgOnly(ARG_LENGTH, edge0, createLiteral(Math.abs(twoX)))
  }

  {
    // Should be an angledLine
    const edge1 = pipeExpression.body[2]
    if (!isCallExpressionKw(edge1)) {
      return new Error(
        `Expected rectangle edge 1 to be CallExpressionKw, but it was a ${edge1.type}`
      )
    }
    // Calculate new angle. It's 90 offset from the previous line.
    const oldAngle = findKwArg(ARG_ANGLE, edge1)
    if (oldAngle === undefined) {
      return new Error('rectangle edge should have an angle, but did not')
    }
    let oldAngleOperator
    if (oldAngle.type !== 'BinaryExpression') {
      return new Error('rectangle edge should have an operator, but did not')
    }
    oldAngleOperator = oldAngle.operator
    const newAngle = createBinaryExpression([
      createCallExpressionStdLib('segAng', [createLocalName(tag)]),
      oldAngleOperator,
      createLiteral(90),
    ])

    // Calculate new height.
    const newLength = createLiteral(Math.abs(twoY))

    // Update old rectangle.
    mutateKwArgOnly(ARG_ANGLE, edge1, newAngle)
    mutateKwArgOnly(ARG_LENGTH, edge1, newLength)
  }
}
