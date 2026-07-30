import type { Artifact } from '@src/lang/std/artifactGraph'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'
import {
  getDefaultDistanceModeForTarget,
  getDistanceMeasurementLabel,
  getMeasurementTarget,
  isUnsupportedDistanceMode,
  measurementCapabilities,
} from './measurementCapabilities'
import {
  convertLengthFromMm,
  formatDistance,
  formatPoint3d,
  getAreaUnit,
  getDistanceTypeForMode,
  getMeasurementEntities,
  getMeasurementEntityIds,
  getVolumeUnit,
  type MeasurementEntity,
} from './measurementUtils'

describe('MeasurementTool helpers', () => {
  function measurementEntity(
    kind: MeasurementEntity['kind'],
    id = `${kind}-id`
  ): MeasurementEntity {
    return { id, kind }
  }

  function artifact(value: { id: string; type: Artifact['type'] }): Artifact {
    return value as Artifact
  }

  function patternArtifact(value: {
    id: string
    copyIds: string[]
    copyFaceIds: string[]
    copyEdgeIds: string[]
  }): Artifact {
    return {
      ...value,
      type: 'pattern',
    } as Artifact
  }

  it('resolves graph selections to engine entity ids', () => {
    const selections: Selections = {
      graphSelections: [
        {
          engineEntityId: 'selected-engine-entity',
          artifact: artifact({
            id: 'artifact-id',
            type: 'sweep',
          }),
          codeRef: {
            range: [0, 1, 0],
            pathToNode: [],
          },
        },
        {
          artifact: artifact({
            id: 'plain-artifact-id',
            type: 'wall',
          }),
          codeRef: {
            range: [1, 2, 0],
            pathToNode: [],
          },
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntityIds(selections)).toEqual([
      'selected-engine-entity',
      'plain-artifact-id',
    ])
  })

  it('expands pattern selections and de-duplicates ids', () => {
    const selections: Selections = {
      graphSelections: [
        {
          artifact: patternArtifact({
            id: 'pattern-artifact-id',
            copyIds: ['copy-1', 'copy-2'],
            copyFaceIds: ['copy-2', 'copy-face-1'],
            copyEdgeIds: ['copy-edge-1'],
          }),
          codeRef: {
            range: [0, 1, 0],
            pathToNode: [],
          },
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntityIds(selections)).toEqual([
      'copy-1',
      'copy-2',
      'copy-face-1',
      'copy-edge-1',
    ])
    expect(getMeasurementEntities(selections)).toEqual([
      { id: 'copy-1', kind: 'body' },
      { id: 'copy-2', kind: 'body' },
      { id: 'copy-face-1', kind: 'face' },
      { id: 'copy-edge-1', kind: 'edge' },
    ])
  })

  it('classifies graph selections for measurement commands', () => {
    const selections: Selections = {
      graphSelections: [
        {
          artifact: artifact({
            id: 'body-id',
            type: 'sweep',
          }),
          codeRef: {
            range: [0, 1, 0],
            pathToNode: [],
          },
        },
        {
          artifact: artifact({
            id: 'face-id',
            type: 'wall',
          }),
          codeRef: {
            range: [1, 2, 0],
            pathToNode: [],
          },
        },
        {
          artifact: artifact({
            id: 'edge-id',
            type: 'segment',
          }),
          codeRef: {
            range: [2, 3, 0],
            pathToNode: [],
          },
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntities(selections)).toEqual([
      { id: 'body-id', kind: 'body' },
      { id: 'face-id', kind: 'face' },
      { id: 'edge-id', kind: 'edge' },
    ])
  })

  it('includes selectable non-code scene entities', () => {
    const selections: Selections = {
      graphSelections: [],
      otherSelections: [
        {
          type: 'enginePrimitive',
          entityId: 'primitive-id',
          primitiveIndex: 0,
          primitiveType: 'edge',
        },
        {
          type: 'engineRegion',
          id: 'region-id',
          point: { x: 1, y: 2 },
          sketchId: 'sketch-id',
        },
        {
          name: 'XY',
          id: 'plane-id',
        },
        'x-axis',
      ],
    }

    expect(getMeasurementEntityIds(selections)).toEqual([
      'primitive-id',
      'region-id',
      'plane-id',
    ])
    expect(getMeasurementEntities(selections)).toEqual([
      { id: 'primitive-id', kind: 'edge' },
      { id: 'region-id', kind: 'other' },
      { id: 'plane-id', kind: 'other' },
    ])
  })

  it('classifies non-code faces and bodies', () => {
    const selections: Selections = {
      graphSelections: [],
      otherSelections: [
        {
          type: 'enginePrimitive',
          entityId: 'face-id',
          primitiveIndex: 0,
          primitiveType: 'face',
        },
        {
          type: 'enginePrimitive',
          entityId: 'body-id',
          primitiveIndex: 1,
          primitiveType: 'solid3d',
        },
      ],
    }

    expect(getMeasurementEntities(selections)).toEqual([
      { id: 'face-id', kind: 'face' },
      { id: 'body-id', kind: 'body' },
    ])
  })

  it('maps selected entities to measurement capabilities', () => {
    const edge = measurementEntity('edge')
    const face = measurementEntity('face')
    const body = measurementEntity('body')

    expect(
      measurementCapabilities.map((capability) => ({
        type: capability.type,
        label: capability.label,
      }))
    ).toEqual([
      { type: 'distance', label: 'Distance' },
      { type: 'edgeLength', label: 'Edge length' },
      { type: 'faceSurfaceArea', label: 'Face surface area' },
      { type: 'bodyDetails', label: 'Body details' },
    ])
    expect(getMeasurementTarget([edge])).toEqual({
      type: 'edgeLength',
      entity: edge,
    })
    expect(getMeasurementTarget([face])).toEqual({
      type: 'faceSurfaceArea',
      entity: face,
    })
    expect(getMeasurementTarget([body])).toEqual({
      type: 'bodyDetails',
      entity: body,
    })
    expect(getMeasurementTarget([body, face])).toEqual({
      type: 'distance',
      entities: [body, face],
    })
    expect(getMeasurementTarget([body, face, edge])).toBeNull()
  })

  it('defaults topology distances to a supported axis mode', () => {
    const target = getMeasurementTarget([
      measurementEntity('face'),
      measurementEntity('edge'),
    ])

    expect(target?.type).toBe('distance')
    if (!target) {
      throw new Error('Expected distance target')
    }

    expect(isUnsupportedDistanceMode(target, 'euclidean')).toBe(true)
    expect(isUnsupportedDistanceMode(target, 'x')).toBe(false)
    expect(getDefaultDistanceModeForTarget(target, null)).toBe('x')
    expect(getDefaultDistanceModeForTarget(target, 'euclidean')).toBe('x')
    expect(getDefaultDistanceModeForTarget(target, 'z')).toBe('z')
  })

  it('keeps non-topology distance defaults and labels readable', () => {
    const target = getMeasurementTarget([
      measurementEntity('body', 'body-1'),
      measurementEntity('body', 'body-2'),
    ])

    expect(target?.type).toBe('distance')
    expect(getDefaultDistanceModeForTarget(target, null)).toBe('euclidean')
    expect(getDefaultDistanceModeForTarget(target, 'y')).toBe('y')
    expect(getDistanceMeasurementLabel('euclidean')).toBe('3D distance')
    expect(getDistanceMeasurementLabel('x')).toBe('X distance')
  })

  it('builds distance type payloads for the engine command', () => {
    expect(getDistanceTypeForMode('euclidean')).toEqual({ type: 'euclidean' })
    expect(getDistanceTypeForMode('x')).toEqual({
      type: 'on_axis',
      axis: 'x',
    })
  })

  it('formats finite and non-finite distances', () => {
    expect(formatDistance(12.34567)).toBe('12.3457')
    expect(formatDistance(0.00000012)).toBe('1.200e-7')
    expect(formatDistance(Number.NaN)).toBe('-')
  })

  it('derives area and volume measurement units from length units', () => {
    expect(
      (['mm', 'cm', 'm', 'in', 'ft', 'yd'] as const).map((unit) => [
        unit,
        getAreaUnit(unit),
        getVolumeUnit(unit),
      ])
    ).toEqual([
      ['mm', 'mm2', 'mm3'],
      ['cm', 'cm2', 'cm3'],
      ['m', 'm2', 'm3'],
      ['in', 'in2', 'in3'],
      ['ft', 'ft2', 'ft3'],
      ['yd', 'yd2', 'yd3'],
    ])
  })

  it('converts engine millimeter length measurements to display units', () => {
    expect(convertLengthFromMm(609.6, 'in')).toBe(24)
    expect(convertLengthFromMm(609.6, 'ft')).toBe(2)
    expect(convertLengthFromMm(609.6, 'mm')).toBe(609.6)
  })

  it('formats 3d points', () => {
    expect(formatPoint3d({ x: 1.23456, y: 0.00000012, z: Number.NaN })).toBe(
      '1.2346, 1.200e-7, -'
    )
  })
})
