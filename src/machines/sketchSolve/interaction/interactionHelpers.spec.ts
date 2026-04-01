import { describe, expect, it } from 'vitest'
import type { Coords2d } from '@src/lang/util'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Group, OrthographicCamera } from 'three'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'

function createObjectsArray(objects: ApiObject[]) {
  return createSceneGraphDelta(objects).new_graph.objects
}

function createConstraintApiObject({
  id,
  type,
}: {
  id: number
  type: 'Distance' | 'Angle'
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint:
        type === 'Distance'
          ? {
              type,
              points: [1, 2],
              distance: { value: 10, units: 'Mm' },
              source: {
                expr: '10',
                is_literal: true,
              },
            }
          : {
              type,
              lines: [1, 2],
              angle: { value: 90, units: 'Deg' },
              source: {
                expr: '90deg',
                is_literal: true,
              },
            },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  } as ApiObject
}

function createInvisibleConstraintApiObject({
  id,
  type,
}: {
  id: number
  type: 'Horizontal' | 'Vertical'
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: {
        type,
        line: 3,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  } as ApiObject
}

describe('findClosestApiObjects', () => {
  it('includes line segments when they are within the hover threshold', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const farPoint = createPointApiObject({ id: 4, x: 20, y: 20 })

    const result = findClosestApiObjects(
      [20, 3],
      createObjectsArray([start, end, line, farPoint]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(3)
    expect(result[0]?.distance).toBeCloseTo(3)
    expect(result).toHaveLength(1)
  })

  it('clamps line distance to the nearest endpoint', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })

    const result = findClosestApiObjects(
      [12, 4],
      createObjectsArray([start, end, line]),
      createMockSceneInfra()
    )
    const lineResult = result.find(({ apiObject }) => apiObject.id === 3)

    expect(lineResult?.distance).toBeCloseTo(Math.sqrt(20))
  })

  it('sorts points ahead of lines when both are within the hover threshold', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const point = createPointApiObject({ id: 4, x: 20, y: 4 })
    const mousePosition: Coords2d = [20, 2]

    const result = findClosestApiObjects(
      mousePosition,
      createObjectsArray([start, end, line, point]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[1]?.apiObject.id).toBe(3)
  })

  it('still prioritizes points over lines even when the line is closer', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const point = createPointApiObject({ id: 4, x: 20, y: 10 })
    const mousePosition: Coords2d = [20, 4]

    const result = findClosestApiObjects(
      mousePosition,
      createObjectsArray([start, end, line, point]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[1]?.apiObject.id).toBe(3)
  })

  it('prefers the higher id for coincident point candidates', () => {
    const pointA = createPointApiObject({ id: 4, x: 20, y: 2 })
    const pointB = createPointApiObject({ id: 8, x: 20 + 1e-9, y: 2 + 1e-9 })

    const result = findClosestApiObjects(
      [20, 2],
      createObjectsArray([pointA, pointB]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(8)
    expect(result[1]?.apiObject.id).toBe(4)
  })

  it('prioritizes visible non-visual constraints over overlapping points and lines', () => {
    const sceneInfra = createMockSceneInfra()
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    ;(sceneInfra as any).camControls = { camera }
    ;(sceneInfra as any).renderer = {
      domElement: { clientWidth: 800, clientHeight: 600 },
    }

    const start = createPointApiObject({ id: 1, x: -10, y: 0 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const point = createPointApiObject({ id: 4, x: 0.1, y: 0.1 })
    const constraint = createInvisibleConstraintApiObject({
      id: 10,
      type: 'Horizontal',
    })
    const group = new Group()
    group.name = String(constraint.id)
    const sketchSolveGroup = new Group()
    sketchSolveGroup.name = SKETCH_SOLVE_GROUP

    const badgeChild = new Group()
    badgeChild.userData.hitObjects = [
      {
        type: 'screenRect',
        center: [0, 0, 0],
        sizePx: [20, 20],
      },
    ]
    group.add(badgeChild)
    ;(sceneInfra.scene.getObjectByName as any).mockImplementation(
      (name: string) =>
        name === String(constraint.id)
          ? group
          : name === SKETCH_SOLVE_GROUP
            ? sketchSolveGroup
            : null
    )

    const result = findClosestApiObjects(
      [0.1, 0.1],
      createObjectsArray([start, end, line, point, constraint]),
      sceneInfra
    )

    expect(result[0]?.apiObject.id).toBe(10)
    expect(
      result.findIndex(({ apiObject }) => apiObject.id === 10)
    ).toBeLessThan(result.findIndex(({ apiObject }) => apiObject.id === 4))
    expect(
      result.findIndex(({ apiObject }) => apiObject.id === 10)
    ).toBeLessThan(result.findIndex(({ apiObject }) => apiObject.id === 3))
  })

  it('filters out candidates that are beyond the threshold', () => {
    const point = createPointApiObject({ id: 1, x: 30, y: 30 })

    const result = findClosestApiObjects(
      [0, 0],
      createObjectsArray([point]),
      createMockSceneInfra()
    )

    expect(result).toEqual([])
  })

  it('includes arcs when the mouse is within the arc stroke threshold', () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 30, y: 0 })
    const end = createPointApiObject({ id: 3, x: 0, y: 30 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

    const result = findClosestApiObjects(
      [21, 21],
      createObjectsArray([center, start, end, arc]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(4)
    expect(result[0]?.distance).toBeCloseTo(Math.abs(Math.sqrt(882) - 30), 5)
  })

  it('includes circles when the mouse is within the circle stroke threshold', () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 30, y: 0 })
    const circle = createCircleApiObject({ id: 3, center: 1, start: 2 })

    const result = findClosestApiObjects(
      [0, 22],
      createObjectsArray([center, start, circle]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(3)
    expect(result[0]?.distance).toBeCloseTo(8)
  })

  it('sorts lines and arcs by distance within the same priority bucket', () => {
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 16 })
    const lineEnd = createPointApiObject({ id: 2, x: 40, y: 16 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const arcCenter = createPointApiObject({ id: 4, x: 0, y: 0 })
    const arcStart = createPointApiObject({ id: 5, x: 30, y: 0 })
    const arcEnd = createPointApiObject({ id: 6, x: 0, y: 30 })
    const arc = createArcApiObject({ id: 7, center: 4, start: 5, end: 6 })

    const result = findClosestApiObjects(
      [21, 21],
      createObjectsArray([
        lineStart,
        lineEnd,
        line,
        arcCenter,
        arcStart,
        arcEnd,
        arc,
      ]),
      createMockSceneInfra()
    )

    expect(result[0]?.apiObject.id).toBe(7)
    expect(result[1]?.apiObject.id).toBe(3)
  })

  it('supports auto hit objects on constraint Line2 children', () => {
    const sceneInfra = createMockSceneInfra()
    const constraint = createConstraintApiObject({ id: 8, type: 'Distance' })
    const group = new Group()
    group.name = String(constraint.id)
    const geometry = new LineGeometry()
    geometry.setPositions([0, 0, 0, 40, 0, 0])
    const line = new Line2(geometry)
    line.userData.hitObjects = 'auto'
    group.add(line)
    ;(sceneInfra.scene.getObjectByName as any).mockImplementation(
      (name: string) => (name === String(constraint.id) ? group : null)
    )

    const result = findClosestApiObjects(
      [20, 4],
      createObjectsArray([constraint]),
      sceneInfra
    )

    expect(result[0]?.apiObject.id).toBe(8)
    expect(result[0]?.distance).toBeCloseTo(4)
  })

  it('supports explicit arc and line hit objects on constraint children', () => {
    const sceneInfra = createMockSceneInfra()
    const constraint = createConstraintApiObject({ id: 9, type: 'Angle' })
    const group = new Group()
    group.name = String(constraint.id)

    const arcChild = new Group()
    arcChild.userData.hitObjects = [
      {
        type: 'arc',
        center: [0, 0],
        start: [30, 0],
        end: [0, 30],
      },
    ]
    group.add(arcChild)

    const labelChild = new Group()
    labelChild.userData.hitObjects = [
      {
        type: 'line',
        line: [
          [50, 50],
          [70, 50],
        ],
      },
      {
        type: 'line',
        line: [
          [70, 50],
          [70, 60],
        ],
      },
      {
        type: 'line',
        line: [
          [70, 60],
          [50, 60],
        ],
      },
      {
        type: 'line',
        line: [
          [50, 60],
          [50, 50],
        ],
      },
    ]
    group.add(labelChild)
    ;(sceneInfra.scene.getObjectByName as any).mockImplementation(
      (name: string) => (name === String(constraint.id) ? group : null)
    )

    const arcResult = findClosestApiObjects(
      [21, 21],
      createObjectsArray([constraint]),
      sceneInfra
    )
    expect(arcResult[0]?.apiObject.id).toBe(9)
    expect(arcResult[0]?.distance).toBeCloseTo(Math.abs(Math.sqrt(882) - 30), 5)

    const labelResult = findClosestApiObjects(
      [52, 55],
      createObjectsArray([constraint]),
      sceneInfra
    )
    expect(labelResult[0]?.apiObject.id).toBe(9)
    expect(labelResult[0]?.distance).toBeCloseTo(2)
  })

  it('supports explicit screen-space rect hit objects on constraint children', () => {
    const sceneInfra = createMockSceneInfra()
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    ;(sceneInfra as any).camControls = { camera }
    ;(sceneInfra as any).renderer = {
      domElement: { clientWidth: 800, clientHeight: 600 },
    }

    const constraint = createConstraintApiObject({ id: 10, type: 'Angle' })
    const group = new Group()
    group.name = String(constraint.id)
    const sketchSolveGroup = new Group()
    sketchSolveGroup.name = SKETCH_SOLVE_GROUP

    const badgeChild = new Group()
    badgeChild.userData.hitObjects = [
      {
        type: 'screenRect',
        center: [0, 0, 0],
        sizePx: [20, 20],
      },
    ]
    group.add(badgeChild)
    ;(sceneInfra.scene.getObjectByName as any).mockImplementation(
      (name: string) =>
        name === String(constraint.id)
          ? group
          : name === SKETCH_SOLVE_GROUP
            ? sketchSolveGroup
            : null
    )

    const result = findClosestApiObjects(
      [0.1, 0.1],
      createObjectsArray([constraint]),
      sceneInfra
    )

    expect(result[0]?.apiObject.id).toBe(10)
    expect(result[0]?.distance).toBeGreaterThan(0)
    expect(result[0]?.distance).toBeLessThan(10)
  })
})
