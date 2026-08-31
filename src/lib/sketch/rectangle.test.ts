import { describe, expect, it, vi } from 'vitest'
import type {
  ApiConstraint,
  ApiObject,
  ApiObjectKind,
  SceneGraph,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  buildRectangle,
  cornerEdits,
  cornersFor,
  initialCorners,
  rectangleConstraints,
  sidesOf,
} from '@src/lib/sketch/rectangle'

const at = (id: number, kind: ApiObjectKind): ApiObject => ({
  id,
  kind,
  label: `object${id}`,
  comments: '',
  artifact_id: `artifact-${id}`,
  source: { type: 'Simple', range: [0, 0, 0], node_path: null } as never,
})

const point = (id: number) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Point',
      position: { x: { value: 0, units: 'Mm' }, y: { value: 0, units: 'Mm' } },
      ctor: null,
      owner: null,
      freedom: 'Free',
      constraints: [],
    },
  } as never)

const lineAt = (id: number, start: number, end: number) =>
  at(id, {
    type: 'Segment',
    segment: {
      type: 'Line',
      start,
      end,
      ctor_applicable: true,
      construction: false,
    },
  } as never)

const graphOf = (objects: ApiObject[]) => ({ objects }) as unknown as SceneGraph

/** Four lines with ids 2, 5, 8, 11 and their points either side of each. */
const fourLines = () =>
  graphOf([
    point(0),
    point(1),
    lineAt(2, 0, 1),
    point(3),
    point(4),
    lineAt(5, 3, 4),
    point(6),
    point(7),
    lineAt(8, 6, 7),
    point(9),
    point(10),
    lineAt(11, 9, 10),
  ])

describe('where a rectangle’s corners go', () => {
  /*
   * The clicked corner stays `start1` even when the drag crosses into another
   * quadrant. Anything constrained to it — a snap, most often — should stay on
   * the corner the user picked rather than jumping to whichever is now
   * bottom-left.
   */
  it('keeps the clicked corner where it was clicked', () => {
    const found = cornersFor(
      'cornerRectangle',
      { x: 0, y: 0 },
      { x: -10, y: -4 }
    )

    expect(found.start1).toEqual({ x: 0, y: 0 })
    expect(found.start3).toEqual({ x: -10, y: -4 })
  })

  it('grows a centred rectangle both ways at once', () => {
    const found = cornersFor('centerRectangle', { x: 0, y: 0 }, { x: 3, y: 2 })

    expect(found).toEqual({
      start1: { x: -3, y: -2 },
      start2: { x: 3, y: -2 },
      start3: { x: 3, y: 2 },
      start4: { x: -3, y: 2 },
    })
  })

  /*
   * Small but not zero: eight constraints are put on it the moment it exists,
   * and a degenerate rectangle has no orientation for the horizontal and the
   * perpendicular to hold.
   */
  it('starts with a rectangle that is small rather than empty', () => {
    const found = initialCorners({ x: 0, y: 0 }, 'cornerRectangle')

    expect(found.start3.x).toBeGreaterThan(0)
    expect(found.start3.y).toBeGreaterThan(0)
  })

  it('draws the four sides as a closed loop', () => {
    const sides = sidesOf(
      cornersFor('cornerRectangle', { x: 0, y: 0 }, { x: 4, y: 2 }),
      'Mm'
    )

    expect(sides).toHaveLength(4)
    const ends = sides.map((side) =>
      side.type === 'Line' ? [side.start, side.end] : null
    )
    // Each side starts where the last one ended.
    expect(ends[1]?.[0]).toEqual(ends[0]?.[1])
    expect(ends[2]?.[0]).toEqual(ends[1]?.[1])
    expect(ends[3]?.[0]).toEqual(ends[2]?.[1])
    expect(ends[0]?.[0]).toEqual(ends[3]?.[1])
  })
})

describe('what makes four lines a rectangle', () => {
  it('closes the loop, squares one corner and pins the orientation', () => {
    const found = rectangleConstraints(fourLines(), [2, 5, 8, 11])

    expect(found).toEqual([
      { type: 'Coincident', segments: [1, 3] },
      { type: 'Coincident', segments: [4, 6] },
      { type: 'Coincident', segments: [7, 9] },
      { type: 'Coincident', segments: [10, 0] },
      { type: 'Parallel', lines: [5, 11] },
      { type: 'Parallel', lines: [8, 2] },
      { type: 'Perpendicular', lines: [2, 5] },
      { type: 'Horizontal', line: 8 },
    ])
  })

  it('says nothing when a side is missing', () => {
    expect(rectangleConstraints(fourLines(), [2, 5])).toEqual([])
    expect(rectangleConstraints(graphOf([]), [2, 5, 8, 11])).toEqual([])
  })
})

