import { describe, expect, it } from 'vitest'
import {
  type CameraFrame,
  type PlaneFrame,
  pixelsPerUnit,
  planeToWorld,
  projectPoint,
  unprojectToPlane,
  viewBasis,
  worldToPlane,
} from '@src/lib/scene/projection'

/** Looking down -Z at the origin from 100mm up, with +Y up on screen. */
const overhead: CameraFrame = {
  position: { x: 0, y: 0, z: 100 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovY: 45,
  orthographic: false,
}

/** The XY plane, which is what `sketch(on = XY)` draws on. */
const xy: PlaneFrame = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
}

const viewport = { width: 800, height: 400 }

describe('viewBasis', () => {
  it('orthogonalises the reported up against the view direction', () => {
    // World up is +Z, and the camera is looking along -Z from above: the up it
    // reports is useless as-is and only says which way is not rolled.
    const basis = viewBasis({
      ...overhead,
      up: { x: 0, y: 0.9, z: 0.4 },
    })

    expect(basis.up.z).toBeCloseTo(0)
    expect(basis.up.y).toBeCloseTo(1)
  })

  it('still has a basis when looking straight along the up vector', () => {
    const basis = viewBasis({
      position: { x: 0, y: 0, z: 100 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      fovY: 45,
      orthographic: false,
    })

    // Degenerate input, but a drawing still has to go somewhere: the basis is
    // perpendicular rather than collapsed.
    expect(Math.hypot(basis.right.x, basis.right.y, basis.right.z)).toBeCloseTo(
      1
    )
    expect(Math.hypot(basis.up.x, basis.up.y, basis.up.z)).toBeCloseTo(1)
  })
})

describe('projectPoint', () => {
  it('puts the look-at centre in the middle of the viewport', () => {
    expect(projectPoint(overhead, { x: 0, y: 0, z: 0 }, viewport)).toEqual({
      x: 400,
      y: 200,
    })
  })

  it('grows y downward, opposite the camera up', () => {
    const above = projectPoint(overhead, { x: 0, y: 10, z: 0 }, viewport)
    expect(above && above.y).toBeLessThan(200)
  })

  it('spreads x by the aspect ratio, not by the field of view alone', () => {
    // Half the view is 100 * tan(22.5°) tall; the viewport is twice as wide as
    // it is tall, so the same distance sideways covers half as much of it.
    const halfHeight = 100 * Math.tan(Math.PI / 8)
    const up = projectPoint(overhead, { x: 0, y: halfHeight, z: 0 }, viewport)
    const right = projectPoint(
      overhead,
      { x: halfHeight, y: 0, z: 0 },
      viewport
    )

    expect(up?.y).toBeCloseTo(0)
    expect(right?.x).toBeCloseTo(600)
  })

  it('refuses a point behind a perspective camera', () => {
    expect(projectPoint(overhead, { x: 0, y: 0, z: 200 }, viewport)).toBeNull()
  })

  it('does not scale with depth under orthographic projection', () => {
    const ortho = { ...overhead, orthographic: true }
    const near = projectPoint(ortho, { x: 10, y: 0, z: 0 }, viewport)
    const far = projectPoint(ortho, { x: 10, y: 0, z: -50 }, viewport)

    expect(near?.x).toBeCloseTo(far?.x ?? Number.NaN)
  })

  it('has nowhere to put anything in a viewport with no area', () => {
    expect(
      projectPoint(overhead, { x: 0, y: 0, z: 0 }, { width: 0, height: 0 })
    ).toBeNull()
  })
})

describe('unprojectToPlane', () => {
  it('round-trips a point through the screen and back', () => {
    const point = { x: 12, y: -7 }
    const screen = projectPoint(overhead, planeToWorld(xy, point), viewport)
    expect(screen).not.toBeNull()

    const back = unprojectToPlane(overhead, screen!, viewport, xy)
    expect(back?.x).toBeCloseTo(point.x)
    expect(back?.y).toBeCloseTo(point.y)
  })

  it('round-trips under orthographic projection too', () => {
    const ortho = { ...overhead, orthographic: true }
    const point = { x: -30, y: 4 }
    const screen = projectPoint(ortho, planeToWorld(xy, point), viewport)

    const back = unprojectToPlane(ortho, screen!, viewport, xy)
    expect(back?.x).toBeCloseTo(point.x)
    expect(back?.y).toBeCloseTo(point.y)
  })

  it('round-trips on a plane that is not axis-aligned', () => {
    // A sketch on the face of a swept solid lands here: an origin off the world
    // origin and axes that are not the world's.
    const tilted: PlaneFrame = {
      origin: { x: 5, y: 5, z: 5 },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 1, y: 0, z: 0 },
    }
    const camera: CameraFrame = {
      position: { x: 120, y: 5, z: 5 },
      target: { x: 5, y: 5, z: 5 },
      up: { x: 0, y: 0, z: 1 },
      fovY: 45,
      orthographic: false,
    }

    const point = { x: 8, y: -3 }
    const screen = projectPoint(camera, planeToWorld(tilted, point), viewport)
    const back = unprojectToPlane(camera, screen!, viewport, tilted)

    expect(back?.x).toBeCloseTo(point.x)
    expect(back?.y).toBeCloseTo(point.y)
  })

  it('has no answer for a plane seen exactly edge-on', () => {
    const edgeOn: PlaneFrame = {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: 1, z: 0 },
    }

    expect(
      unprojectToPlane(overhead, { x: 400, y: 200 }, viewport, edgeOn)
    ).toBeNull()
  })

  it('has no answer for a plane behind a perspective camera', () => {
    const behind: PlaneFrame = { ...xy, origin: { x: 0, y: 0, z: 500 } }
    expect(
      unprojectToPlane(overhead, { x: 400, y: 200 }, viewport, behind)
    ).toBeNull()
  })
})

