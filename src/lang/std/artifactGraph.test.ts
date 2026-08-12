import {
  type Artifact,
  BODY_ARTIFACT_TYPES,
  coerceSelectionsToBody,
  getBodiesFromArtifactGraph,
  getCommonFacesForEdge,
  getPatternSelectionIndex,
  getSketchBlockForArtifact,
  getSweepArtifactFromSelection,
  isBodyArtifactType,
  isFaceFromLegacySketch,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, PathToNode } from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

describe('body artifact types', () => {
  it('includes patterns in the shared body classification', () => {
    expect(BODY_ARTIFACT_TYPES).toEqual([
      'path',
      'sweep',
      'compositeSolid',
      'pattern',
    ])
    expect(isBodyArtifactType('pattern')).toBe(true)
    expect(isBodyArtifactType('wall')).toBe(false)
  })
})

const codeRef = {
  range: [0, 0, 0] as [number, number, number],
  pathToNode: [],
  nodePath: { steps: [] },
}

function createSourceSegmentGraph(suffix = ''): {
  artifactGraph: ArtifactGraph
  sourceSegment: Extract<Artifact, { type: 'segment' }>
} {
  const artifactGraph: ArtifactGraph = new Map()
  const idSuffix = suffix ? `-${suffix}` : ''
  const sourceSegment: Extract<Artifact, { type: 'segment' }> = {
    type: 'segment',
    id: `source-segment${idSuffix}`,
    pathId: `source-path${idSuffix}`,
    edgeIds: [],
    commonSurfaceIds: [],
    codeRef,
  }
  artifactGraph.set(sourceSegment.id, sourceSegment)
  artifactGraph.set(sourceSegment.pathId, {
    type: 'path',
    subType: 'sketch',
    id: sourceSegment.pathId,
    codeRef,
    planeId: 'plane-1',
    segIds: [sourceSegment.id],
    trajectorySweepId: null,
    consumed: true,
  })
  return { artifactGraph, sourceSegment }
}

function addMappedRegion(
  artifactGraph: ArtifactGraph,
  sourceSegment: Extract<Artifact, { type: 'segment' }>,
  suffix: string,
  withFaces = false,
  targetSuffix = suffix
) {
  const generatedSegmentId = `generated-segment-${suffix}`
  const regionPathId = `region-path-${suffix}`
  const sweepId = `sweep-${targetSuffix}`
  const commonSurfaceIds = withFaces
    ? [`wall-${targetSuffix}`, `cap-${targetSuffix}`]
    : []

  artifactGraph.set(generatedSegmentId, {
    ...sourceSegment,
    id: generatedSegmentId,
    pathId: regionPathId,
    originalSegId: sourceSegment.id,
    commonSurfaceIds,
  })
  artifactGraph.set(regionPathId, {
    type: 'path',
    subType: 'region',
    id: regionPathId,
    codeRef,
    planeId: 'plane-1',
    segIds: [generatedSegmentId],
    sweepId,
    trajectorySweepId: null,
    consumed: true,
  })
  artifactGraph.set(sweepId, {
    type: 'sweep',
    id: sweepId,
    codeRef,
    pathId: regionPathId,
    subType: 'extrusion',
    surfaceIds: commonSurfaceIds,
    edgeIds: [],
    method: 'merge',
    trajectoryId: null,
    consumed: false,
  })

  if (withFaces) {
    artifactGraph.set(`wall-${targetSuffix}`, {
      type: 'wall',
      id: `wall-${targetSuffix}`,
      segId: generatedSegmentId,
      sweepId,
      pathIds: [],
      edgeCutEdgeIds: [],
      cmdId: `cmd-${targetSuffix}`,
      faceCodeRef: codeRef,
    })
    artifactGraph.set(`cap-${targetSuffix}`, {
      type: 'cap',
      id: `cap-${targetSuffix}`,
      subType: 'end',
      sweepId,
      pathIds: [],
      edgeCutEdgeIds: [],
      cmdId: `cmd-${targetSuffix}`,
      faceCodeRef: codeRef,
    })
  }
}

