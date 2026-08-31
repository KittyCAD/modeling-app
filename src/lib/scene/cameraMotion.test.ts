import { describe, expect, it } from 'vitest'
import { dolly, orbit, pan, trackball } from '@src/lib/scene/cameraMotion'
import { type CameraFrame, viewBasis } from '@src/lib/scene/projection'

/** Looking along -Y from 100mm away, Z up. The front view. */
const front: CameraFrame = {
  position: { x: 0, y: -100, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  fovY: 45,
  orthographic: true,
}

const distanceOf = (camera: CameraFrame) =>
  Math.hypot(
    camera.position.x - camera.target.x,
    camera.position.y - camera.target.y,
    camera.position.z - camera.target.z
  )

describe('orbit', () => {
  it('keeps its distance from the target', () => {
    // An orbit that changed the distance would zoom while you turned.
    expect(distanceOf(orbit(front, 40, 25))).toBeCloseTo(100)
  })

  it('goes round when dragged sideways', () => {
    const turned = orbit(front, 90 / 0.3, 0)

    // A quarter turn: what was in front is now to one side.
    expect(Math.abs(turned.position.x)).toBeCloseTo(100)
    expect(turned.position.y).toBeCloseTo(0)
    expect(turned.position.z).toBeCloseTo(0)
  })

  /*
   * Which way "up" goes is the existing app's, not a choice made here: dragging
   * up decreases the client delta, which *increases* the polar angle, which takes
   * the camera under the model. Ported exactly, so it feels the same.
   */
  it('goes under the model when dragged up', () => {
    const turned = orbit(front, 0, -45 / 0.3)

    expect(turned.position.z).toBeCloseTo(-Math.SQRT1_2 * 100)
    expect(turned.position.y).toBeCloseTo(-Math.SQRT1_2 * 100)
  })

  /*
   * A limit rather than a wrap: a view that inverts under the pointer is
   * disorienting in a way no amount of skill makes comfortable.
   */
  it('stops short of the pole rather than flipping', () => {
    const turned = orbit(front, 0, -100000)

    // Nearly at the pole but not through it, so there is still a horizon.
    expect(Math.abs(turned.position.z)).toBeLessThan(100)
    expect(viewBasis(turned).up.z).toBeGreaterThan(0)
  })

  it('leaves the target where it was', () => {
    expect(orbit(front, 30, 30).target).toEqual(front.target)
  })

  it('does nothing to a camera sitting on its target', () => {
    const degenerate = { ...front, position: { x: 0, y: 0, z: 0 } }
    expect(orbit(degenerate, 10, 10)).toBe(degenerate)
  })
})

describe('trackball', () => {
  it('keeps its distance too', () => {
    expect(distanceOf(trackball(front, 30, 20))).toBeCloseTo(100)
  })

  /*
   * The difference from the spherical orbit: no up to preserve, so the view can
   * roll — and `up` has to travel with it, because a position alone cannot say
   * how far round the camera has turned.
   */
  it('carries the up vector round with it', () => {
    const rolled = trackball(front, 0, 90 / 0.3)

    expect(Math.hypot(rolled.up.x, rolled.up.y, rolled.up.z)).toBeCloseTo(1)
    expect(rolled.up.z).toBeCloseTo(0)
  })

  it('drops a reported orientation that no longer describes it', () => {
    const reported = {
      ...front,
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    }
    // Keeping it would have `viewBasis` prefer a rotation that disagrees with
    // the new vantage.
    expect(trackball(reported, 10, 0).orientation).toBeUndefined()
  })
})

describe('pan', () => {
  it('moves the camera and the target together', () => {
    const moved = pan(front, 10, 0, 2)

    // Both, or it would be an orbit.
    expect(moved.position.x).toBeCloseTo(moved.target.x - 0)
    expect(distanceOf(moved)).toBeCloseTo(100)
  })

  it('moves the model as far as the pointer went', () => {
    // Twenty pixels right at two millimetres a pixel.
    const moved = pan(front, 20, 0, 2)
    expect(Math.abs(moved.target.x)).toBeCloseTo(40)
  })

  it('treats screen y as growing downward', () => {
    const moved = pan(front, 0, 10, 1)
    expect(moved.target.z).toBeCloseTo(10)
  })
})

describe('dolly', () => {
  it('moves away for a factor above one', () => {
    expect(distanceOf(dolly(front, 2))).toBeCloseTo(200)
  })

  it('moves closer for a factor below one', () => {
    expect(distanceOf(dolly(front, 0.5))).toBeCloseTo(50)
  })

  it('keeps looking the same way', () => {
    const closer = dolly(front, 0.5)
    expect(closer.position.x).toBeCloseTo(0)
    expect(closer.position.z).toBeCloseTo(0)
    expect(closer.target).toEqual(front.target)
  })

  it('never reaches the target, however hard it is asked', () => {
    expect(distanceOf(dolly(front, 0))).toBeGreaterThan(0)
  })

  /*
   * One implementation for both projections, because the orthographic view height
   * is derived from the viewing distance — the arithmetic the engine uses.
   */
  it('zooms an orthographic camera by the same means', () => {
    const perspective = { ...front, orthographic: false }
    expect(distanceOf(dolly(perspective, 2))).toBeCloseTo(
      distanceOf(dolly(front, 2))
    )
  })
})
