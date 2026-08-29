import { describe, expect, it } from 'vitest'
import { type CameraFrame, viewDirection } from '@src/lib/scene/projection'

/** Looking down -Z from above, with +Y up on screen. */
const overhead: CameraFrame = {
  position: { x: 0, y: 0, z: 100 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovY: 45,
  orthographic: false,
}

describe('viewDirection', () => {
  it('puts a direction pointing right on the right', () => {
    const seen = viewDirection(overhead, { x: 1, y: 0, z: 0 })
    expect(seen.x).toBeCloseTo(1)
    expect(seen.y).toBeCloseTo(0)
    expect(seen.depth).toBeCloseTo(0)
  })

  it('flips y, because the screen counts downward', () => {
    // The camera's up is the screen's up, and a gizmo drawn without this puts
    // +Y at the bottom.
    expect(viewDirection(overhead, { x: 0, y: 1, z: 0 }).y).toBeCloseTo(-1)
  })

  it('reports what points away from the viewer as depth', () => {
    // Looking down at the origin, -Z goes into the screen and +Z comes out.
    expect(viewDirection(overhead, { x: 0, y: 0, z: -1 }).depth).toBeCloseTo(1)
    expect(viewDirection(overhead, { x: 0, y: 0, z: 1 }).depth).toBeCloseTo(-1)
  })

  it('normalises whatever length it was given', () => {
    const seen = viewDirection(overhead, { x: 7, y: 0, z: 0 })
    expect(seen.x).toBeCloseTo(1)
  })

  it('is unaffected by where the camera is, only by which way it faces', () => {
    const moved: CameraFrame = {
      ...overhead,
      position: { x: 50, y: 50, z: 300 },
      target: { x: 50, y: 50, z: 200 },
    }

    expect(viewDirection(moved, { x: 1, y: 0, z: 0 })).toEqual(
      viewDirection(overhead, { x: 1, y: 0, z: 0 })
    )
  })
})