describe('getSweepArtifactFromSelection', () => {
  it('should return sweep from edgeCut -> segment selection', () => {
    const artifactGraph: ArtifactGraph = new Map()

    // Create path -> sweep -> segment -> edgeCut chain
    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 0, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    }

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
    }

    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }

    const edgeCut: Artifact = {
      type: 'edgeCut',
      id: 'edge-cut-1',
      consumedEdgeId: 'segment-1',
      subType: 'chamfer',
      edgeIds: [],
      codeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }

    artifactGraph.set('path-1', path)
    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('segment-1', segment)
    artifactGraph.set('edge-cut-1', edgeCut)

    const selection: Selection = {
      artifact: edgeCut,
      codeRef: { range: [0, 0, 0], pathToNode: [] },
    }

    const result = getSweepArtifactFromSelection(selection, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect('type' in result ? result.type : undefined).toBe('sweep')
      expect(result.id).toBe('sweep-1')
    }
  })

  it('should return sweep from edgeCut -> sweepEdge selection', () => {
    const artifactGraph: ArtifactGraph = new Map()

    // Create sweep -> sweepEdge -> edgeCut chain
    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: ['sweep-edge-1'],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
    }

    const sweepEdge: Artifact = {
      type: 'sweepEdge',
      id: 'sweep-edge-1',
      subType: 'opposite',
      sweepId: 'sweep-1',
      segId: 'segment-1',
      cmdId: 'cmd-1',
      commonSurfaceIds: [],
    }

    const edgeCut: Artifact = {
      type: 'edgeCut',
      id: 'edge-cut-1',
      consumedEdgeId: 'sweep-edge-1', // Points to sweepEdge, not segment
      subType: 'fillet',
      edgeIds: [],
      codeRef: {
        range: [0, 0, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }

    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('sweep-edge-1', sweepEdge)
    artifactGraph.set('edge-cut-1', edgeCut)

    const selection: Selection = {
      artifact: edgeCut,
      codeRef: { range: [0, 0, 0], pathToNode: [] },
    }

    const result = getSweepArtifactFromSelection(selection, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect('type' in result ? result.type : undefined).toBe('sweep')
      expect(result.id).toBe('sweep-1')
    }
  })

  it('should return the sweep mapped from an original auto-hole segment', () => {
    const { artifactGraph, sourceSegment } = createSourceSegmentGraph()
    addMappedRegion(artifactGraph, sourceSegment, '1')

    const result = getSweepArtifactFromSelection(
      {
        artifact: sourceSegment,
        codeRef: { range: [0, 0, 0], pathToNode: [] },
      },
      artifactGraph
    )

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.id).toBe('sweep-1')
    }
  })

  it('rejects an original segment mapped into multiple sweeps', () => {
    const { artifactGraph, sourceSegment } = createSourceSegmentGraph()
    for (const suffix of ['1', '2']) {
      addMappedRegion(artifactGraph, sourceSegment, suffix)
    }

    const result = getSweepArtifactFromSelection(
      {
        artifact: sourceSegment,
        codeRef: { range: [0, 0, 0], pathToNode: [] },
      },
      artifactGraph
    )

    expect(result).toEqual(
      new Error('Segment maps to more than one swept region')
    )
  })

  it('resolves two original hole segments independently', () => {
    const left = createSourceSegmentGraph('left')
    const right = createSourceSegmentGraph('right')
    for (const artifact of right.artifactGraph.values()) {
      left.artifactGraph.set(artifact.id, artifact)
    }
    addMappedRegion(left.artifactGraph, left.sourceSegment, 'left')
    addMappedRegion(left.artifactGraph, right.sourceSegment, 'right')

    for (const [sourceSegment, expectedSweepId] of [
      [left.sourceSegment, 'sweep-left'],
      [right.sourceSegment, 'sweep-right'],
    ] as const) {
      const result = getSweepArtifactFromSelection(
        {
          artifact: sourceSegment,
          codeRef: { range: [0, 0, 0], pathToNode: [] },
        },
        left.artifactGraph
      )

      expect(result).not.toBeInstanceOf(Error)
      if (!(result instanceof Error)) {
        expect(result.id).toBe(expectedSweepId)
      }
    }
  })
})

