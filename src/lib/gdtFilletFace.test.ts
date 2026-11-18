import type { Point3d } from '@kittycad/lib'
import { describe, expect, it } from 'vitest'
import {
  getCircularFrameGeometry,
  getCircularFramePosition,
  type CircularFaceBoundary,
} from '@src/lib/gdtCircularFrame'
import {
  getFilletFrameGeometry,
  getFilletProfileGeometry,
} from '@src/lib/gdtFilletFace'

describe('fillet-face radius', () => {
  it('uses a circular seam or matching end arcs and rejects ambiguous profiles', () => {
    const arc = (
      radius: number,
      seam = false,
      closed = false
    ): CircularFaceBoundary => ({
      ...getCircularFrameGeometry([
        { x: radius, y: 0, z: 0 },
        { x: radius, y: radius, z: 0 },
        { x: 0, y: radius, z: 0 },
      ])!,
      seam,
      closed,
    })
    expect(
      getFilletProfileGeometry([arc(2, true), arc(8), arc(10)])?.radius
    ).toBeCloseTo(2)
    expect(
      getFilletProfileGeometry([arc(2), arc(8), arc(2), arc(10)])?.radius
    ).toBeCloseTo(2)
    expect(getFilletProfileGeometry([arc(2)])).toBeUndefined()
    expect(
      getFilletProfileGeometry([arc(2), arc(2), arc(8), arc(8)])
    ).toBeUndefined()
    expect(
      getFilletProfileGeometry([arc(2, true), arc(3, true)])
    ).toBeUndefined()
    expect(
      getFilletProfileGeometry([arc(8, false, true), arc(8, false, true)])
    ).toBeUndefined()
  })
  it('measures scaled and rotated profile geometry and rejects ellipses', () => {
    const points = [
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ]
    const transform = (p: Point3d): Point3d => ({
      x: 100 + 3 * p.z,
      y: -20 + 3 * p.x,
      z: 10 + 3 * p.y,
    })
    const geometry = getCircularFrameGeometry(points.map(transform))!
    expect(
      getFilletProfileGeometry([{ ...geometry, closed: false, seam: true }])
        ?.radius
    ).toBeCloseTo(6)
    expect(
      getCircularFrameGeometry(points.map((p) => ({ ...p, y: p.y * 2 })))
    ).toBeUndefined()
  })
  it('positions a toroidal callout in its meridian plane on the leader side', () => {
    const circle = (radius: number, z: number) =>
      getCircularFrameGeometry(
        [
          [1, 0],
          [1, 1],
          [0, 1],
          [-1, 1],
          [-1, 0],
          [-1, -1],
          [0, -1],
          [1, -1],
          [1, 0],
        ].map(([x, y]) => ({ x: x * radius, y: y * radius, z }))
      )!
    const geometry = {
      ...getCircularFrameGeometry([
        { x: 10, y: 0, z: 8 },
        { x: 10, y: 0, z: 10 },
        { x: 8, y: 0, z: 10 },
      ])!,
      curvedAxis: true,
    }
    const frame = getFilletFrameGeometry(geometry, [
      circle(10, 8),
      circle(8, 10),
    ])
    expect(frame.radius).toBeCloseTo(2)
    expect(frame.framePlane).toBe('XZ')
    expect(frame.center.x).toBeCloseTo(-8)
    expect(frame.center.z).toBeCloseTo(8)
    expect(frame.radial.x).toBeLessThan(0)
    expect(frame.radial.z).toBeGreaterThan(0)
    expect(getCircularFramePosition(frame, 'XZ', 1)?.[0]).toBeLessThan(0)
  })
})
