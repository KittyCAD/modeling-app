import { describe, expect, it } from 'vitest'
import type {
  ApiObject,
  ApiObjectKind,
  Freedom,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { drawingOf, flatten } from '@src/lib/sketch/drawing'

const at = (id: number, kind: ApiObjectKind): ApiObject => ({
  id,
  kind,
  label: `object${id}`,
  comments: '',
  artifact_id: `artifact-${id}`,
  source: { type: 'Simple', range: [0, 0, 0], node_path: null } as never,
})

const point = (
  id: number,
  x: number,
  y: number,
  freedom: Freedom = 'Free',
  units = 'Mm'
) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: { x: { value: x, units }, y: { value: y, units } },
      ctor: null,
      owner: null,
      freedom,
      constraints: [],
    },
  } as never)

const segment = (id: number, body: Record<string, unknown>) =>
  at(id, {
    type: 'Segment',
    segment: { ctor_applicable: true, construction: false, ...body },
  } as never)

const sketchOf = (objects: ApiObject[], segments: number[]) =>
  ({
    project: 0,
    file: 0,
    version: 1,
    objects: [
      ...objects,
      at(90, {
        type: 'Sketch',
        args: { on: { default: 'XY' } },
        plane: 99,
        segments,
        constraints: [],
      } as never),
    ],
    settings: {},
    sketch_mode: 90,
  }) as unknown as SceneGraph

/** ids 90 and up are the sketch, so a fixture can index its own objects. */
const graphWith = (objects: ApiObject[], segments: number[]) => {
  const filled: ApiObject[] = []
  for (const object of objects) filled[object.id] = object
  for (let index = 0; index < 90; index += 1) {
    filled[index] ??= at(index, { type: 'Nil' })
  }
  return sketchOf(filled, segments)
}

describe('drawingOf', () => {
  it('resolves a line to its two ends', () => {
    const graph = graphWith(
      [
        point(0, 0, 0, 'Fixed'),
        point(1, 10, 0),
        segment(2, { type: 'Line', start: 0, end: 1 }),
      ],
      [2]
    )

    expect(drawingOf(graph, 90).shapes).toEqual([
      {
        kind: 'line',
        id: 2,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 0 },
        construction: false,
        freedom: 'Free',
      },
    ])
  })

  it('converts positions into the millimetres the engine works in', () => {
    const graph = graphWith(
      [
        point(0, 0, 0, 'Free', 'Inch'),
        point(1, 2, 0, 'Free', 'Inch'),
        segment(2, { type: 'Line', start: 0, end: 1 }),
      ],
      [2]
    )

    const [shape] = drawingOf(graph, 90).shapes
    expect(shape?.kind === 'line' && shape.to.x).toBeCloseTo(50.8)
  })

  it('takes a circle’s radius from the point on its rim', () => {
    const graph = graphWith(
      [
        point(0, 3, 4),
        point(1, 0, 0),
        segment(2, { type: 'Circle', start: 0, center: 1 }),
      ],
      [2]
    )

    const [shape] = drawingOf(graph, 90).shapes
    expect(shape?.kind === 'circle' && shape.radius).toBe(5)
  })

  it('reads an arc’s direction, defaulting to counter-clockwise', () => {
    const graph = graphWith(
      [
        point(0, 5, 0),
        point(1, 0, 5),
        point(2, 0, 0),
        segment(3, { type: 'Arc', start: 0, end: 1, center: 2 }),
        segment(4, {
          type: 'Arc',
          start: 0,
          end: 1,
          center: 2,
          direction: 'cw',
        }),
      ],
      [3, 4]
    )

    const shapes = drawingOf(graph, 90).shapes
    expect(
      shapes.map((shape) => shape.kind === 'arc' && shape.clockwise)
    ).toEqual([false, true])
  })

  it('draws a spline as its control polygon rather than guessing the curve', () => {
    const graph = graphWith(
      [
        point(0, 0, 0),
        point(1, 5, 5),
        point(2, 10, 0),
        segment(3, {
          type: 'ControlPointSpline',
          controls: [0, 1, 2],
          degree: 2,
        }),
      ],
      [3]
    )

    const [shape] = drawingOf(graph, 90).shapes
    expect(shape?.kind).toBe('polyline')
    expect(shape?.kind === 'polyline' && shape.points).toHaveLength(3)
  })

  it('collects every vertex once, however many segments share it', () => {
    const graph = graphWith(
      [
        point(0, 0, 0),
        point(1, 10, 0),
        point(2, 10, 10),
        segment(3, { type: 'Line', start: 0, end: 1 }),
        segment(4, { type: 'Line', start: 1, end: 2 }),
      ],
      [3, 4]
    )

    expect(drawingOf(graph, 90).vertices.map((vertex) => vertex.id)).toEqual([
      0, 1, 2,
    ])
  })

  it('skips a segment whose points the graph has lost', () => {
    const graph = graphWith(
      [point(0, 0, 0), segment(2, { type: 'Line', start: 0, end: 42 })],
      [2]
    )

    // Half a sketch drawn correctly beats a whole one with a line to the origin.
    expect(drawingOf(graph, 90).shapes).toEqual([])
    expect(drawingOf(graph, 90).vertices).toHaveLength(1)
  })

  it('is empty for an id that is not a sketch', () => {
    expect(drawingOf(graphWith([], []), 5)).toEqual({
      shapes: [],
      vertices: [],
    })
  })
})

describe('flatten', () => {
  const base = { id: 1, construction: false, freedom: 'Free' } as const

  it('leaves a line as its two ends', () => {
    expect(
      flatten({
        ...base,
        kind: 'line',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
      })
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
  })

  it('closes a circle back on its start', () => {
    const points = flatten(
      { ...base, kind: 'circle', center: { x: 0, y: 0 }, radius: 1 },
      8
    )

    expect(points).toHaveLength(9)
    expect(points.at(-1)?.x).toBeCloseTo(1)
    expect(points.at(-1)?.y).toBeCloseTo(0)
  })

  it('samples only an arc’s own sweep', () => {
    const points = flatten(
      {
        ...base,
        kind: 'arc',
        center: { x: 0, y: 0 },
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        radius: 1,
        clockwise: false,
      },
      64
    )

    expect(points.at(0)?.x).toBeCloseTo(1)
    expect(points.at(-1)?.y).toBeCloseTo(1)
    // A quarter turn is a quarter of the samples, not all of them.
    expect(points.length).toBeLessThan(20)
  })

  it('goes the other way round for a clockwise arc', () => {
    const points = flatten(
      {
        ...base,
        kind: 'arc',
        center: { x: 0, y: 0 },
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        radius: 1,
        clockwise: true,
      },
      64
    )

    // Clockwise from +X to +Y is the long way, through -Y and -X.
    expect(points.some((point) => point.y < -0.9)).toBe(true)
  })
})
