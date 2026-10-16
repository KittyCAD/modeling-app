import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  coerceSelectionsForBodyOnlySelectionTypes,
  coerceSelectionsToBody,
} from '@src/lang/std/selectionCoercion'
import type { ArtifactGraph, CodeRef, Program } from '@src/lang/wasm'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { canSubmitSelectionArg } from '@src/lib/selections'
import { isArray } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

describe('coerceSelectionsToBody', () => {
  it('preserves the identity of pattern body selections', () => {
    const pattern: Artifact = {
      type: 'pattern',
      id: 'pattern-command-id',
      subType: 'linear',
      sourceId: 'source-body-id',
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
    const withoutEngineIds: Selections = {
      ...selections,
      graphSelections: selections.graphSelections.map(
        ({ engineEntityId: _, ...selection }) => selection
      ),
    }
    expect(coerceSelectionsToBody(withoutEngineIds, artifactGraph)).toEqual(
      withoutEngineIds
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

    // Path is not an EntityReference the engine returns; use codeRef-only selection.
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

  it('should coerce codeRef-only segment selection to parent sweep', () => {
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

    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [10, 20, 0], pathToNode: [] },
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

  const objectCodeRef: CodeRef = {
    range: [200, 300, 0],
    pathToNode: [],
    nodePath: { steps: [] },
  }
  it.each<{
    command: 'Translate' | 'Delete' | 'Appearance'
    object: Artifact
  }>([
    {
      command: 'Translate',
      object: {
        type: 'path',
        subType: 'region',
        id: 'region-1',
        codeRef: objectCodeRef,
        planeId: 'plane-1',
        segIds: [],
        trajectorySweepId: null,
        consumed: false,
      },
    },
    {
      command: 'Delete',
      object: {
        type: 'helix',
        id: 'helix-1',
        codeRef: objectCodeRef,
        axisId: 'axis-1',
        trajectorySweepId: null,
        consumed: false,
      },
    },
    {
      command: 'Delete',
      object: {
        type: 'sketchBlock',
        id: 'sketch-1',
        sketchId: 1,
        codeRef: objectCodeRef,
      },
    },
    {
      command: 'Appearance',
      object: {
        type: 'plane',
        id: 'plane-1',
        codeRef: objectCodeRef,
        pathIds: [],
      },
    },
  ])(
    'preserves $object.type for $command while coercing a face',
    ({ command, object }) => {
      const artifactGraph: ArtifactGraph = new Map()
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
      artifactGraph.set(object.id, object)
      const config = modelingMachineCommandConfig[command]
      if (
        !config ||
        isArray(config) ||
        config.args?.objects.inputType !== 'selection'
      )
        throw new Error('Expected an object selection argument')
      const arg = config.args.objects

      const result = coerceSelectionsForBodyOnlySelectionTypes(
        {
          graphSelections: [{ codeRef: objectCodeRef }],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: 'face-1',
              parentEntityId: 'sweep-1',
              primitiveIndex: 0,
              primitiveType: 'face',
            },
          ],
        },
        arg.selectionTypes,
        artifactGraph
      )

      const ast: Node<Program> = {
        type: 'Program',
        body: [],
        start: 0,
        end: 0,
        moduleId: 0,
        commentStart: 0,
      }
      expect(canSubmitSelectionArg(ast, result, arg, artifactGraph)).toBe(true)
      expect(result?.graphSelections).toHaveLength(2)
      expect(result?.graphSelections).toContainEqual(
        expect.objectContaining({
          codeRef: objectCodeRef,
        })
      )
      expect(result?.graphSelections).toContainEqual(
        expect.objectContaining({
          entityRef: { type: 'solid3d', solid3d_id: 'sweep-1' },
        })
      )
    }
  )

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

  it('should coerce a topology-backed graph face without dropping another body', () => {
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
    const artifactGraph: ArtifactGraph = new Map([
      [sweepOne.id, sweepOne],
      [sweepTwo.id, sweepTwo],
    ])
    const selections: Selections = {
      graphSelections: [
        {
          entityRef: { type: 'face', face_id: 'unmapped-face' },
          engineEntityId: 'unmapped-face',
          codeRef: sweepOne.codeRef,
        },
        {
          entityRef: { type: 'solid3d', solid3d_id: sweepOne.id },
          codeRef: sweepOne.codeRef,
        },
        {
          entityRef: { type: 'solid3d', solid3d_id: sweepOne.id },
          codeRef: sweepOne.codeRef,
          engineEntityId: 'sweep-1-engine',
        },
        {
          entityRef: { type: 'face', face_id: 'shell-inner-face' },
          engineEntityId: 'shell-inner-face',
          engineTopologyFallback: {
            parentId: sweepTwo.id,
            primitiveIndex: 4,
          },
        },
      ],
      otherSelections: [],
    }

    const result = coerceSelectionsToBody(selections, artifactGraph)

    expect(result).not.toBeInstanceOf(Error)
    if (!(result instanceof Error)) {
      expect(result.otherSelections).toHaveLength(0)
      expect(result.graphSelections).toHaveLength(2)
      expect(
        result.graphSelections.map((selection) => selection.entityRef)
      ).toEqual([
        { type: 'solid3d', solid3d_id: 'sweep-1' },
        { type: 'solid3d', solid3d_id: 'sweep-2' },
      ])
    }
  })

  it('retains unresolved selections for validation', () => {
    const body = {
      entityRef: { type: 'solid3d', solid3d_id: 'body' },
    } satisfies Selections['graphSelections'][number]
    const unresolved = {
      entityRef: { type: 'face', face_id: 'missing' },
    } satisfies Selections['graphSelections'][number]
    const result = coerceSelectionsToBody(
      {
        graphSelections: [body, unresolved],
        otherSelections: [],
      },
      new Map()
    )
    expect(result).toEqual({
      graphSelections: [body, unresolved],
      otherSelections: [],
    })
  })
})
