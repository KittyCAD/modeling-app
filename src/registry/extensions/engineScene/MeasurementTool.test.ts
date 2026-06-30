import type { Artifact } from '@src/lang/std/artifactGraph'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  formatPoint3d,
  getAreaUnit,
  getDistanceTypeForMode,
  getMeasurementEntities,
  getMeasurementEntityIds,
  getVolumeUnit,
} from './measurementUtils'

describe('MeasurementTool helpers', () => {
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

  it('derives measurement units from length units', () => {
    expect(getAreaUnit('mm')).toBe('mm2')
    expect(getAreaUnit('in')).toBe('in2')
    expect(getVolumeUnit('cm')).toBe('cm3')
    expect(getVolumeUnit('ft')).toBe('ft3')
  })

  it('formats 3d points', () => {
    expect(formatPoint3d({ x: 1.23456, y: 0.00000012, z: Number.NaN })).toBe(
      '1.2346, 1.200e-7, -'
    )
  })
})
