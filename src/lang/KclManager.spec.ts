import { createEmptyAst } from '@src/editor/plugins/ast'
import { File } from '@src/lang/KclManager'
import type { Diagnostic } from '@codemirror/lint'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createKclManagerTestHarness,
  getLatestDispatchedDiagnostics,
} from '@src/lang/testHelpers/kclManagerTestHarness'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushPromises(count = 2) {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve()
  }
}

function createDiagnostic(
  from: number,
  to: number,
  message: string
): Diagnostic {
  return {
    from,
    to,
    message,
    severity: 'error',
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('KclManager diagnostics', () => {
  it('filters out duplicated diagnostics', () => {
    const { kclManager } = createKclManagerTestHarness()

    const duplicatedDiagnostics: Diagnostic[] = [
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 2,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
    ]

    expect(
      kclManager.makeUniqueDiagnostics(duplicatedDiagnostics)
    ).toStrictEqual([duplicatedDiagnostics[0]])
  })

  it('filters duplicated diagnostics while preserving distinct ones', () => {
    const { kclManager } = createKclManagerTestHarness()

    const duplicatedDiagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 0,
        to: 10,
        severity: 'hint',
        message: 'my cool message',
      },
      {
        from: 88,
        to: 99,
        severity: 'hint',
        message: 'my super cool message',
      },
    ]

    expect(
      kclManager.makeUniqueDiagnostics(duplicatedDiagnostics)
    ).toStrictEqual([duplicatedDiagnostics[0], duplicatedDiagnostics[2]])
  })

  it('filters out diagnostics whose ranges are outside the current document', () => {
    const { kclManager } = createKclManagerTestHarness('abcd')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const validDiagnostic = createDiagnostic(0, 2, 'valid')
    const staleDiagnostic = createDiagnostic(3, 5, 'stale')

    kclManager.setDiagnostics([validDiagnostic, staleDiagnostic])

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      validDiagnostic,
    ])
  })

  it('drops stale diagnostics after deleting code while diagnostics are present', () => {
    const { kclManager } = createKclManagerTestHarness('0123456789')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const baseDiagnostic = createDiagnostic(0, 2, 'base diagnostic')
    const staleBaseDiagnostic = createDiagnostic(8, 10, 'stale base diagnostic')
    const sketchSolveDiagnostic = createDiagnostic(
      2,
      3,
      'sketch solve diagnostic'
    )
    const staleSketchSolveDiagnostic = createDiagnostic(
      7,
      9,
      'stale sketch solve diagnostic'
    )

    kclManager.diagnostics = [baseDiagnostic, staleBaseDiagnostic]
    kclManager.setSketchSolveDiagnostics([
      sketchSolveDiagnostic,
      staleSketchSolveDiagnostic,
    ])

    expect(() =>
      kclManager.updateCodeEditor('012', {
        shouldExecute: false,
        shouldWriteToDisk: false,
        shouldResetCamera: false,
      })
    ).not.toThrow()

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      baseDiagnostic,
      sketchSolveDiagnostic,
    ])
  })

  it('deduplicates identical diagnostics across base and sketch-solve layers', () => {
    const { kclManager } = createKclManagerTestHarness('abcdef')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const duplicateDiagnostic = createDiagnostic(1, 4, 'duplicate')

    kclManager.diagnostics = [duplicateDiagnostic]
    kclManager.setSketchSolveDiagnostics([duplicateDiagnostic])

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      duplicateDiagnostic,
    ])
  })

  it('writes to file when the code is unchanged and shouldWriteToDisk is true', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    const currentCode = kclManager.code
    kclManager.updateCodeEditor(currentCode, {
      shouldWriteToDisk: true,
      shouldExecute: false,
      shouldResetCamera: false,
    })

    expect(writeToFileSpy).toHaveBeenCalledWith(currentCode)
  })

  it('does not write to file when the code is unchanged and shouldWriteToDisk is false', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    const currentCode = kclManager.code
    kclManager.updateCodeEditor(currentCode, {
      shouldWriteToDisk: false,
      shouldExecute: false,
      shouldResetCamera: false,
    })

    expect(writeToFileSpy).not.toHaveBeenCalled()
  })

  it('debounces repeated direct editor edits down to one execution of the latest code', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('a')
    const executeCodeSpy = vi
      .spyOn(kclManager, 'executeCode')
      .mockResolvedValue(undefined)

    kclManager.engineCommandManager.started = false
    kclManager.engineCommandManager.connection = { connected: true } as any

    kclManager.editorView.dispatch({
      changes: { from: 1, to: 1, insert: 'b' },
    })
    kclManager.editorView.dispatch({
      changes: { from: 2, to: 2, insert: 'c' },
    })

    expect(kclManager.code).toBe('abc')
    expect(executeCodeSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(executeCodeSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(executeCodeSpy).toHaveBeenCalledTimes(1)
    expect(executeCodeSpy).toHaveBeenCalledWith('abc')
  })

  it('debounces repeated programmatic updates so only the latest buffer is written', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('start')
    const writeSpy = vi.spyOn(kclManager, 'write').mockResolvedValue(undefined)

    kclManager.path = '/tmp/kcl-manager-write-test.kcl'
    kclManager.engineCommandManager.started = true

    kclManager.updateCodeEditor('first', {
      shouldExecute: false,
      shouldWriteToDisk: true,
      shouldResetCamera: false,
    })

    await vi.advanceTimersByTimeAsync(500)

    kclManager.updateCodeEditor('second', {
      shouldExecute: false,
      shouldWriteToDisk: true,
      shouldResetCamera: false,
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(writeSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy).toHaveBeenCalledWith('second')
  })

  it('reloads clean editor state from disk watcher updates', async () => {
    const { kclManager } = createKclManagerTestHarness('from disk')

    kclManager.path = '/tmp/kcl-manager-watch-test.kcl'
    ;(kclManager as any).systemDeps.projectPath.value = '/tmp/project'
    ;(kclManager as any).markFileCodeAsSynced('from disk')

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('external edit')

    const watchHandler = kclManager.onWatchEvent.at(-1)
    expect(watchHandler).toBeDefined()

    watchHandler?.('change', kclManager.path)
    await flushPromises()

    expect(kclManager.code).toBe('external edit')
  })

  it('does not overwrite dirty editor state when an external reload resolves later', async () => {
    const { kclManager } = createKclManagerTestHarness('local base')
    const deferredRead = createDeferred<string>()
    const updateCodeEditorSpy = vi.spyOn(kclManager, 'updateCodeEditor')

    kclManager.path = '/tmp/kcl-manager-watch-test.kcl'
    ;(kclManager as any).systemDeps.projectPath.value = '/tmp/project'
    ;(kclManager as any).markFileCodeAsSynced('local base')

    vi.spyOn(File.ioImplementations, 'read').mockReturnValue(
      deferredRead.promise
    )

    const watchHandler = kclManager.onWatchEvent.at(-1)
    expect(watchHandler).toBeDefined()

    watchHandler?.('change', kclManager.path)

    kclManager.updateCodeEditor('local newer', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
    })

    expect(updateCodeEditorSpy).toHaveBeenCalledTimes(1)

    deferredRead.resolve('external edit')
    await flushPromises()

    expect(kclManager.code).toBe('local newer')
    expect(updateCodeEditorSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses to replace the editor with an empty AST unless deletion was explicit', async () => {
    const { kclManager } = createKclManagerTestHarness('preserve me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    await kclManager.updateEditorWithAstAndWriteToFile(
      createEmptyAst() as unknown as Parameters<
        typeof kclManager.updateEditorWithAstAndWriteToFile
      >[0]
    )

    expect(kclManager.code).toBe('preserve me')
    expect(writeToFileSpy).not.toHaveBeenCalled()
  })

  it('drops stale sketch checkpoint restores when a newer local edit lands first', async () => {
    const { kclManager } = createKclManagerTestHarness('checkpoint base')
    const deferredRestore = createDeferred<{
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }>()
    const modelingSendSpy = vi.fn((event: unknown) => {
      if (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'update sketch outcome' &&
        'data' in event
      ) {
        const data = event.data as {
          sourceDelta: SourceDelta
        }
        kclManager.updateCodeEditor(data.sourceDelta.text, {
          shouldExecute: false,
          shouldWriteToDisk: false,
          shouldResetCamera: false,
          shouldAddToHistory: false,
        })
      }
    })

    kclManager.modelingState = {
      matches: (value: unknown) => value === 'sketchSolveMode',
    } as any
    kclManager.modelingSend = modelingSendSpy

    vi.spyOn(kclManager.rustContext, 'restoreSketchCheckpoint').mockReturnValue(
      deferredRestore.promise
    )

    void (kclManager as any).restoreSketchCheckpointForHistory(42)

    kclManager.updateCodeEditor('local newer', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
      shouldAddToHistory: false,
    })

    deferredRestore.resolve({
      kclSource: { text: 'checkpoint older' },
      sceneGraphDelta: {
        new_graph: [] as unknown as SceneGraphDelta['new_graph'],
        new_objects: [],
        invalidates_ids: true,
        exec_outcome: [] as unknown as SceneGraphDelta['exec_outcome'],
      },
    })
    await flushPromises()

    expect(kclManager.code).toBe('local newer')
    expect(modelingSendSpy).not.toHaveBeenCalled()
  })
})
