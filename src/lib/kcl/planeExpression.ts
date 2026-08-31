import type { DefaultPlanePick } from '@src/contracts/defaultPlanes'

/** What each plane is called in KCL, seen from the front. */
const NAMES = {
  xy: 'XY',
  xz: 'XZ',
  yz: 'YZ',
} as const

/**
 * A clicked default plane, written down.
 *
 * The negative planes are not other planes; they are the same plane faced the
 * other way, and writing one is how you sketch on the underside of something
 * without a rotation. So a pick on the back of XY is `-XY`, and the sign is the
 * only thing the facing decides.
 *
 * Pure, and separate from whatever reported the pick, because which side you
 * clicked is a fact about a renderer and how to write it down is a fact about
 * KCL.
 */
export function planeExpression(pick: DefaultPlanePick): string {
  return `${pick.facing === 'back' ? '-' : ''}${NAMES[pick.plane]}`
}
