import {
  sendToActorIfActive,
  updateHoveredId,
  updateSelectedIds,
  updateSketchOutcome,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createLineApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import toast from 'react-hot-toast'
import { describe, expect, test, vi } from 'vitest'

// This has to be an integration test because sketchSolveImpl has a dependency tracing back to WASM,
// even though this function doesn't directly use it.
describe('updateSelectedIds', () => {
  test('replaces the existing selection when requested', () => {
    const result = updateSelectedIds({
      context: {
        selectedIds: [3, 4, 10],
        duringAreaSelectIds: [],
      },
      event: {
        type: 'update selected ids',
        data: {
          selectedIds: [10],
          replaceExistingSelection: true,
        },
      },
    } as any)

    expect(result.selectedIds).toEqual([10])
  })
})

describe('sendToActorIfActive', () => {
  test('sends when the actor is active', () => {
    const send = vi.fn()
    const actor = {
      getSnapshot: () => ({ status: 'active' as const }),
      send,
    }

    const didSend = sendToActorIfActive(actor as any, { type: 'ping' })

    expect(didSend).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'ping' })
  })

  test('does not send when the actor has stopped', () => {
    const send = vi.fn()
    const actor = {
      getSnapshot: () => ({ status: 'stopped' as const }),
      send,
    }

    const didSend = sendToActorIfActive(actor as any, { type: 'ping' })

    expect(didSend).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('updateHoveredId', () => {
  test('highlights the hovered sketch object source range', () => {
    const setHighlightRange = vi.fn()
    const line = createLineApiObject({ id: 2, start: 0, end: 1 })
    line.source = { type: 'Simple', range: [10, 20, 0], node_path: null }

    const result = updateHoveredId({
      context: {
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([line]),
        },
        kclManager: {
          setHighlightRange,
        },
      },
      event: {
        type: 'update hovered id',
        data: { hoveredId: 2 },
      },
    } as unknown as Parameters<typeof updateHoveredId>[0])

    expect(result.hoveredId).toBe(2)
    expect(setHighlightRange).toHaveBeenCalledWith([[10, 20, 0]])
  })

  test('highlights all ranges for a backtrace source ref', () => {
    const setHighlightRange = vi.fn()
    const line = createLineApiObject({ id: 2, start: 0, end: 1 })
    line.source = {
      type: 'BackTrace',
      ranges: [
        [[10, 20, 0], null],
        [[30, 40, 0], null],
      ],
    }

    updateHoveredId({
      context: {
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([line]),
        },
        kclManager: {
          setHighlightRange,
        },
      },
      event: {
        type: 'update hovered id',
        data: { hoveredId: 2 },
      },
    } as unknown as Parameters<typeof updateHoveredId>[0])

    expect(setHighlightRange).toHaveBeenCalledWith([
      [10, 20, 0],
      [30, 40, 0],
    ])
  })

  test('clears the code highlight when no object is hovered', () => {
    const setHighlightRange = vi.fn()

    const result = updateHoveredId({
      context: {
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([]),
        },
        kclManager: {
          setHighlightRange,
        },
      },
      event: {
        type: 'update hovered id',
        data: { hoveredId: null },
      },
    } as unknown as Parameters<typeof updateHoveredId>[0])

    expect(result.hoveredId).toBeNull()
    expect(setHighlightRange).toHaveBeenCalledWith([])
  })
})

describe('updateSketchOutcome', () => {
  test('syncs sketch solve operations into KclManager after an immediate editor update', () => {
    const setSketchSolveDiagnostics = vi.fn()
    const dispatch = vi.fn()
    const updateCodeEditor = vi.fn()
    const syncSketchSolveOutcome = vi.fn()
    const sceneGraphDelta = createSceneGraphDelta([])

    updateSketchOutcome({
      context: {
        kclManager: {
          code: 'old code',
          dispatch,
          setSketchSolveDiagnostics,
          updateCodeEditor,
          syncSketchSolveOutcome,
        },
        selectedIds: [],
        duringAreaSelectIds: [],
      },
      event: {
        type: 'update sketch outcome',
        data: {
          sourceDelta: { text: 'new code' },
          sceneGraphDelta,
        },
      },
    } as any)

    expect(updateCodeEditor).toHaveBeenCalledWith(
      'new code',
      {
        shouldExecute: false,
        shouldWriteToDisk: true,
        shouldAddToHistory: true,
      },
      expect.any(Object)
    )
    expect(syncSketchSolveOutcome).toHaveBeenCalledWith(
      'new code',
      sceneGraphDelta
    )
    expect(updateCodeEditor.mock.invocationCallOrder[0]).toBeLessThan(
      syncSketchSolveOutcome.mock.invocationCallOrder[0]
    )
  })

  test('syncs sketch solve operations only when the debounced editor update runs', () => {
    vi.useFakeTimers()
    try {
      const setSketchSolveDiagnostics = vi.fn()
      const dispatch = vi.fn()
      const updateCodeEditor = vi.fn()
      const syncSketchSolveOutcome = vi.fn()
      const sceneGraphDelta = createSceneGraphDelta([])

      updateSketchOutcome({
        context: {
          kclManager: {
            code: 'old code',
            dispatch,
            setSketchSolveDiagnostics,
            updateCodeEditor,
            syncSketchSolveOutcome,
          },
          selectedIds: [],
          duringAreaSelectIds: [],
        },
        event: {
          type: 'update sketch outcome',
          data: {
            sourceDelta: { text: 'new code' },
            sceneGraphDelta,
            debounceEditorUpdate: true,
          },
        },
      } as any)

      expect(updateCodeEditor).not.toHaveBeenCalled()
      expect(syncSketchSolveOutcome).not.toHaveBeenCalled()

      vi.advanceTimersByTime(200)

      expect(updateCodeEditor).toHaveBeenCalled()
      expect(syncSketchSolveOutcome).toHaveBeenCalledWith(
        'new code',
        sceneGraphDelta
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('suppresses preview toasts while preserving exec outcome issues', () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    try {
      const setSketchSolveDiagnostics = vi.fn()
      const dispatch = vi.fn()
      const updateCodeEditor = vi.fn()
      const syncSketchSolveOutcome = vi.fn()
      const sceneGraphDelta = createSceneGraphDelta([])
      sceneGraphDelta.exec_outcome.issues = [
        {
          message: 'Overlapping geometry',
          severity: 'Warning',
          sourceRange: [0, 0, 0],
        } as any,
      ]

      const result = updateSketchOutcome({
        context: {
          kclManager: {
            code: 'old code',
            dispatch,
            setSketchSolveDiagnostics,
            updateCodeEditor,
            syncSketchSolveOutcome,
          },
          selectedIds: [],
          duringAreaSelectIds: [],
        },
        event: {
          type: 'update sketch outcome',
          data: {
            sourceDelta: { text: 'new code' },
            sceneGraphDelta,
            suppressExecOutcomeIssues: true,
          },
        },
      } as any)

      expect(toastErrorSpy).not.toHaveBeenCalled()
      expect(
        result.sketchExecOutcome?.sceneGraphDelta.exec_outcome.issues
      ).toEqual(sceneGraphDelta.exec_outcome.issues)
      expect(setSketchSolveDiagnostics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Overlapping geometry',
            severity: 'warning',
          }),
        ])
      )
    } finally {
      toastErrorSpy.mockRestore()
    }
  })
})
