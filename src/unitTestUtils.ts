import {
  ARG_ANGLE,
  ARG_END_ABSOLUTE_X,
  ARG_END_ABSOLUTE_Y,
  ARG_LENGTH,
  ARG_LENGTH_X,
  ARG_LENGTH_Y,
} from '@src/lang/constants'
import { createArrayExpression } from '@src/lang/create'
import { findKwArg, findKwArgAny } from '@src/lang/util'
import type { CallExpressionKw, Expr } from '@src/lang/wasm'

/**
 * Throw x if it's an Error. Only use this in tests.
 */
export function assertNotErr<T>(x: T): asserts x is Exclude<T, Error> {
  if (x instanceof Error) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw x
  }
}

/**
Find the angle and some sort of length parameter from an angledLine-ish call.
E.g. finds the (angle, length) in angledLine or the (angle, endAbsoluteX) in angledLineToX
*/
export function findAngleLengthPair(call: CallExpressionKw): Expr | undefined {
  const angle = findKwArg(ARG_ANGLE, call)
  const lengthLike = findKwArgAny(
    [
      ARG_LENGTH,
      ARG_LENGTH_X,
      ARG_LENGTH_Y,
      ARG_END_ABSOLUTE_X,
      ARG_END_ABSOLUTE_Y,
    ],
    call
  )
  if (angle && lengthLike) {
    return createArrayExpression([angle, lengthLike])
  }
}