describe('getCommonFacesForEdge', () => {
  it('uses faces from a generated region segment mapped from the selected source segment', () => {
    const { artifactGraph, sourceSegment } = createSourceSegmentGraph()
    addMappedRegion(artifactGraph, sourceSegment, '1', true)

    const result = getCommonFacesForEdge(sourceSegment, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.map(({ id }) => id).sort()).toEqual(['cap-1', 'wall-1'])
    }

    addMappedRegion(artifactGraph, sourceSegment, '2', true)

    expect(getCommonFacesForEdge(sourceSegment, artifactGraph)).toEqual(
      new Error('Segment maps to more than one set of common faces')
    )
  })

  it('accepts multiple generated segments resolving to the same faces', () => {
    const { artifactGraph, sourceSegment } = createSourceSegmentGraph()
    addMappedRegion(artifactGraph, sourceSegment, '1', true)
    addMappedRegion(artifactGraph, sourceSegment, '2', true, '1')

    const result = getCommonFacesForEdge(sourceSegment, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.map(({ id }) => id).sort()).toEqual(['cap-1', 'wall-1'])
    }
  })
})

describe('coerceSelectionsToBody', () => {
  it('should resolve a sketchBlock from a segment artifact', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const pathToNode: PathToNode = [['body', '']]
    const codeRef = {
      range: [0, 100, 0] as [number, number, number],
      pathToNode,
      nodePath: { steps: [] },
    }

    const sketchBlock: Extract<Artifact, { type: 'sketchBlock' }> = {
      type: 'sketchBlock',
      id: 'sketch-block-1',
      codeRef,
      planeId: 'plane-1',
      sketchId: 7,
    }

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef,
      planeId: 'plane-1',
      segIds: ['segment-1'],
      trajectorySweepId: null,
      consumed: false,
      sketchBlockId: 'sketch-block-1',
    }

    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef,
    }

    artifactGraph.set(sketchBlock.id, sketchBlock)
    artifactGraph.set(path.id, path)
    artifactGraph.set(segment.id, segment)

    expect(getSketchBlockForArtifact(segment, artifactGraph)?.id).toBe(
      'sketch-block-1'
    )
  })

  it('should pass through path artifact unchanged', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: false,
    }
    artifactGraph.set('path-1', path)

    const selections: Selections = {
      graphSelections: [
        {
          artifact: path,
          codeRef: { range: [0, 100, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      expect(result.graphSelections[0].artifact?.type).toBe('path')
      expect(result.graphSelections[0].artifact?.id).toBe('path-1')
    }
  })

  it('should preserve the identity of pattern body selections', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-command-id',
      subType: 'linear',
      sourceIds: ['source-body-id'],
      instanceIds: ['source-body-id', 'copy-body-1', 'copy-body-2'],
      copyIds: ['copy-body-1', 'copy-body-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map([[pattern.id, pattern]])
    const selections: Selections = {
      graphSelections: [
        {
          artifact: pattern,
          codeRef: pattern.codeRef,
          engineEntityId: 'copy-body-1',
          patternIndex: 1,
        },
        {
          artifact: pattern,
          codeRef: pattern.codeRef,
          engineEntityId: 'copy-body-2',
          patternIndex: 2,
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toEqual(selections.graphSelections)
    }
  })

  it('uses KCL output order for multi-source pattern selections', () => {
    const pattern = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['source-a', 'source-b'],
      instanceIds: [
        'source-body-a',
        'copy-a1',
        'copy-a2',
        'source-body-b',
        'copy-b1',
        'copy-b2',
      ],
      copyIds: ['copy-a1', 'copy-a2', 'copy-b1', 'copy-b2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    } satisfies Extract<Artifact, { type: 'pattern' }>

    expect(
      pattern.instanceIds.map((engineEntityId) =>
        getPatternSelectionIndex({
          artifact: pattern,
          codeRef: pattern.codeRef,
          engineEntityId,
        })
      )
    ).toEqual([0, 1, 2, 3, 4, 5])
    expect(
      getPatternSelectionIndex({
        artifact: pattern,
        codeRef: pattern.codeRef,
        patternIndex: pattern.instanceIds.length,
      })
    ).toEqual(
      new Error(`Invalid pattern instance index: ${pattern.instanceIds.length}`)
    )
  })

  it('preserves metadata while deduplicating pattern copies', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['source-body'],
      instanceIds: ['source-body', 'copy-1', 'copy-2'],
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map([[pattern.id, pattern]])

    const firstCopy: Selection = {
      artifact: pattern,
      codeRef: { range: [0, 100, 0], pathToNode: [] },
      engineEntityId: 'copy-1',
      patternIndex: 1,
    }
    const secondCopy: Selection = {
      artifact: pattern,
      codeRef: { range: [0, 100, 0], pathToNode: [] },
      patternIndex: 2,
    }
    const firstCopyByEntityId: Selection = {
      artifact: pattern,
      codeRef: { range: [0, 100, 0], pathToNode: [] },
      engineEntityId: 'copy-1',
    }
    const firstCopyByIndex: Selection = {
      artifact: pattern,
      codeRef: { range: [0, 100, 0], pathToNode: [] },
      patternIndex: 1,
    }
    const selections: Selections = {
      graphSelections: [
        firstCopy,
        firstCopyByEntityId,
        firstCopyByIndex,
        secondCopy,
        { ...secondCopy },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toEqual([firstCopy, secondCopy])
    }
  })

  it('rejects pattern face and edge ids as body instance ids', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['source-body'],
      instanceIds: ['source-body', 'copy-1', 'copy-2'],
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: ['copy-face-1'],
      copyEdgeIds: ['copy-edge-1'],
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map([[pattern.id, pattern]])

    for (const engineEntityId of ['copy-face-1', 'copy-edge-1']) {
      const result = coerceSelectionsToBody(
        {
          graphSelections: [
            {
              artifact: pattern,
              codeRef: pattern.codeRef,
              engineEntityId,
            },
          ],
          otherSelections: [],
        },
        artifactGraph
      )

      expect(result).toEqual(
        new Error('Selected entity is not a body instance in the pattern')
      )
    }
  })

  it('should coerce edgeCut selection to parent path', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    }

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [100, 200, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
    }

    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
    }

    const edgeCut: Artifact = {
      type: 'edgeCut',
      id: 'edge-cut-1',
      consumedEdgeId: 'segment-1',
      subType: 'chamfer',
      edgeIds: [],
      codeRef: { range: [90, 95, 0], pathToNode: [], nodePath: { steps: [] } },
    }

    artifactGraph.set('path-1', path)
    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('segment-1', segment)
    artifactGraph.set('edge-cut-1', edgeCut)

    const selections: Selections = {
      graphSelections: [
        {
          artifact: edgeCut,
          codeRef: { range: [90, 95, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      expect(result.graphSelections[0].artifact?.type).toBe('path')
      expect(result.graphSelections[0].artifact?.id).toBe('path-1')
    }
  })
})

describe('getBodiesFromArtifactGraph', () => {
  it('includes copied pattern body ids as body entries', () => {
    const artifactGraph: ArtifactGraph = new Map()
    const sourceSweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
      patternIds: ['pattern-1'],
    }
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['sweep-1'],
      instanceIds: ['sweep-1', 'copy-1', 'copy-2'],
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: ['copy-face-1'],
      copyEdgeIds: ['copy-edge-1'],
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
    }

    artifactGraph.set(sourceSweep.id, sourceSweep)
    artifactGraph.set(pattern.id, pattern)

    const result = getBodiesFromArtifactGraph(artifactGraph)

    expect([...result.keys()]).toEqual(['sweep-1', 'copy-1', 'copy-2'])
    expect(result.get('sweep-1')).toBe(pattern)
    expect(result.get('copy-1')).toBe(pattern)
    expect(result.get('copy-2')).toBe(pattern)
  })

  it('includes copied pattern body ids when pattern source id is not a body artifact', () => {
    const artifactGraph: ArtifactGraph = new Map()
    const sourceSweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: [],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
      patternIds: ['pattern-1'],
    }
    const sourcePath: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: true,
      sweepId: 'sweep-1',
      patternIds: ['pattern-1'],
    }
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['path-1'],
      instanceIds: ['sweep-1', 'copy-1', 'copy-2'],
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
    }

    artifactGraph.set(sourcePath.id, sourcePath)
    artifactGraph.set(sourceSweep.id, sourceSweep)
    artifactGraph.set(pattern.id, pattern)

    const result = getBodiesFromArtifactGraph(artifactGraph)

    expect([...result.keys()]).toEqual(['sweep-1', 'copy-1', 'copy-2'])
    expect(result.get('sweep-1')).toBe(pattern)
    expect(result.get('copy-1')).toBe(pattern)
    expect(result.get('copy-2')).toBe(pattern)
  })

  it('includes every source and copy of a multi-source pattern in output order', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceIds: ['path-a', 'path-b'],
      instanceIds: [
        'sweep-a',
        'copy-a1',
        'copy-a2',
        'sweep-b',
        'copy-b1',
        'copy-b2',
      ],
      copyIds: ['copy-a1', 'copy-a2', 'copy-b1', 'copy-b2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
    }
    const result = getBodiesFromArtifactGraph(new Map([[pattern.id, pattern]]))

    expect([...result.keys()]).toEqual(pattern.instanceIds)
  })
})

