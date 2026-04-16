import { expect, describe, test, vi } from 'vitest'
import toast from 'react-hot-toast'
import {
  buildSegmentCtorFromObject,
  sendToActorIfActive,
  updateSketchOutcome,
  updateSelectedIds,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createControlPointSplineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

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

describe('buildSegmentCtorFromObject', () => {
  test('builds a control point spline ctor from linked control points', () => {
    const p1 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const p2 = createPointApiObject({ id: 2, x: 10, y: 20 })
    const p3 = createPointApiObject({ id: 3, x: 20, y: 0 })
    const spline = createControlPointSplineApiObject({
      id: 4,
      controls: [1, 2, 3],
    })
    const objects = createSceneGraphDelta([p1, p2, p3, spline]).new_graph
      .objects

    expect(buildSegmentCtorFromObject(spline, objects)).toEqual({
      type: 'ControlPointSpline',
      points: [
        {
          x: { type: 'Var', value: 0, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
        {
          x: { type: 'Var', value: 10, units: 'Mm' },
          y: { type: 'Var', value: 20, units: 'Mm' },
        },
        {
          x: { type: 'Var', value: 20, units: 'Mm' },
          y: { type: 'Var', value: 0, units: 'Mm' },
        },
      ],
      construction: false,
    })
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