describe('worldToPlane', () => {
  it('measures from the plane origin along its own axes', () => {
    const tilted: PlaneFrame = {
      origin: { x: 1, y: 2, z: 3 },
      // Deliberately not unit length: an axis is a direction, and a caller
      // should not have to normalise before asking.
      xAxis: { x: 0, y: 4, z: 0 },
      yAxis: { x: 0, y: 0, z: 2 },
      zAxis: { x: 1, y: 0, z: 0 },
    }

    expect(worldToPlane(tilted, { x: 1, y: 5, z: 4 })).toEqual({ x: 3, y: 1 })
  })
})

describe('pixelsPerUnit', () => {
  it('reports how big a millimetre is on screen', () => {
    // Half the view is 100 * tan(22.5°) ≈ 41.4mm tall over 400 pixels.
    const expected = 200 / (100 * Math.tan(Math.PI / 8))
    expect(pixelsPerUnit(overhead, xy, { x: 0, y: 0 }, viewport)).toBeCloseTo(
      expected,
      1
    )
  })

  it('is zero where nothing can be picked', () => {
    const behind: PlaneFrame = { ...xy, origin: { x: 0, y: 0, z: 500 } }
    expect(pixelsPerUnit(overhead, behind, { x: 0, y: 0 }, viewport)).toBe(0)
  })
})

describe('following a camera that has rolled', () => {
  /**
   * The engine's rotation for a camera looking down -Z with a given roll.
   *
   * Built the way the engine's is — the *inverse* of the camera's own rotation,
   * which is the convention the existing app inverts back out on receipt.
   */
  const rolledOrientation = (radians: number) => {
    // A rotation of `radians` about the view axis, then inverted.
    const half = radians / 2
    return {
      x: 0,
      y: 0,
      z: -Math.sin(half),
      w: Math.cos(half),
    }
  }

  it('takes the roll from the reported rotation, not from the up hint', () => {
    // A quarter turn about the view axis. The up *hint* still says +Y, which is
    // the whole problem: under a trackball orbit it is stale.
    const rolled: CameraFrame = {
      ...overhead,
      up: { x: 0, y: 1, z: 0 },
      orientation: rolledOrientation(Math.PI / 2),
    }

    const basis = viewBasis(rolled)

    // Rolled a quarter turn, so what was up is now to one side.
    expect(Math.abs(basis.up.x)).toBeCloseTo(1)
    expect(Math.abs(basis.up.y)).toBeCloseTo(0)
    // And the camera is still looking the same way.
    expect(basis.forward.z).toBeCloseTo(-1)
  })

  it('ignores a rotation that does not describe this camera', () => {
    // Neither the quaternion nor its inverse agrees with the vantage and centre,
    // so the up vector is used and the answer is the unrolled one.
    const inconsistent: CameraFrame = {
      ...overhead,
      orientation: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
    }

    expect(viewBasis(inconsistent).up.y).toBeCloseTo(1)
  })

  it('agrees with the up vector when there is no roll to lose', () => {
    const level: CameraFrame = {
      ...overhead,
      orientation: rolledOrientation(0),
    }

    const withOrientation = viewBasis(level)
    const withoutOrientation = viewBasis(overhead)

    expect(withOrientation.up.y).toBeCloseTo(withoutOrientation.up.y)
    expect(withOrientation.right.x).toBeCloseTo(withoutOrientation.right.x)
  })

  it('still projects a point correctly through a rolled basis', () => {
    const rolled: CameraFrame = {
      ...overhead,
      orientation: rolledOrientation(Math.PI / 2),
    }

    // A point that was above the centre is now beside it.
    const seen = projectPoint(rolled, { x: 0, y: 10, z: 0 }, viewport)
    expect(seen?.y).toBeCloseTo(200)
    expect(seen?.x).not.toBeCloseTo(400)
  })
})
