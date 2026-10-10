import { modelingMachine } from '@src/machines/modelingMachine'
import { modelingMachineInitialInternalContext } from '@src/machines/modelingSharedContext'
import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

// Importing the modeling machine requires generated Rust/WASM bindings, so this
// fixture belongs to the integration suite even though it does not use an engine.
describe('selection synchronization', () => {
  it('synchronizes default plane selection with the engine and editor', () => {
    const code = 'body001 = extrude(region001, length = 10)'
    const dispatch = vi.fn()
    const sendSceneCommand = vi.fn().mockResolvedValue(undefined)
    const context = {
      ...modelingMachineInitialInternalContext,
      selectionRanges: {
        graphSelections: [
          {
            entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
            codeRef: { range: [0, code.length, 0], pathToNode: [] },
          },
        ],
        otherSelections: [],
      },
      kclManager: {
        artifactGraph: new Map(),
        ast: { body: [] },
        code,
        editorView: { dispatch },
        hidePlanes: vi.fn(),
        isMultiSelectDown: false,
        sceneEntitiesManager: { activeSegments: {} },
        sceneInfra: {
          resetMouseListeners: vi.fn(),
          setCallbacks: vi.fn(),
          camControls: {
            enablePan: true,
            enableRotate: true,
            syncDirection: 'engineToClient',
          },
        },
      },
      rustContext: {},
      engineCommandManager: {
        connection: { pingIntervalId: 1 },
        sendSceneCommand,
      },
      wasmInstance: {},
      commandBarActor: {},
      machineManager: {},
    } as any
    const actor = createActor(modelingMachine, { input: context }).start()

    actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'defaultPlaneSelection',
        selection: { name: 'XY', id: 'xy-plane-id' },
      },
    })

    expect(actor.getSnapshot().context.selectionRanges).toEqual({
      graphSelections: [],
      otherSelections: [{ name: 'XY', id: 'xy-plane-id' }],
    })
    expect(dispatch).toHaveBeenCalledWith({
      selection: expect.objectContaining({
        main: expect.objectContaining({ head: code.length }),
      }),
    })
    expect(sendSceneCommand.mock.calls.map(([event]) => event.cmd)).toEqual([
      { type: 'select_clear' },
      { type: 'select_add', entities: ['xy-plane-id'] },
    ])

    sendSceneCommand.mockClear()

    actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: {
          entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
          codeRef: {
            range: [0, code.length, 0],
            pathToNode: [],
          },
        },
      },
    })

    expect(actor.getSnapshot().context.selectionRanges).toEqual({
      graphSelections: [
        {
          entityRef: { type: 'solid3d', solid3d_id: 'body-id' },
          codeRef: {
            range: [0, code.length, 0],
            pathToNode: [],
          },
        },
      ],
      otherSelections: [],
    })
    expect(sendSceneCommand.mock.calls.map(([event]) => event.cmd)).toEqual([
      {
        type: 'select_entity',
        entities: [{ type: 'solid3d', solid3d_id: 'body-id' }],
      },
    ])

    context.kclManager.isMultiSelectDown = true
    const addedSelection = {
      entityRef: { type: 'solid3d' as const, solid3d_id: 'second-body-id' },
      codeRef: {
        range: [0, code.length, 0] as [number, number, number],
        pathToNode: [],
      },
    }
    actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: addedSelection,
      },
    })
    expect(
      actor.getSnapshot().context.selectionRanges.graphSelections
    ).toHaveLength(2)

    // A missed Ctrl/Shift click preserves the selection; clicking again toggles off.
    actor.send({
      type: 'Set selection',
      data: { selectionType: 'singleCodeCursor', selection: {} },
    })
    expect(
      actor.getSnapshot().context.selectionRanges.graphSelections
    ).toHaveLength(2)
    actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'singleCodeCursor',
        selection: addedSelection,
      },
    })
    expect(
      actor.getSnapshot().context.selectionRanges.graphSelections
    ).toHaveLength(1)
    expect(
      actor.getSnapshot().context.selectionRanges.graphSelections[0].entityRef
    ).toEqual({
      type: 'solid3d',
      solid3d_id: 'body-id',
    })

    actor.stop()
  })
})
