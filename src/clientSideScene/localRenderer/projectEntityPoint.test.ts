import {
  BufferGeometry,
  Float32BufferAttribute,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { describe, expect, it } from 'vitest'
import {
  getEntityPoint,
  projectEntityPoint,
} from '@src/clientSideScene/localRenderer/projectEntityPoint'

describe('projected entity points', () => {
  it('places an edge point halfway along its length, on the polyline', () => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions([0, 0, 0, 2, 0, 0, 2, 0, 0, 2, 6, 0])
    expect(getEntityPoint(geometry, 'edge')).toEqual(new Vector3(2, 2, 0))
  })

  it('returns a point on a closed edge instead of its empty center', () => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions([
      1, 0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0, 0, -1, 0, 0, -1, 0, 1, 0,
      0,
    ])
    expect(getEntityPoint(geometry, 'edge')?.length()).toBeCloseTo(1)
  })

  it('uses an actual triangle when the face centroid is in a gap', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        [-3, 0, 0, -2, 0, 0, -2, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
        3
      )
    )
    geometry.setIndex([0, 1, 2, 3, 4, 5])
    expect(Math.abs(getEntityPoint(geometry, 'face')?.x ?? 0)).toBeGreaterThan(
      2
    )
  })

  it.each([
    new PerspectiveCamera(60, 2, 0.1, 100),
    new OrthographicCamera(-2, 2, 1, -1, 0.1, 100),
  ])('projects with viewport offsets and CSS dimensions (%s)', (camera) => {
    camera.position.z = 10
    camera.updateMatrixWorld(true)
    expect(
      projectEntityPoint(new Vector3(), camera, {
        left: 100,
        top: 40,
        width: 800,
        height: 400,
      })
    ).toEqual({ x: 500, y: 240 })
    expect(
      projectEntityPoint(new Vector3(0, 0, 11), camera, {
        left: 0,
        top: 0,
        width: 800,
        height: 400,
      })
    ).toBeUndefined()
    expect(
      projectEntityPoint(new Vector3(100, 0, 0), camera, {
        left: 0,
        top: 0,
        width: 800,
        height: 400,
      })
    ).toBeUndefined()
  })

  it('ignores empty geometry and collapsed viewports', () => {
    expect(getEntityPoint(new BufferGeometry(), 'face')).toBeUndefined()
    expect(getEntityPoint(new BufferGeometry(), 'edge')).toBeUndefined()
    expect(
      projectEntityPoint(new Vector3(), new PerspectiveCamera(), {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      })
    ).toBeUndefined()
  })
})
