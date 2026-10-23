import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  generateConstraintCandidates,
  rankConstraintSuggestions,
} from '@src/machines/sketchSolve/constraints/constraintSuggestions'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, vi } from 'vitest'

const sketchId = 10

function sketch(
  constraints: number[] = [],
  segments: number[] = []
): ApiObject {
  return {
    id: sketchId,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments,
      constraints,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function constraintObject(id: number, constraint: ApiConstraint): ApiObject {
  return {
    id,
    kind: { type: 'Constraint', constraint },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function objectArray(objects: ApiObject[]) {
  const segmentIds = objects
    .filter((object) => object.kind.type === 'Segment')
    .map((object) => object.id)
  return createSceneGraphDelta(
    objects.map((object) =>
      object.kind.type === 'Sketch' && object.kind.segments.length === 0
        ? {
            ...object,
            kind: { ...object.kind, segments: segmentIds },
          }
        : object
    )
  ).new_graph.objects
}

describe('constraint suggestions', () => {
  it('suggests an axis only for a nearly aligned free line', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0.4 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])

    expect(generateConstraintCandidates([3], sketchId, objects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: { type: 'Horizontal', line: 3 },
        }),
      ])
    )
    expect(generateConstraintCandidates([1], sketchId, objects)).toEqual([])
    expect(generateConstraintCandidates([], sketchId, objects)).toEqual([])
  })

  it('ignores geometry selected from a different sketch', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0.2 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      createPointApiObject({ id: 4, x: 20, y: 0 }),
      createPointApiObject({ id: 5, x: 30, y: 0.2 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      sketch([], [1, 2, 3]),
    ])
    expect(generateConstraintCandidates([6], sketchId, objects)).toEqual([])
    expect(generateConstraintCandidates([3], sketchId, objects)).not.toEqual([])
  })

  it('works with one fixed endpoint but ignores an owned support line', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    if (start.kind.type === 'Segment' && start.kind.segment.type === 'Point') {
      start.kind.segment.freedom = 'Fixed'
    }
    const objects = objectArray([
      start,
      createPointApiObject({ id: 2, x: 10, y: 0.1 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])
    expect(
      generateConstraintCandidates([3], sketchId, objects).some(
        ({ payload }) => payload.type === 'Horizontal'
      )
    ).toBe(true)

    const supportGeometry = [...objects]
    supportGeometry[3] = createLineApiObject({
      id: 3,
      start: 1,
      end: 2,
      owner: 99,
    })
    expect(
      generateConstraintCandidates([3], sketchId, supportGeometry)
    ).toEqual([])
  })

  it('does not repeat a constraint already on the sketch', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch([11]),
      constraintObject(11, { type: 'Horizontal', line: 3 }),
    ])

    expect(
      generateConstraintCandidates([3], sketchId, objects).some(
        ({ payload }) => payload.type === 'Horizontal'
      )
    ).toBe(false)
  })

  it('suggests equal length and equal radius only for similar sizes', () => {
    const lines = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0 }),
      createPointApiObject({ id: 4, x: 50, y: 0 }),
      createPointApiObject({ id: 5, x: 60.4, y: 0 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      sketch(),
    ])
    expect(generateConstraintCandidates([3, 6], sketchId, lines)).toMatchObject(
      [{ payload: { type: 'LinesEqualLength' } }]
    )

    const circles = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0 }),
      createPointApiObject({ id: 4, x: 50, y: 0 }),
      createPointApiObject({ id: 5, x: 60.4, y: 0 }),
      createCircleApiObject({ id: 3, center: 1, start: 2 }),
      createCircleApiObject({ id: 6, center: 4, start: 5 }),
      sketch(),
    ])
    expect(
      generateConstraintCandidates([3, 6], sketchId, circles)
    ).toMatchObject([
      {
        payload: { type: 'EqualRadius' },
      },
    ])
  })

  it('suggests tangency only when the contact is close to the selected segments', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0 }),
      createCircleApiObject({ id: 3, center: 1, start: 2 }),
      createPointApiObject({ id: 4, x: -5, y: 10.1 }),
      createPointApiObject({ id: 5, x: 5, y: 10.1 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      sketch(),
    ])
    expect(generateConstraintCandidates([6, 3], sketchId, objects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: { type: 'Tangent', input: [6, 3] },
        }),
      ])
    )

    const farLine = [...objects]
    farLine[4] = createPointApiObject({ id: 4, x: 20, y: 10.1 })
    farLine[5] = createPointApiObject({ id: 5, x: 30, y: 10.1 })
    expect(
      generateConstraintCandidates([6, 3], sketchId, farLine).some(
        ({ payload }) => payload.type === 'Tangent'
      )
    ).toBe(false)
  })

  it('recognizes an arc tangent near its endpoint and rejects an interior contact', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 10, y: 0 }),
      createPointApiObject({ id: 7, x: 0, y: 10 }),
      createArcApiObject({ id: 3, center: 1, start: 2, end: 7 }),
      createPointApiObject({ id: 4, x: 9.9, y: 0 }),
      createPointApiObject({ id: 5, x: 9.9, y: -5 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      sketch(),
    ])
    expect(
      generateConstraintCandidates([6, 3], sketchId, objects).some(
        ({ payload }) => payload.type === 'Tangent'
      )
    ).toBe(true)

    const interiorLine = [...objects]
    interiorLine[4] = createPointApiObject({ id: 4, x: 3.535, y: 10.605 })
    interiorLine[5] = createPointApiObject({ id: 5, x: 10.605, y: 3.535 })
    expect(
      generateConstraintCandidates([6, 3], sketchId, interiorLine).some(
        ({ payload }) => payload.type === 'Tangent'
      )
    ).toBe(false)
  })

  it('suggests symmetry for a mirrored point pair and an explicit axis', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: -5, y: 2 }),
      createPointApiObject({ id: 2, x: 5.1, y: 2 }),
      createPointApiObject({ id: 4, x: 0, y: -5 }),
      createPointApiObject({ id: 5, x: 0, y: 5 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      sketch(),
    ])
    expect(
      generateConstraintCandidates([1, 2, 6], sketchId, objects)
    ).toMatchObject([
      {
        payload: { type: 'Symmetric', input: [1, 2], axis: 6 },
      },
    ])

    const offAxis = [...objects]
    offAxis[2] = createPointApiObject({ id: 2, x: 5.1, y: 4 })
    expect(generateConstraintCandidates([1, 2, 6], sketchId, offAxis)).toEqual(
      []
    )
  })

  it('offers rounded dimensions and filters a dimension already on the sketch', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 9.9, y: 0 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])
    expect(generateConstraintCandidates([3], sketchId, objects, 'Mm')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Set length to 10 mm',
          payload: expect.objectContaining({
            type: 'Distance',
            segments: [1, 2],
            distance: { value: 10, units: 'Mm' },
          }),
        }),
      ])
    )

    const withDimension = objectArray([
      ...objects.filter(Boolean),
      sketch([11]),
      constraintObject(11, {
        type: 'Distance',
        segments: [1, 2],
        distance: { value: 10, units: 'Mm' },
        source: { expr: '10', is_literal: true },
      }),
    ])
    expect(
      generateConstraintCandidates([3], sketchId, withDimension).some(
        ({ payload }) => payload.type === 'Distance'
      )
    ).toBe(false)
  })

  it('offers a diameter for circles and a radius for arcs', () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 9.9, y: 0 }),
      createPointApiObject({ id: 4, x: 0, y: 0 }),
      createPointApiObject({ id: 5, x: 5.05, y: 0 }),
      createPointApiObject({ id: 7, x: 0, y: 5.05 }),
      createCircleApiObject({ id: 3, center: 1, start: 2 }),
      createArcApiObject({ id: 6, center: 4, start: 5, end: 7 }),
      sketch(),
    ])
    expect(
      generateConstraintCandidates([3], sketchId, objects)[0].payload
    ).toMatchObject({
      type: 'Diameter',
      diameter: { value: 20, units: 'Mm' },
    })
    expect(
      generateConstraintCandidates([6], sketchId, objects)[0].payload
    ).toMatchObject({
      type: 'Radius',
      radius: { value: 5, units: 'Mm' },
    })
  })

  it('keeps only solver previews without conflicts or large geometry movement', async () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 9.3, y: 0.4 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])
    const previewConstraint = vi
      .fn()
      .mockResolvedValue(createSceneGraphDelta(objects.filter(Boolean)))
    const settings = {} as Parameters<
      typeof rankConstraintSuggestions
    >[0]['settings']
    const safe = await rankConstraintSuggestions({
      selectionIds: [3],
      sketchId,
      objects,
      rustContext: { previewConstraint },
      settings,
    })
    expect(safe).toHaveLength(1)
    expect(safe[0].features).toMatchObject({
      previewMovementRatio: 0,
      freePointFraction: 1,
    })
    expect(safe[0].features.normalizedResidual).toBeGreaterThan(0)
    expect(previewConstraint).toHaveBeenCalledWith(
      0,
      sketchId,
      { type: 'Horizontal', line: 3 },
      settings
    )

    const movedObjects = [...objects]
    movedObjects[2] = createPointApiObject({ id: 2, x: 9.3, y: 2 })
    previewConstraint.mockResolvedValue(
      createSceneGraphDelta(movedObjects.filter(Boolean))
    )
    expect(
      await rankConstraintSuggestions({
        selectionIds: [3],
        sketchId,
        objects,
        rustContext: { previewConstraint },
        settings,
      })
    ).toEqual([])

    const conflictedObjects = [...objects]
    const conflictedPoint = createPointApiObject({ id: 2, x: 9.3, y: 0.4 })
    if (
      conflictedPoint.kind.type === 'Segment' &&
      conflictedPoint.kind.segment.type === 'Point'
    ) {
      conflictedPoint.kind.segment.freedom = 'Conflict'
    }
    conflictedObjects[2] = conflictedPoint
    previewConstraint.mockResolvedValue(
      createSceneGraphDelta(conflictedObjects.filter(Boolean))
    )
    expect(
      await rankConstraintSuggestions({
        selectionIds: [3],
        sketchId,
        objects,
        rustContext: { previewConstraint },
        settings,
      })
    ).toEqual([])
  })

  it('surfaces a broken preview API instead of treating it as an unsafe sketch', async () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 9.3, y: 0.4 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])
    const settings = {} as Parameters<
      typeof rankConstraintSuggestions
    >[0]['settings']
    await expect(
      rankConstraintSuggestions({
        selectionIds: [3],
        sketchId,
        objects,
        rustContext: {
          previewConstraint: vi
            .fn()
            .mockRejectedValue(new Error('WASM preview unavailable')),
        },
        settings,
      })
    ).rejects.toThrow('WASM preview unavailable')
  })

  it('stops checking remaining candidates after the sketch becomes stale', async () => {
    const objects = objectArray([
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 9.9, y: 0.1 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      sketch(),
    ])
    let current = true
    const previewConstraint = vi.fn().mockImplementation(async () => {
      current = false
      return createSceneGraphDelta(objects.filter(Boolean))
    })
    const result = await rankConstraintSuggestions({
      selectionIds: [3],
      sketchId,
      objects,
      rustContext: { previewConstraint },
      settings: {},
      isCurrent: () => current,
    })
    expect(result).toEqual([])
    expect(previewConstraint).toHaveBeenCalledOnce()
  })
})
