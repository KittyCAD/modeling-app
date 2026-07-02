import {
  type Artifact,
  type ResolvedGraphSelection,
  getArtifactFromRange,
  getBodiesFromArtifactGraph,
  getSketchBlockForArtifact,
  getSweepArtifactFromSelection,
  isFaceFromLegacySketch,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, PathToNode } from '@src/lang/wasm'
import type { Selection } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

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
      edgeCutId: 'edge-cut-1',
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

    const selection: ResolvedGraphSelection = {
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

  // sweepEdge was removed from the artifact graph / selectionsV2; edgeCut now resolves via
  // segment or via entityRef (edge). A test for edge selection → sweep could use an edge
  // entityRef payload instead of the legacy edgeCut -> sweepEdge chain.
})

describe('getSketchBlockForArtifact', () => {
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
    } as unknown as Artifact

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
})

describe('getArtifactFromRange', () => {
  it('prefers the requested sketchBlock over a same-range path match', () => {
    const artifactGraph: ArtifactGraph = new Map()
    const range: [number, number, number] = [10, 40, 0]

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: {
        range,
        pathToNode: [],
        nodePath: { steps: [] },
      },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: false,
    }

    const sketchBlock: Artifact = {
      type: 'sketchBlock',
      id: 'sketch-1',
      codeRef: {
        range,
        pathToNode: [],
        nodePath: { steps: [] },
      },
      planeId: 'plane-1',
      sketchId: 1,
    }

    artifactGraph.set(path.id, path)
    artifactGraph.set(sketchBlock.id, sketchBlock)

    expect(getArtifactFromRange(range, artifactGraph, 'sketchBlock')).toEqual(
      sketchBlock
    )
  })

  it('prefers sketchBlock over a same-range path match without a preferred type', () => {
    const artifactGraph: ArtifactGraph = new Map()
    const range: [number, number, number] = [10, 40, 0]

    const path: Artifact = {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: {
        range,
        pathToNode: [],
        nodePath: { steps: [] },
      },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: false,
    }

    const sketchBlock: Artifact = {
      type: 'sketchBlock',
      id: 'sketch-1',
      codeRef: {
        range,
        pathToNode: [],
        nodePath: { steps: [] },
      },
      planeId: 'plane-1',
      sketchId: 1,
    }

    artifactGraph.set(path.id, path)
    artifactGraph.set(sketchBlock.id, sketchBlock)

    expect(getArtifactFromRange(range, artifactGraph)).toEqual(sketchBlock)
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
