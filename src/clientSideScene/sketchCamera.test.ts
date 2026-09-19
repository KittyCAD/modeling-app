import { getSketchCameraFrame } from '@src/clientSideScene/sketchCamera'
import { BoxGeometry, Group, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

describe('engine-style sketch framing', () => {
  it('targets the plane origin in world millimetres, regardless of sketch bounds', () => {
    const scene = new Group()
    scene.scale.setScalar(25.4)
    const sketch = new Group()
    sketch.position.set(10, 20, 30)
    sketch.rotateX(Math.PI / 2)
    scene.add(sketch)
    const body = new Mesh(new BoxGeometry(10000, 10000, 10000))
    body.position.set(1000, 2000, 0)
    sketch.add(body)

    const eye = new Vector3(254, 0, 762)
    const frame = getSketchCameraFrame(sketch, eye)
    expect(frame.target.toArray()).toEqual([254, 508, 762])
    expect(frame.distance).toBeCloseTo(508)
    expect(frame.quaternion.angleTo(sketch.quaternion)).toBeLessThan(1e-8)
  })

  it('retains the influence of the 3D camera distance instead of fitting', () => {
    const sketch = new Group()
    const near = getSketchCameraFrame(sketch, new Vector3(0, 0, 100))
    const far = getSketchCameraFrame(sketch, new Vector3(0, 0, 1000))
    expect(near.distance).toBe(100)
    expect(far.distance).toBe(1000)
  })

  it('faces the viewer for planes approached from behind', () => {
    const frame = getSketchCameraFrame(new Group(), new Vector3(0, 0, -100))
    const normal = new Vector3(0, 0, 1).applyQuaternion(frame.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(frame.quaternion)
    expect(normal.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-8)
    expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-8)
  })

  it('targets a body face centre in base units without flipping the face normal', () => {
    const scene = new Group()
    scene.scale.setScalar(25.4)
    const sketch = new Group()
    sketch.position.set(100, 200, 3)
    scene.add(sketch)
    const eye = new Vector3(0, 0, -100)
    const frame = getSketchCameraFrame(sketch, eye, new Vector3(1, 2, 3))
    const expected = new Vector3(1, 2, 3).multiplyScalar(25.4)
    expect(frame.target.distanceTo(expected)).toBeLessThan(1e-8)
    expect(frame.distance).toBeCloseTo(eye.distanceTo(expected))
    expect(frame.quaternion.angleTo(sketch.quaternion)).toBeLessThan(1e-8)
  })

  it('keeps an empty sketch usable when the eye is at its origin', () => {
    const frame = getSketchCameraFrame(new Group(), new Vector3())
    expect(frame.distance).toBeGreaterThan(0)
  })
})
