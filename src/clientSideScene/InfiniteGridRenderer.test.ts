import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import {
  Euler,
  Group,
  type Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { describe, expect, it } from 'vitest'

const gridOptions = {
  majorGridSpacing: 1,
  minorGridsPerMajor: 4,
  majorColor: [0.3, 0.3, 0.3, 1] as [number, number, number, number],
  minorColor: [0.2, 0.2, 0.2, 1] as [number, number, number, number],
  fixedSizeGrid: true,
}

function intersectGridAtNdc(grid: InfiniteGridRenderer, ndc: Vector2) {
  const clipToGrid = grid.material.uniforms.uClipToGrid.value as Matrix4
  const unprojectToGrid = (ndcZ: number) => {
    const point = new Vector4(ndc.x, ndc.y, ndcZ, 1).applyMatrix4(clipToGrid)
    return new Vector3(point.x, point.y, point.z).divideScalar(point.w)
  }

  const rayStart = unprojectToGrid(-1)
  const rayDirection = unprojectToGrid(0).sub(rayStart)
  const distanceAlongRay = -rayStart.z / rayDirection.z
  return rayStart.addScaledVector(rayDirection, distanceAlongRay)
}

function expectProjectedPointToMapToGrid(
  camera: OrthographicCamera | PerspectiveCamera,
  sketchGroup: Group,
  grid: InfiniteGridRenderer,
  localPoint: Vector3
) {
  grid.update(camera, 100, 1, gridOptions)
  sketchGroup.updateMatrixWorld(true)

  const pointNdc = grid.localToWorld(localPoint.clone()).project(camera)
  const intersection = intersectGridAtNdc(
    grid,
    new Vector2(pointNdc.x, pointNdc.y)
  )

  expect(intersection.x).toBeCloseTo(localPoint.x)
  expect(intersection.y).toBeCloseTo(localPoint.y)
  expect(intersection.z).toBeCloseTo(0)
}

describe('InfiniteGridRenderer', () => {
  it('does not bound the infinite plane by the camera far clip', () => {
    const grid = new InfiniteGridRenderer()

    expect(grid.material.uniforms).not.toHaveProperty('uGridToClip')
    expect(grid.material.fragmentShader).not.toContain('ndcDepth')
  })

  it('only rejects intersections behind perspective cameras', () => {
    const orthographicCamera = new OrthographicCamera(-5, 5, 4, -4, 0.1, 100)
    orthographicCamera.position.set(0, 0, 10)
    orthographicCamera.lookAt(0, 0, 0)

    const perspectiveCamera = new PerspectiveCamera(45, 1, 0.1, 100)
    perspectiveCamera.position.set(0, 0, 10)
    perspectiveCamera.lookAt(0, 0, 0)

    const grid = new InfiniteGridRenderer()
    grid.update(orthographicCamera, 100, 1, gridOptions)
    expect(grid.material.uniforms.uPerspective.value).toBe(false)

    grid.update(perspectiveCamera, 100, 1, gridOptions)
    expect(grid.material.uniforms.uPerspective.value).toBe(true)
    expect(grid.material.fragmentShader).toContain(
      'if (uPerspective && distanceAlongRay < 0.0)'
    )
  })

  it('maps an orthographic camera ray into a translated and rotated sketch plane', () => {
    const camera = new OrthographicCamera(-5, 5, 4, -4, 0.1, 100)
    camera.position.set(7, 4, 12)

    const sketchGroup = new Group()
    sketchGroup.position.set(1.5, -2, 0.75)
    sketchGroup.setRotationFromEuler(new Euler(0.3, -0.4, 0.2))

    camera.lookAt(sketchGroup.position)

    const grid = new InfiniteGridRenderer()
    sketchGroup.add(grid)

    expectProjectedPointToMapToGrid(
      camera,
      sketchGroup,
      grid,
      new Vector3(2.25, -1.5, 0)
    )
  })

  it('maps a perspective camera ray into sketch-local coordinates', () => {
    const camera = new PerspectiveCamera(45, 1_000 / 800, 0.1, 100)
    camera.position.set(8, 6, 12)

    const sketchGroup = new Group()
    sketchGroup.position.set(-1, 0.5, 1)
    sketchGroup.setRotationFromEuler(new Euler(-0.25, 0.35, -0.15))

    camera.lookAt(sketchGroup.position)

    const grid = new InfiniteGridRenderer()
    sketchGroup.add(grid)

    expectProjectedPointToMapToGrid(
      camera,
      sketchGroup,
      grid,
      new Vector3(-1.75, 1.25, 0)
    )
  })

  it('measures grid scale after parent rotation', () => {
    const camera = new OrthographicCamera(-5, 5, 4, -4, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)

    const sketchGroup = new Group()
    const grid = new InfiniteGridRenderer()
    sketchGroup.add(grid)

    expect(grid.getPixelsPerBaseUnit(camera, [1_000, 800])).toBeCloseTo(100)

    sketchGroup.rotateY(Math.PI / 3)
    expect(grid.getPixelsPerBaseUnit(camera, [1_000, 800])).toBeCloseTo(100)
  })
})
