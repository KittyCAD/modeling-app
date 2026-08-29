import { describe, expect, it } from 'vitest'
import {
  type Viewpoint,
  ease,
  slerp,
  tweenViewpoint,
} from '@src/lib/scene/cameraTween'

const front: Viewpoint = {
  position: { x: 0, y: -100, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
}

const right: Viewpoint = {
  position: { x: 100, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
}

describe('slerp', () => {
  it('takes the shortest arc between two directions', () => {
    const half = slerp({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5)

    expect(half.x).toBeCloseTo(Math.SQRT1_2)
    expect(half.y).toBeCloseTo(Math.SQRT1_2)
    // Still on the unit sphere, which a lerp would not be.
    expect(Math.hypot(half.x, half.y, half.z)).toBeCloseTo(1)
  })

  it('has nothing to do for two directions that are the same', () => {
    expect(slerp({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 2 }, 0.5)).toEqual({
      x: 0,
      y: 0,
      z: 1,
    })
  })

  it('goes round the side for a half turn, rather than stalling', () => {
    // Opposite directions have no shortest arc, and the naive formula divides
    // by zero. A 180° view flip is the commonest camera move there is.
    const half = slerp({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 0.5)

    expect(Math.hypot(half.x, half.y, half.z)).toBeCloseTo(1)
    expect(Math.abs(half.x)).toBeLessThan(0.01)
  })

  it('reaches both ends', () => {
    const a = { x: 1, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 1 }
    expect(slerp(a, b, 0).x).toBeCloseTo(1)
    expect(slerp(a, b, 1).z).toBeCloseTo(1)
  })
})

describe('tweenViewpoint', () => {
  it('starts and finishes where it was told to', () => {
    expect(tweenViewpoint(front, right, 0).position.y).toBeCloseTo(-100)
    expect(tweenViewpoint(front, right, 1).position.x).toBeCloseTo(100)
  })

  it('keeps its distance from the target all the way round', () => {
    // The naive lerp of two positions cuts the corner, which for a front-to-back
    // swing means dragging the camera through the part.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const at = tweenViewpoint(front, right, t)
      expect(
        Math.hypot(at.position.x, at.position.y, at.position.z)
      ).toBeCloseTo(100)
    }
  })

  it('interpolates the distance when the two differ', () => {
    const near: Viewpoint = { ...right, position: { x: 50, y: 0, z: 0 } }
    const at = tweenViewpoint(front, near, 0.5)

    expect(Math.hypot(at.position.x, at.position.y, at.position.z)).toBeCloseTo(
      75
    )
  })

  it('moves the target too, so looking at another plane arrives there', () => {
    const elsewhere: Viewpoint = {
      position: { x: 20, y: 10, z: 100 },
      target: { x: 20, y: 10, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    }

    const at = tweenViewpoint(front, elsewhere, 1)
    expect(at.target).toEqual({ x: 20, y: 10, z: 0 })
  })

  it('carries the up vector round with it', () => {
    const rolled: Viewpoint = { ...front, up: { x: 0, y: 1, z: 0 } }
    const at = tweenViewpoint(front, rolled, 0.5)

    expect(Math.hypot(at.up.x, at.up.y, at.up.z)).toBeCloseTo(1)
  })
})

describe('ease', () => {
  it('is slow at both ends and fastest in the middle', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.5)
    expect(ease(0.1)).toBeLessThan(0.1)
    expect(ease(0.9)).toBeGreaterThan(0.9)
  })

  it('clamps, so a late frame cannot overshoot the destination', () => {
    expect(ease(1.4)).toBe(1)
    expect(ease(-0.2)).toBe(0)
  })
})
