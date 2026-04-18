import {
  buildSegmentCtorFromObject,
  sendToActorIfActive,
  updateHoveredId,
  updateSelectedCodeHighlight,
  updateSelectedIds,
  updateSketchOutcome,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createControlPointSplineApiObject,
  createLineApiObject,
  createPointApiObject,
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

describe('updateSelectedCodeHighlight', () => {
  test('dispatches cursor selections at selected sketch object source ranges', () => {
    const dispatch = vi.fn()
    const firstLine = createLineApiObject({ id: 2, start: 0, end: 1 })
    firstLine.source = { type: 'Simple', range: [40, 102, 0], node_path: null }
    const secondLine = createLineApiObject({ id: 5, start: 1, end: 3 })
    secondLine.source = {
      type: 'Simple',
      range: [113, 177, 0],
      node_path: null,
    }

    updateSelectedCodeHighlight({
      context: {
        selectedIds: [5, 2],
        duringAreaSelectIds: [],
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([firstLine, secondLine]),
        },
        kclManager: {
          code: 'x'.repeat(200),
          editorView: { dispatch },
        },
      },
    } as unknown as Parameters<typeof updateSelectedCodeHighlight>[0])

    expect(
      dispatch.mock.calls[0][0].selection.ranges.map(
        ({
          from,
          to,
          empty,
        }: { from: number; to: number; empty: boolean }) => ({
          from,
          to,
          empty,
        })
      )
    ).toEqual([
      { from: 102, to: 102, empty: true },
      { from: 177, to: 177, empty: true },
    ])
  })

  test('uses the child point source range for selected child points', () => {
    const dispatch = vi.fn()
    const point = createPointApiObject({ id: 2, owner: 5 })
    point.source = {
      type: 'Simple',
      range: [113, 177, 0],
      node_path: null,
    }
    const ownerLine = createLineApiObject({ id: 5, start: 2, end: 3 })
    ownerLine.source = { type: 'Simple', range: [10, 20, 0], node_path: null }

    updateSelectedCodeHighlight({
      context: {
        selectedIds: [2],
        duringAreaSelectIds: [],
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([point, ownerLine]),
        },
        kclManager: {
          code: 'x'.repeat(200),
          editorView: { dispatch },
        },
      },
    } as unknown as Parameters<typeof updateSelectedCodeHighlight>[0])

    expect(dispatch.mock.calls[0][0].selection.ranges[0]).toMatchObject({
      from: 177,
      to: 177,
      empty: true,
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

  test('uses the child point source range for hovered child points', () => {
    const setHighlightRange = vi.fn()
    const point = createPointApiObject({ id: 2, owner: 5 })
    point.source = {
      type: 'Simple',
      range: [113, 177, 0],
      node_path: null,
    }
    const ownerLine = createLineApiObject({ id: 5, start: 2, end: 3 })
    ownerLine.source = { type: 'Simple', range: [10, 20, 0], node_path: null }

    updateHoveredId({
      context: {
        sketchExecOutcome: {
          sceneGraphDelta: createSceneGraphDelta([point, ownerLine]),
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

    expect(setHighlightRange).toHaveBeenCalledWith([[113, 177, 0]])
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
