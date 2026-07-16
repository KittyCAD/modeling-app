import {
  type Artifact,
  BODY_ARTIFACT_TYPES,
  coerceSelectionsToBody,
  getBodiesFromArtifactGraph,
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

  it('preserves metadata and distinct selections for pattern copies', () => {
    const artifactGraph: ArtifactGraph = new Map()
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-1',
      subType: 'linear',
      sourceId: 'source-body',
      copyIds: ['copy-1', 'copy-2'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: [0, 100, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    artifactGraph.set(pattern.id, pattern)

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
      sourceId: 'source-body',
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
      sourceId: 'sweep-1',
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
      sourceId: 'path-1',
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
