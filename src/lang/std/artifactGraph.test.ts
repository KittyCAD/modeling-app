import { describe, it, expect } from 'vitest'
import {
  getSweepArtifactFromSelection,
  type Artifact,
  type ResolvedGraphSelection,
} from '@src/lang/std/artifactGraph'
import { coerceSelectionsToBody } from '@src/lang/std/selectionCoercion'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'

describe('getSweepArtifactFromSelection', () => {
  it('should return sweep from edgeCut -> segment selection', () => {
    const artifactGraph: ArtifactGraph = new Map()

    // Create path -> sweep -> segment -> edgeCut chain
    const path: Artifact = {
      type: 'path',
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

    const segment = {
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
    } as Artifact

    const edgeCut = {
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
    } as Artifact

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

describe('coerceSelectionsToBody', () => {
  // Tests below are not redundant: they assert selectionsV2 behavior for codeRef-only selections
  // that resolve to path or edgeCut (no entityRef). Coerce must pass these through unchanged.

  it('should pass through path artifact unchanged', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: false,
    }
    artifactGraph.set('path-1', path)

    // Path is not an EntityReference the engine returns; use codeRef-only selection.
    // Coerce passes through codeRef-only as-is (no artifact to resolve to body).
    const selections: Selections = {
      graphSelectionsV2: [
        {
          codeRef: { range: [0, 100, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelectionsV2).toHaveLength(1)
      expect(result.graphSelectionsV2[0].codeRef?.range).toEqual([0, 100, 0])
    }
  })

  it('should coerce edgeCut selection to parent sweep', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
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

    const segment = {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
    } as Artifact

    const edgeCut = {
      type: 'edgeCut',
      id: 'edge-cut-1',
      consumedEdgeId: 'segment-1',
      subType: 'chamfer',
      edgeIds: [],
      codeRef: { range: [90, 95, 0], pathToNode: [], nodePath: { steps: [] } },
    } as Artifact

    artifactGraph.set('path-1', path)
    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('segment-1', segment)
    artifactGraph.set('edge-cut-1', edgeCut)

    // Edge-cut is not an EntityReference the engine returns; use codeRef-only selection.
    // Coerce passes through codeRef-only as-is.
    const selections: Selections = {
      graphSelectionsV2: [
        {
          codeRef: { range: [90, 95, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelectionsV2).toHaveLength(1)
      expect(result.graphSelectionsV2[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
      expect(result.graphSelectionsV2[0].codeRef?.range).toEqual([100, 200, 0])
    }
  })

  it('should coerce codeRef-only segment selection to parent sweep', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const path: Artifact = {
      type: 'path',
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
      commonSurfaceIds: [],
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
    }

    artifactGraph.set('path-1', path)
    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('segment-1', segment)

    const selections: Selections = {
      graphSelectionsV2: [
        {
          codeRef: { range: [10, 20, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelectionsV2).toHaveLength(1)
      expect(result.graphSelectionsV2[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
    }
  })

  it('should keep sweep (body with entityRef) as body selection', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [50, 120, 0],
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

    const path: Artifact = {
      type: 'path',
      id: 'path-1',
      codeRef: { range: [0, 45, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: [],
      trajectorySweepId: null,
      consumed: true,
    }

    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('path-1', path)

    // Selection that resolves to sweep (body); should remain as body selection.
    const selections: Selections = {
      graphSelectionsV2: [
        {
          codeRef: { range: [50, 120, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelectionsV2).toHaveLength(1)
      const entry = result.graphSelectionsV2[0]
      expect(entry.codeRef?.range).toEqual([50, 120, 0])
      // Resolved body is kept (sweep has entityRef, so it appears as body selection).
      expect(entry).toHaveProperty('codeRef')
    }
  })

  it('should coerce engine primitive edge selection to parent sweep', () => {
    const artifactGraph: ArtifactGraph = new Map()

    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      codeRef: {
        range: [50, 120, 0],
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

    artifactGraph.set('sweep-1', sweep)

    const selections: Selections = {
      graphSelectionsV2: [],
      otherSelections: [
        {
          type: 'enginePrimitive',
          entityId: 'edge-1',
          parentEntityId: 'sweep-1',
          primitiveIndex: 2,
          primitiveType: 'edge',
        },
      ],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelectionsV2).toHaveLength(1)
      expect(result.otherSelections).toHaveLength(0)
      expect(result.graphSelectionsV2[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
    }
  })
})
