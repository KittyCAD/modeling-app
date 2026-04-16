import { describe, expect, it, vi } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { createActor } from 'xstate'

import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { modelingMachine } from '@src/machines/modelingMachine'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

describe('modelingMachine engine region selections', () => {
  it('dispatches an editor selection for a region click', async () => {
    const {
      instance,
      kclManager,
      rustContext,
      engineCommandManager,
      commandBarActor,
      machineManager,
    } = await buildTheWorldAndNoEngineConnection(true)

    const sketchSnippet = 's = startSketchOn(XY)'
    const regionSnippet = 'r = region(point = [1mm, 1mm], sketch = s)'
    const code = `${sketchSnippet}\n${regionSnippet}\n`

    const sketchRange = [
      code.indexOf(sketchSnippet),
      code.indexOf(sketchSnippet) + sketchSnippet.length,
      0,
    ] as SourceRange
    const regionRange = [
      code.indexOf(regionSnippet),
      code.indexOf(regionSnippet) + regionSnippet.length,
      0,
    ] as SourceRange
    const emptyNodePath = { steps: [] }

    const artifactGraph: ArtifactGraph = new Map([
      [
        'sketch-block-1',
        {
          type: 'sketchBlock',
          id: 'sketch-block-1',
          codeRef: {
            range: sketchRange,
            pathToNode: [],
            nodePath: emptyNodePath,
          },
          planeId: 'plane-1',
          sketchId: 7,
        } as Artifact,
      ],
      [
        'region-path-1',
        {
          type: 'path',
          subType: 'region',
          id: 'region-path-1',
          codeRef: {
            range: regionRange,
            pathToNode: [],
            nodePath: emptyNodePath,
          },
          planeId: 'plane-1',
          segIds: [],
          trajectorySweepId: null,
          consumed: false,
        } as Artifact,
      ],
    ])

    kclManager.updateCodeEditor(code, {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
    })
    kclManager.artifactGraph = artifactGraph

    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const context = generateModelingMachineDefaultContext({
      kclManager,
      rustContext,
      wasmInstance: instance,
      engineCommandManager,
      commandBarActor,
      machineManager,
    })

    const actor = createActor(modelingMachine, { input: context }).start()

    actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'engineRegionSelection',
        selection: {
          type: 'engineRegion',
          id: 'engine-region-1',
          point: { x: 1, y: 1 },
          sketchId: 'sketch-block-1',
          pathId: 'region-path-1',
        },
      },
    })

    const editorDispatch = dispatchSpy.mock.calls.find(
      ([transaction]) => transaction?.selection
    )?.[0]
    const dispatchedSelection = editorDispatch?.selection

    expect(dispatchedSelection instanceof EditorSelection).toBe(true)
    if (!(dispatchedSelection instanceof EditorSelection)) {
      throw new Error('Expected an EditorSelection to be dispatched')
    }

    expect(dispatchedSelection.ranges[0]?.from).toBe(regionRange[1])
    expect(dispatchedSelection.ranges[0]?.to).toBe(regionRange[1])
  })
})