describe('dragging a rectangle out', () => {
  it('respecifies all four sides from the corners', () => {
    const edits = cornerEdits(
      { lineIds: [2, 5, 8, 11], segmentIds: [], constraintIds: [] },
      cornersFor('cornerRectangle', { x: 0, y: 0 }, { x: 4, y: 2 }),
      'Mm'
    )

    expect(edits.map((edit) => edit.id)).toEqual([2, 5, 8, 11])
    expect(edits[0]?.ctor).toMatchObject({ type: 'Line' })
  })
})

describe('building one', () => {
  const writer = () => {
    const graph = fourLines()
    const lineIds = [2, 5, 8, 11]
    let written = 0
    let constraints = 0

    return {
      addSegment: vi.fn(
        async (
          _sketch: number,
          _segment: SegmentCtor,
          _options?: { label?: string; checkpoint?: boolean }
        ) => {
          const id = lineIds[written]
          written += 1
          return {
            text: `after ${written} lines`,
            graph,
            newObjects: id === undefined ? [] : [id - 2, id - 1, id],
            invalidatesIds: false,
          }
        }
      ),
      addConstraint: vi.fn(
        async (
          _sketch: number,
          _c: ApiConstraint,
          _options?: { checkpoint?: boolean }
        ) => {
          // Appended at its own index, because an object's id *is* its index in
          // the graph and a lookup checks that.
          const id = graph.objects.length + constraints
          constraints += 1

          return {
            text: `after ${constraints} constraints`,
            graph: graphOf([
              ...graph.objects,
              ...Array.from({ length: constraints }, (_, index) =>
                at(graph.objects.length + index, {
                  type: 'Constraint',
                  constraint: { type: 'Horizontal', line: 8 },
                } as never)
              ),
            ]),
            newObjects: [id],
            invalidatesIds: false,
          }
        }
      ),
    }
  }

  it('writes the lines first, then the constraints on them', async () => {
    const api = writer()

    const built = await buildRectangle(
      api,
      0,
      { x: 0, y: 0 },
      'cornerRectangle',
      'Mm'
    )

    /*
     * In that order and not interleaved: a constraint names the *points* the
     * lines ended up with, and those only exist once the lines do.
     */
    expect(api.addSegment).toHaveBeenCalledTimes(4)
    expect(api.addConstraint).toHaveBeenCalledTimes(8)
    expect(built?.draft.lineIds).toEqual([2, 5, 8, 11])
    expect(built?.draft.constraintIds).toHaveLength(8)
  })

  it('checkpoints once, at the end', async () => {
    const api = writer()

    await buildRectangle(api, 0, { x: 0, y: 0 }, 'cornerRectangle', 'Mm')

    // Twelve calls are one thing somebody did, and should be one thing to undo.
    const checkpoints = [
      ...api.addSegment.mock.calls.map((call) => call[2]),
      ...api.addConstraint.mock.calls.map((call) => call[2]),
    ].filter((options) => options?.checkpoint)
    expect(checkpoints).toHaveLength(1)
  })

  it('hands back only the last answer, which contains all of them', async () => {
    const api = writer()

    const built = await buildRectangle(
      api,
      0,
      { x: 0, y: 0 },
      'cornerRectangle',
      'Mm'
    )

    // Writing each one would put twelve edits and twelve undo entries into the
    // buffer for one rectangle.
    expect(built?.outcome.text).toBe('after 8 constraints')
  })

  it('gives up when a line does not come back', async () => {
    const api = {
      addSegment: vi.fn(async () => ({
        text: '',
        graph: graphOf([]),
        newObjects: [],
        invalidatesIds: false,
      })),
      addConstraint: vi.fn(async () => ({
        text: '',
        graph: graphOf([]),
        newObjects: [],
        invalidatesIds: false,
      })),
    }

    // A rectangle missing a side is not something to carry on constraining: the
    // ids would name the wrong objects.
    expect(
      await buildRectangle(api, 0, { x: 0, y: 0 }, 'cornerRectangle', 'Mm')
    ).toBeNull()
    expect(api.addConstraint).not.toHaveBeenCalled()
  })
})
