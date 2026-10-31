import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { suggestSketchContinuations } from '@src/machines/sketchSolve/continuation/sketchContinuationSuggestions'
import {
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'

function squareObjects(withCircle = false) {
  const points = [
    createPointApiObject({ id: 1, x: 2, y: 3 }),
    createPointApiObject({ id: 2, x: 12, y: 3 }),
    createPointApiObject({ id: 3, x: 12, y: 13 }),
    createPointApiObject({ id: 4, x: 2, y: 13 }),
  ]
  const lines = [
    createLineApiObject({ id: 5, start: 1, end: 2 }),
    createLineApiObject({ id: 6, start: 2, end: 3 }),
    createLineApiObject({ id: 7, start: 3, end: 4 }),
    createLineApiObject({ id: 8, start: 4, end: 1 }),
  ]
  const circle = withCircle
    ? [
        createPointApiObject({ id: 9, x: 7, y: 8 }),
        createPointApiObject({ id: 11, x: 9, y: 8 }),
        createCircleApiObject({ id: 12, center: 9, start: 11 }),
      ]
    : []
  const sketch: ApiObject = {
    id: 10,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [1, 2, 3, 4, 5, 6, 7, 8, ...circle.map((item) => item.id)],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
  return createSceneGraphDelta([...points, ...lines, ...circle, sketch])
    .new_graph.objects
}

function circleObjects(radius = 10) {
  const center = createPointApiObject({ id: 1, x: 5, y: 7 })
  const start = createPointApiObject({ id: 2, x: 5 + radius, y: 7 })
  const circle = createCircleApiObject({ id: 3, center: 1, start: 2 })
  const sketch: ApiObject = {
    id: 10,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [1, 2, 3],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
  return createSceneGraphDelta([center, start, circle, sketch]).new_graph
    .objects
}

describe('sketch continuation suggestions', () => {
  it('offers one-click geometry after a square without any edge selection', () => {
    const ideas = suggestSketchContinuations(10, squareObjects(), 'Mm')
    expect(ideas.map((idea) => idea.label)).toEqual([
      'Add centered circle',
      'Add offset circle',
    ])
    expect(ideas[0].segment).toMatchObject({
      type: 'Circle',
      center: {
        x: { value: 7, units: 'Mm' },
        y: { value: 8, units: 'Mm' },
      },
      start: { x: { value: 9, units: 'Mm' } },
    })
  })

  it('offers concentric circles after a single circle without a selection', () => {
    const ideas = suggestSketchContinuations(10, circleObjects(), 'Mm')
    expect(ideas.map((idea) => idea.label)).toEqual([
      'Add inner concentric circle',
      'Add outer concentric circle',
    ])
    expect(ideas.map((idea) => idea.segment)).toMatchObject([
      {
        type: 'Circle',
        center: {
          x: { value: 5, units: 'Mm' },
          y: { value: 7, units: 'Mm' },
        },
        start: { x: { value: 10, units: 'Mm' } },
      },
      {
        type: 'Circle',
        center: {
          x: { value: 5, units: 'Mm' },
          y: { value: 7, units: 'Mm' },
        },
        start: { x: { value: 20, units: 'Mm' } },
      },
    ])
  })

  it('does not suggest a concentric circle for zero-radius geometry', () => {
    expect(suggestSketchContinuations(10, circleObjects(0), 'Mm')).toEqual([])
  })

  it('does not repeat the idea after geometry is added', () => {
    expect(suggestSketchContinuations(10, squareObjects(true), 'Mm')).toEqual(
      []
    )
  })

  it('ignores an incomplete square', () => {
    const objects = [...squareObjects()]
    const sketch = objects[10]
    if (sketch.kind.type !== 'Sketch') throw new Error('Missing sketch')
    objects[10] = {
      ...sketch,
      kind: { ...sketch.kind, segments: sketch.kind.segments.slice(0, -1) },
    }
    expect(suggestSketchContinuations(10, objects, 'Mm')).toEqual([])
  })
})
