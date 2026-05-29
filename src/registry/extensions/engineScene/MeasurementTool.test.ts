import type { Artifact } from '@src/lang/std/artifactGraph'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  getDistanceTypeForMode,
  getMeasurementEntityIds,
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
})
