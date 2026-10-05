import type { UnitArea, UnitVolume } from '@kittycad/lib'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
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
  graphSelectionsReferenceCurrentArtifacts,
  type MeasurementEntity,
  unitAreaLabels,
  unitVolumeLabels,
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

  function sweepArtifact(value: {
    id: string
    pathId: string
    subType: Extract<Artifact, { type: 'sweep' }>['subType']
  }): Extract<Artifact, { type: 'sweep' }> {
    return {
      ...value,
      type: 'sweep',
      surfaceIds: [],
      edgeIds: [],
      codeRef: {
        range: [0, 1, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      trajectoryId: null,
      method: 'new',
      consumed: false,
    }
  }

  function pathArtifact(value: {
    id: string
    sweepId?: string | null
  }): Extract<Artifact, { type: 'path' }> {
    return {
      ...value,
      type: 'path',
      subType: 'sketch',
      planeId: 'plane-id',
      segIds: [],
      trajectorySweepId: null,
      consumed: false,
      codeRef: {
        range: [0, 1, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
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

  function graph(...artifacts: Artifact[]): ArtifactGraph {
    return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
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

  it('routes original swept body selections to engine object ids', () => {
    const path = pathArtifact({ id: 'engine-body-id', sweepId: 'sweep-id' })
    const sweep = sweepArtifact({
      id: 'sweep-id',
      pathId: path.id,
      subType: 'extrusion',
    })
    const selections: Selections = {
      graphSelections: [
        {
          artifact: sweep,
          codeRef: sweep.codeRef,
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntities(selections, graph(path, sweep))).toEqual([
      { id: 'engine-body-id', kind: 'body' },
    ])
  })

  it('keeps loft body selections on the artifact id domain', () => {
    const path = pathArtifact({ id: 'loft-profile-id', sweepId: 'loft-id' })
    const loft = sweepArtifact({
      id: 'loft-id',
      pathId: path.id,
      subType: 'loft',
    })
    const selections: Selections = {
      graphSelections: [
        {
          artifact: loft,
          codeRef: loft.codeRef,
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntities(selections, graph(path, loft))).toEqual([
      { id: 'loft-id', kind: 'body' },
    ])
  })

  it('does not route mirrored swept bodies through the source path id', () => {
    const sourcePath = pathArtifact({
      id: 'source-engine-body-id',
      sweepId: 'source-sweep-id',
    })
    const mirroredSweep = sweepArtifact({
      id: 'mirrored-engine-body-id',
      pathId: sourcePath.id,
      subType: 'extrusion',
    })
    const selections: Selections = {
      graphSelections: [
        {
          artifact: mirroredSweep,
          codeRef: mirroredSweep.codeRef,
        },
      ],
      otherSelections: [],
    }

    expect(
      getMeasurementEntities(selections, graph(sourcePath, mirroredSweep))
    ).toEqual([{ id: 'mirrored-engine-body-id', kind: 'body' }])
  })

  it('routes pattern source rows through their source sweep bridge', () => {
    const sourcePath = pathArtifact({
      id: 'source-engine-body-id',
      sweepId: 'source-sweep-id',
    })
    const sourceSweep = sweepArtifact({
      id: 'source-sweep-id',
      pathId: sourcePath.id,
      subType: 'extrusion',
    })
    const pattern = patternArtifact({
      id: 'pattern-id',
      copyIds: ['copy-body-id'],
      copyFaceIds: [],
      copyEdgeIds: [],
    })
    const selections: Selections = {
      graphSelections: [
        {
          artifact: pattern,
          engineEntityId: sourceSweep.id,
          codeRef: sourceSweep.codeRef,
        },
      ],
      otherSelections: [],
    }

    expect(
      getMeasurementEntities(
        selections,
        graph(sourcePath, sourceSweep, pattern)
      )
    ).toEqual([{ id: 'source-engine-body-id', kind: 'body' }])
  })

  it('keeps pattern copy rows on their copy engine object id', () => {
    const pattern = patternArtifact({
      id: 'pattern-id',
      copyIds: ['copy-body-id'],
      copyFaceIds: [],
      copyEdgeIds: [],
    })
    const selections: Selections = {
      graphSelections: [
        {
          artifact: pattern,
          engineEntityId: 'copy-body-id',
          codeRef: {
            range: [0, 1, 0],
            pathToNode: [],
          },
        },
      ],
      otherSelections: [],
    }

    expect(getMeasurementEntities(selections, graph(pattern))).toEqual([
      { id: 'copy-body-id', kind: 'body' },
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

  it('detects graph selections whose artifacts were replaced after regeneration', () => {
    const currentBody = artifact({
      id: 'body-id',
      type: 'sweep',
    })
    const staleBody = artifact({
      id: 'body-id',
      type: 'sweep',
    })
    const currentArtifactGraph = new Map([[currentBody.id, currentBody]])
    const codeRef = {
      range: [0, 1, 0] as [number, number, number],
      pathToNode: [],
    }

    expect(
      graphSelectionsReferenceCurrentArtifacts(
        {
          graphSelections: [
            {
              artifact: currentBody,
              codeRef,
            },
          ],
          otherSelections: [],
        },
        currentArtifactGraph
      )
    ).toBe(true)
    expect(
      graphSelectionsReferenceCurrentArtifacts(
        {
          graphSelections: [
            {
              artifact: staleBody,
              codeRef,
            },
          ],
          otherSelections: [],
        },
        currentArtifactGraph
      )
    ).toBe(false)
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
    const other = measurementEntity('other')

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
    expect(getMeasurementTarget([body, other])).toBeNull()
    expect(getMeasurementTarget([edge, other])).toBeNull()
    expect(getMeasurementTarget([other, other])).toBeNull()
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

describe('unit display labels', () => {
  it('labels every area and volume unit', () => {
    const areaUnits: UnitArea[] = [
      'mm2',
      'cm2',
      'dm2',
      'm2',
      'km2',
      'in2',
      'ft2',
      'yd2',
    ]
    const volumeUnits: UnitVolume[] = [
      'mm3',
      'cm3',
      'm3',
      'in3',
      'ft3',
      'yd3',
      'ml',
      'l',
      'usfloz',
      'usgal',
    ]

    for (const unit of areaUnits) {
      expect(unitAreaLabels[unit]).toBeTruthy()
    }
    for (const unit of volumeUnits) {
      expect(unitVolumeLabels[unit]).toBeTruthy()
    }
  })

  it('renders squared and cubed units as superscripts', () => {
    expect(unitAreaLabels.mm2).toBe('mm\u00b2')
    expect(unitVolumeLabels.mm3).toBe('mm\u00b3')

    // A label must never fall back to a trailing ASCII 2 or 3.
    for (const label of [
      ...Object.values(unitAreaLabels),
      ...Object.values(unitVolumeLabels),
    ]) {
      expect(label).not.toMatch(/[23]$/)
    }
  })
})
