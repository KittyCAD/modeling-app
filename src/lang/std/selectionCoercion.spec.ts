import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  coerceSelectionsForBodyOnlySelectionTypes,
  coerceSelectionsToBody,
} from '@src/lang/std/selectionCoercion'
import type { ArtifactGraph } from '@src/lang/wasm'
import { assertParse } from '@src/lang/wasm'
import type { CommandArgument } from '@src/lib/commandTypes'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
} from '@src/lib/selections'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { loadWasm } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('coerceSelectionsToBody', () => {
  // Tests below are not redundant: they assert selectionsV2 behavior for codeRef-only selections
  // that resolve to path or edgeCut (no entityRef). Coerce must pass these through unchanged.

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

    // Path is not an EntityReference the engine returns; use codeRef-only selection.
    // Coerce passes through codeRef-only as-is (no artifact to resolve to body).
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [0, 100, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      expect(result.graphSelections[0].codeRef?.range).toEqual([0, 100, 0])
    }
  })

  it('should coerce edgeCut selection to parent sweep', () => {
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
      edgeCutId: 'edge-cut-1',
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

    // Edge-cut is not an EntityReference the engine returns; use codeRef-only selection.
    // Coerce passes through codeRef-only as-is.
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [90, 95, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      expect(result.graphSelections[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
      expect(result.graphSelections[0].codeRef?.range).toEqual([100, 200, 0])
    }
  })

  it('coerces code-reference edges and their profile to one body', () => {
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

    artifactGraph.set('path-1', path)
    artifactGraph.set('sweep-1', sweep)
    artifactGraph.set('segment-1', segment)
    artifactGraph.set('segment-2', {
      ...segment,
      id: 'segment-2',
      codeRef: { ...segment.codeRef, range: [30, 40, 0] },
    })

    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [10, 20, 0], pathToNode: [] },
        },
        { codeRef: { range: [30, 40, 0], pathToNode: [] } },
        { codeRef: path.codeRef },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      expect(result.graphSelections[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
    }
  })

  it('should coerce a segment when the command also accepts helices', () => {
    const artifactGraph: ArtifactGraph = new Map()
    artifactGraph.set('path-1', {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    })
    artifactGraph.set('sweep-1', {
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
    })
    artifactGraph.set('segment-1', {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
    })

    const result = coerceSelectionsForBodyOnlySelectionTypes(
      {
        graphSelections: [{ codeRef: { range: [10, 20, 0], pathToNode: [] } }],
        otherSelections: [],
      },
      ['path', 'sweep', 'compositeSolid', 'helix'],
      artifactGraph
    )

    expect(result?.graphSelections[0].entityRef).toEqual({
      type: 'solid3d',
      solid3d_id: 'sweep-1',
    })
  })

  it('should preserve a helix while coercing another selection to a body', () => {
    const artifactGraph: ArtifactGraph = new Map()
    artifactGraph.set('path-1', {
      type: 'path',
      subType: 'sketch',
      id: 'path-1',
      codeRef: { range: [0, 100, 0], pathToNode: [], nodePath: { steps: [] } },
      planeId: 'plane-1',
      segIds: ['segment-1'],
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      consumed: true,
    })
    artifactGraph.set('sweep-1', {
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
    })
    artifactGraph.set('segment-1', {
      type: 'segment',
      id: 'segment-1',
      pathId: 'path-1',
      edgeIds: [],
      commonSurfaceIds: [],
      codeRef: { range: [10, 20, 0], pathToNode: [], nodePath: { steps: [] } },
    })
    artifactGraph.set('helix-1', {
      type: 'helix',
      id: 'helix-1',
      codeRef: {
        range: [200, 300, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
      axisId: 'axis-1',
      trajectorySweepId: null,
      consumed: false,
    })

    const result = coerceSelectionsForBodyOnlySelectionTypes(
      {
        graphSelections: [
          { codeRef: { range: [10, 20, 0], pathToNode: [] } },
          { codeRef: { range: [200, 300, 0], pathToNode: [] } },
        ],
        otherSelections: [],
      },
      ['path', 'sweep', 'compositeSolid', 'helix'],
      artifactGraph
    )

    expect(result?.graphSelections).toHaveLength(2)
    expect(result?.graphSelections).toContainEqual({
      codeRef: { range: [200, 300, 0], pathToNode: [] },
    })
    expect(result?.graphSelections).toContainEqual(
      expect.objectContaining({
        entityRef: { type: 'solid3d', solid3d_id: 'sweep-1' },
      })
    )
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
      subType: 'sketch',
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
      graphSelections: [
        {
          codeRef: { range: [50, 120, 0], pathToNode: [] },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.graphSelections).toHaveLength(1)
      const entry = result.graphSelections[0]
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
      graphSelections: [],
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
      expect(result.graphSelections).toHaveLength(1)
      expect(result.otherSelections).toHaveLength(0)
      expect(result.graphSelections[0].entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: 'sweep-1',
      })
    }
  })

  it('coerces faces and edges for object fields without dropping other objects', async () => {
    const sweepOne: Artifact = {
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
    const sweepTwo: Artifact = {
      ...sweepOne,
      id: 'sweep-2',
      pathId: 'path-2',
      codeRef: {
        range: [150, 220, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const imported: Artifact = {
      type: 'importedGeometry',
      id: 'imported-1',
      consumed: false,
      codeRef: {
        range: [350, 400, 0],
        pathToNode: [],
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [sweepOne.id, sweepOne],
      [sweepTwo.id, sweepTwo],
      [imported.id, imported],
    ])
    const selections: Selections = {
      graphSelections: [
        {
          entityRef: { type: 'solid3d', solid3d_id: sweepOne.id },
          codeRef: sweepOne.codeRef,
        },
        {
          entityRef: { type: 'face', face_id: 'shell-inner-face' },
          engineEntityId: 'shell-inner-face',
          engineTopologyFallback: {
            parentId: sweepTwo.id,
            primitiveIndex: 4,
          },
        },
        {
          entityRef: { type: 'face', face_id: 'imported-face' },
          engineTopologyFallback: { parentId: imported.id, primitiveIndex: 0 },
        },
      ],
      otherSelections: [
        {
          type: 'enginePrimitive',
          entityId: 'edge-2',
          parentEntityId: sweepTwo.id,
          primitiveIndex: 2,
          primitiveType: 'edge',
        },
      ],
    }

    const argument = {
      inputType: 'selection',
      selectionTypes: ['sweep', 'plane', 'importedGeometry'],
      multiple: true,
      required: false,
    } satisfies CommandArgument<unknown>
    const result = coerceSelectionsForBodyOnlySelectionTypes(
      selections,
      argument.selectionTypes,
      artifactGraph
    )

    expect(result?.otherSelections).toEqual([])
    expect(result?.graphSelections).toEqual([
      {
        entityRef: { type: 'solid3d', solid3d_id: sweepOne.id },
        codeRef: sweepOne.codeRef,
      },
      {
        entityRef: { type: 'solid3d', solid3d_id: sweepTwo.id },
        codeRef: sweepTwo.codeRef,
      },
      { artifact: imported, codeRef: imported.codeRef },
    ])
    expect(
      coerceSelectionsForBodyOnlySelectionTypes(
        selections,
        ['sweep', 'wall', 'plane', 'importedGeometry'],
        artifactGraph
      )
    ).toBe(selections)

    const counts = getSelectionCountByType(
      assertParse('', await loadWasm()),
      result,
      artifactGraph
    )
    expect(canSubmitSelectionArg(counts, argument, result)).toBe(true)
  })
})
