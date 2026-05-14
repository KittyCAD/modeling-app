import { Registry } from '@kittycad/registry'
import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createCircleApiObject,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { sketchSolveScenePluginsValueSpec } from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import modeSketch from '@src/registry/plugins/modeSketch'
import { describe, expect, it } from 'vitest'
import {
  RESIDUAL_FIELD_KIND,
  buildResidualFieldsForSceneGraph,
} from './residualsUnderlay'

function createSketchApiObject(id: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      constraints: [],
      plane: 0,
      segments: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createConstraintApiObject(
  id: number,
  constraint: ApiConstraint
): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

describe('mode sketch plugin', () => {
  it('contributes sketch residuals as a debug-controlled extension', () => {
    const registry = new Registry()
    registry.configure([modeSketch])

    const setting = registry
      .get(settingsValueSpec)
      .debug.showSketchResiduals.createSetting()

    expect(setting.default).toBe(false)
    expect(registry.get(settingsValueSpec).plugins['mode-sketch']).toBeDefined()
    expect(
      registry.get(settingsValueSpec).plugins['sketch-residuals']
    ).toBeUndefined()
    expect(registry.get(sketchSolveScenePluginsValueSpec)).toHaveLength(1)
    expect(registry.get(sketchSolveScenePluginsValueSpec)[0].id).toBe(
      'sketch-residuals-underlay'
    )
    expect(
      registry.get(sketchSolveScenePluginsValueSpec)[0]
        .onSketchScenePluginDispose
    ).toBeTypeOf('function')
  })
})

describe('buildResidualFieldsForSceneGraph', () => {
  it('builds point residual fields for coincident constraints', () => {
    const fixed = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point = createPointApiObject({ id: 2, x: 3, y: 4 })
    const constraint = createConstraintApiObject(3, {
      type: 'Coincident',
      segments: [fixed.id, point.id],
    })
    const fields = buildResidualFieldsForSceneGraph(
      createSceneGraphDelta([
        createSketchApiObject(0),
        fixed,
        point,
        constraint,
      ]),
      0
    )

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: RESIDUAL_FIELD_KIND.point,
          a: [0, 0, 0],
        }),
        expect.objectContaining({
          kind: RESIDUAL_FIELD_KIND.point,
          a: [3, 4, 0],
        }),
      ])
    )
  })

  it('builds banded line and circle fields for supported constraints', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 4, y: 0 })
    const probe = createPointApiObject({ id: 3, x: 2, y: 3 })
    const line = createLineApiObject({ id: 4, start: start.id, end: end.id })
    const coincident = createConstraintApiObject(5, {
      type: 'Coincident',
      segments: [probe.id, line.id],
    })
    const distance = createConstraintApiObject(6, {
      type: 'Distance',
      points: [start.id, probe.id],
      distance: { value: 5, units: 'Mm' },
      source: { expr: '5', is_literal: true },
    })

    const fields = buildResidualFieldsForSceneGraph(
      createSceneGraphDelta([
        createSketchApiObject(0),
        start,
        end,
        probe,
        line,
        coincident,
        distance,
      ]),
      0
    )

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: RESIDUAL_FIELD_KIND.line,
          a: [0, 0, 0],
          b: [4, 0, 0],
        }),
        expect.objectContaining({
          kind: RESIDUAL_FIELD_KIND.circle,
          a: [0, 0, 5],
        }),
      ])
    )
  })

  it('uses explicit radius constraints for arc-like residual rings', () => {
    const center = createPointApiObject({ id: 1, x: 10, y: 20 })
    const start = createPointApiObject({ id: 2, x: 12, y: 20 })
    const circle = createCircleApiObject({
      id: 3,
      center: center.id,
      start: start.id,
    })
    const radius = createConstraintApiObject(4, {
      type: 'Radius',
      arc: circle.id,
      radius: { value: 7, units: 'Mm' },
      source: { expr: '7', is_literal: true },
    })

    const fields = buildResidualFieldsForSceneGraph(
      createSceneGraphDelta([
        createSketchApiObject(0),
        center,
        start,
        circle,
        radius,
      ]),
      0
    )

    expect(fields).toEqual([
      {
        kind: RESIDUAL_FIELD_KIND.circle,
        a: [10, 20, 7],
      },
    ])
  })
})