describe('isFaceFromLegacySketch', () => {
  it('returns true when the wall belongs to a legacy sketch path', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    }

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [100, 200, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: ['wall-1'],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
    }

    const wall: Artifact = {
      type: 'wall',
      id: 'wall-1',
      cmdId: 'cmd-1',
      segId: 'segment-1',
      edgeCutEdgeIds: [],
      pathIds: [],
      sweepId: 'sweep-1',
      faceCodeRef: {
        range: [200, 300, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }

    artifactGraph.set(path.id, path)
    artifactGraph.set(sweep.id, sweep)
    artifactGraph.set(wall.id, wall)

    expect(isFaceFromLegacySketch('wall-1', artifactGraph)).toBe(true)
  })

  it('returns false when the wall does not resolve to a legacy sketch path', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
      subType: 'region',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    }

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [100, 200, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      pathId: 'path-1',
      subType: 'extrusion',
      surfaceIds: ['wall-1'],
      edgeIds: [],
      method: 'merge',
      trajectoryId: null,
      consumed: false,
    }

    const wall: Artifact = {
      type: 'wall',
      id: 'wall-1',
      cmdId: 'cmd-1',
      segId: 'segment-1',
      edgeCutEdgeIds: [],
      pathIds: [],
      sweepId: 'sweep-1',
      faceCodeRef: {
        range: [200, 300, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }

    artifactGraph.set(path.id, path)
    artifactGraph.set(sweep.id, sweep)
    artifactGraph.set(wall.id, wall)

    expect(isFaceFromLegacySketch('wall-1', artifactGraph)).toBe(false)
  })
})
