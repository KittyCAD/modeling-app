import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { updateDimensionLine } from '@src/machines/sketchSolve/constraints/DimensionLine'
import { RadiusConstraintBuilder } from '@src/machines/sketchSolve/constraints/RadiusConstraintBuilder'
import {
  type DiameterConstraint,
  type RadiusConstraint,
  isDiameterConstraint,
  isRadiusConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  createArcApiObject,
  createCircleApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Group, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// These tests exercise the annotation endpoints without loading Wasm or drawing labels.
vi.mock('@src/lang/wasm', () => ({ emptyOperationsByModule: vi.fn() }))
vi.mock('@src/machines/sketchSolve/constraints/DimensionLine', () => ({
  createDimensionLine: vi.fn(() => new Group()),
  updateDimensionLine: vi.fn(),
}))

function createConstraint(
  input:
    | RadiusConstraint['kind']['constraint']
    | DiameterConstraint['kind']['constraint']
): RadiusConstraint | DiameterConstraint {
  const constraint: ApiObject = {
    id: 4,
    kind: { type: 'Constraint', constraint: input },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
  if (isRadiusConstraint(constraint) || isDiameterConstraint(constraint)) {
    return constraint
  }
  throw new Error('Expected a circular dimension constraint')
}

describe('RadiusConstraintBuilder', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    {
      name: 'radius with default label',
      input: {
        type: 'Radius',
        radius: { value: 5, units: 'Mm' },
        arc: 3,
        source: { expr: '5mm', is_literal: true },
      } satisfies RadiusConstraint['kind']['constraint'],
      expected: {
        start: new Vector3(25, 30, 0),
        end: new Vector3(20, 30, 0),
        value: { value: 5, units: 'Mm' },
        isDiameter: false,
        labelPosition: undefined,
      },
    },
    {
      name: 'diameter with default label',
      input: {
        type: 'Diameter',
        diameter: { value: 10, units: 'Mm' },
        arc: 3,
        source: { expr: '10mm', is_literal: true },
      } satisfies DiameterConstraint['kind']['constraint'],
      expected: {
        start: new Vector3(25, 30, 0),
        end: new Vector3(15, 30, 0),
        value: { value: 10, units: 'Mm' },
        isDiameter: true,
        labelPosition: undefined,
      },
    },
    {
      name: 'radius with explicit label',
      input: {
        type: 'Radius',
        radius: { value: 5, units: 'Mm' },
        arc: 3,
        source: { expr: '5mm', is_literal: true },
        labelPosition: {
          x: { value: 20, units: 'Mm' },
          y: { value: 40, units: 'Mm' },
        },
      } satisfies RadiusConstraint['kind']['constraint'],
      expected: {
        start: new Vector3(20, 35, 0),
        end: new Vector3(20, 30, 0),
        value: { value: 5, units: 'Mm' },
        isDiameter: false,
        labelPosition: new Vector3(20, 40, 0),
      },
    },
    {
      name: 'diameter with explicit label',
      input: {
        type: 'Diameter',
        diameter: { value: 10, units: 'Mm' },
        arc: 3,
        source: { expr: '10mm', is_literal: true },
        labelPosition: {
          x: { value: 20, units: 'Mm' },
          y: { value: 40, units: 'Mm' },
        },
      } satisfies DiameterConstraint['kind']['constraint'],
      expected: {
        start: new Vector3(20, 25, 0),
        end: new Vector3(20, 35, 0),
        value: { value: 10, units: 'Mm' },
        isDiameter: true,
        labelPosition: new Vector3(20, 40, 0),
      },
    },
  ])('follows a solved circle center: $name', ({ input, expected }) => {
    const circle = createCircleApiObject({ id: 3, start: 0, center: 1 })
    const objects = createSceneGraphDelta([
      createPointApiObject({ id: 0, x: 25, y: 30 }),
      createPointApiObject({ id: 1, x: 20, y: 30 }),
      circle,
    ]).new_graph.objects
    const constraint = createConstraint(input)
    const builder = new RadiusConstraintBuilder(new ConstraintResources())
    const group = builder.init(constraint)
    const sceneInfra = createMockSceneInfra()

    builder.update(group, constraint, objects, 1, sceneInfra, [], null)

    expect(updateDimensionLine).toHaveBeenCalledExactlyOnceWith(
      expected.start,
      expected.end,
      group,
      constraint,
      1,
      sceneInfra,
      expected.value,
      expected.isDiameter,
      expected.labelPosition
    )
  })

  it.each([
    {
      name: 'circle fallback',
      segment: createCircleApiObject({ id: 3, start: 0, center: 99 }),
      expected: [new Vector3(5, 0, 0), new Vector3(0, 0, 0)],
    },
    {
      name: 'arc',
      segment: createArcApiObject({ id: 3, start: 0, center: 1, end: 2 }),
      expected: [new Vector3(5, 0, 0), new Vector3(0, 0, 0)],
    },
  ])('keeps the existing endpoints for $name', ({ segment, expected }) => {
    const objects = createSceneGraphDelta([
      createPointApiObject({ id: 0, x: 5, y: 0 }),
      createPointApiObject({ id: 1, x: 0, y: 0 }),
      createPointApiObject({ id: 2, x: 0, y: 5 }),
      segment,
    ]).new_graph.objects
    const constraint = createConstraint({
      type: 'Radius',
      radius: { value: 5, units: 'Mm' },
      arc: 3,
      source: { expr: '5mm', is_literal: true },
    })
    const builder = new RadiusConstraintBuilder(new ConstraintResources())
    const group = builder.init(constraint)

    builder.update(
      group,
      constraint,
      objects,
      1,
      createMockSceneInfra(),
      [],
      null
    )

    expect(vi.mocked(updateDimensionLine).mock.calls[0]?.slice(0, 2)).toEqual(
      expected
    )
  })
})
