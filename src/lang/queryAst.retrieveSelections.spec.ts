import type { OpArg } from '@rust/kcl-lib/bindings/Operation'
import { describe, expect, it } from 'vitest'
import { retrieveSelectionsFromOpArg } from '@src/lang/queryAst'
import type { ArtifactGraph, CodeRef } from '@src/lang/wasm'
import { err } from '@src/lib/trap'

describe('retrieveSelectionsFromOpArg', () => {
  it('coalesces region boundary segment arguments back to the region path', () => {
    const codeRef: CodeRef = {
      range: [10, 20, 0],
      nodePath: { steps: [] },
      pathToNode: [['body', '']],
    }
    const artifactGraph: ArtifactGraph = new Map([
      [
        'region-path',
        {
          type: 'path',
          id: 'region-path',
          subType: 'region',
          planeId: 'plane-1',
          segIds: ['region-seg-1', 'region-seg-2'],
          consumed: true,
          trajectorySweepId: null,
          solid2dId: null,
          codeRef,
          compositeSolidId: null,
          sketchBlockId: null,
          originPathId: 'sketch-path',
          innerPathId: null,
          outerPathId: null,
          patternIds: [],
        },
      ],
      [
        'region-seg-1',
        {
          type: 'segment',
          id: 'region-seg-1',
          pathId: 'region-path',
          originalSegId: 'line-1',
          surfaceId: null,
          edgeIds: [],
          edgeCutId: null,
          codeRef: { ...codeRef, range: [30, 40, 0] },
          commonSurfaceIds: [],
        },
      ],
      [
        'region-seg-2',
        {
          type: 'segment',
          id: 'region-seg-2',
          pathId: 'region-path',
          originalSegId: 'line-2',
          surfaceId: null,
          edgeIds: [],
          edgeCutId: null,
          codeRef: { ...codeRef, range: [40, 50, 0] },
          commonSurfaceIds: [],
        },
      ],
    ])
    const opArg: OpArg = {
      sourceRange: [60, 70, 0],
      value: {
        type: 'Array',
        value: [
          { type: 'Segment', artifact_id: 'region-seg-1' },
          { type: 'Segment', artifact_id: 'region-seg-2' },
        ],
      },
    }

    const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph)
    if (err(selections)) throw selections

    expect(selections.graphSelections).toHaveLength(1)
    expect(selections.graphSelections[0].artifact?.id).toBe('region-path')
    expect(selections.graphSelections[0].artifact?.type).toBe('path')
    if (selections.graphSelections[0].artifact?.type === 'path') {
      expect(selections.graphSelections[0].artifact.subType).toBe('region')
    }
  })
})
