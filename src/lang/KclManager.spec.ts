import type { Diagnostic } from '@codemirror/lint'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { createEmptyAst } from '@src/editor/plugins/ast'
import { File, KclManager } from '@src/lang/KclManager'
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

function getRecoverySnapshotKey(path: string) {
  return `kclRecovery:${path}`
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

function createEmptySceneGraphDelta(): SceneGraphDelta {
  return {
    new_graph: [] as unknown as SceneGraphDelta['new_graph'],
    new_objects: [],
    invalidates_ids: true,
    exec_outcome: [] as unknown as SceneGraphDelta['exec_outcome'],
  }
}

function enableSketchSolveEditorExecution(kclManager: KclManager) {
  kclManager.modelingState = {
    matches: (value: unknown) => value === 'sketchSolveMode',
  } as unknown as NonNullable<KclManager['modelingState']>
  kclManager.engineCommandManager.connection = {
    connected: true,
  } as unknown as typeof kclManager.engineCommandManager.connection
}

afterEach(() => {
  vi.clearAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage?.clear()
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

  it('clears sketch-solve diagnostics without persisting them into the base diagnostics layer', () => {
    const { kclManager } = createKclManagerTestHarness('abcdef')
    const dispatchSpy = vi.spyOn(kclManager.editorView, 'dispatch')

    const baseDiagnostic = createDiagnostic(0, 2, 'base diagnostic')
    const sketchSolveDiagnostic = createDiagnostic(
      2,
      4,
      'sketch solve diagnostic'
    )

    kclManager.diagnostics = [baseDiagnostic]
    kclManager.setSketchSolveDiagnostics([sketchSolveDiagnostic])
    kclManager.setSketchSolveDiagnostics([])

    expect(getLatestDispatchedDiagnostics(dispatchSpy.mock.calls)).toEqual([
      baseDiagnostic,
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

    expect(writeToFileSpy).toHaveBeenCalledWith(currentCode, undefined, {
      suppressConflictToast: true,
    })
  })

  it('writes to file for same-code sketch checkpoint commits', () => {
    const previewCode = 'drag preview source'
    const { kclManager } = createKclManagerTestHarness(previewCode)
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)
    ;(kclManager as any).lastCommittedCode = 'source before drag'
    ;(kclManager as any).lastCommittedSketchCheckpointId = 2

    kclManager.updateCodeEditor(
      previewCode,
      {
        shouldExecute: false,
        shouldWriteToDisk: true,
        shouldResetCamera: false,
      },
      {
        sketchCheckpointId: 3,
      }
    )

    expect(writeToFileSpy).toHaveBeenCalledWith(previewCode, undefined, {
      suppressConflictToast: true,
    })
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

  it('does not implicitly autosave programmatic editor updates when shouldWriteToDisk is false', () => {
    const { kclManager } = createKclManagerTestHarness('persist me')
    const writeToFileSpy = vi
      .spyOn(kclManager, 'writeToFile')
      .mockResolvedValue(undefined)

    kclManager.engineCommandManager.started = true

    kclManager.updateCodeEditor('changed programmatically', {
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

  it('tracks whether the editor differs from the last execution', () => {
    const { kclManager } = createKclManagerTestHarness('a')
    ;(kclManager as any).markCodeAsExecuted('a')

    expect(kclManager.hasEditsSinceLastExecutionSignal.value).toBe(false)

    kclManager.editorView.dispatch({
      changes: { from: 1, to: 1, insert: 'b' },
    })

    expect(kclManager.hasEditsSinceLastExecutionSignal.value).toBe(true)

    kclManager.editorView.dispatch({
      changes: { from: 1, to: 2, insert: '' },
    })

    expect(kclManager.hasEditsSinceLastExecutionSignal.value).toBe(false)
  })

  it('marks fresh direct sketch editor executions as derived source updates', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('base')
    const sceneGraphDelta = createEmptySceneGraphDelta()
    const checkpointId = 55
    const modelingSendSpy = vi.fn()
    enableSketchSolveEditorExecution(kclManager)
    kclManager.modelingSend = modelingSendSpy

    vi.spyOn(kclManager, 'executeCode').mockResolvedValue(undefined)
    vi.spyOn(kclManager.rustContext, 'hackSetProgram').mockResolvedValue({
      type: 'Success',
      sceneGraph: sceneGraphDelta.new_graph,
      execOutcome: sceneGraphDelta.exec_outcome,
      checkpointId,
    })

    kclManager.editorView.dispatch({
      changes: { from: 4, to: 4, insert: ' fresh' },
    })

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(modelingSendSpy).toHaveBeenCalledTimes(1)
    expect(modelingSendSpy).toHaveBeenCalledWith({
      type: 'update sketch outcome',
      data: {
        sourceDelta: { text: 'base fresh' },
        sceneGraphDelta,
        updateEditor: false,
        writeToDisk: false,
        addToHistory: false,
        checkpointId,
      },
    })
  })

  it('drops direct sketch editor executions that go stale while parsing executes', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('base')
    const deferredExecution = createDeferred<undefined>()
    const modelingSendSpy = vi.fn()
    enableSketchSolveEditorExecution(kclManager)
    kclManager.modelingSend = modelingSendSpy

    vi.spyOn(kclManager, 'executeCode').mockReturnValue(
      deferredExecution.promise
    )
    const hackSetProgramSpy = vi.spyOn(kclManager.rustContext, 'hackSetProgram')

    kclManager.editorView.dispatch({
      changes: { from: 4, to: 4, insert: ' stale' },
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(kclManager.code).toBe('base stale')

    kclManager.editorView.dispatch({
      changes: { from: 10, to: 10, insert: ' newer' },
    })
    deferredExecution.resolve(undefined)
    await flushPromises()

    expect(kclManager.code).toBe('base stale newer')
    expect(hackSetProgramSpy).not.toHaveBeenCalled()
    expect(modelingSendSpy).not.toHaveBeenCalled()
  })

  it('drops direct sketch editor executions that go stale while Rust updates the program', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('base')
    const sceneGraphDelta = createEmptySceneGraphDelta()
    const deferredSetProgram =
      createDeferred<
        Awaited<ReturnType<typeof kclManager.rustContext.hackSetProgram>>
      >()
    const modelingSendSpy = vi.fn()
    enableSketchSolveEditorExecution(kclManager)
    kclManager.modelingSend = modelingSendSpy

    vi.spyOn(kclManager, 'executeCode').mockResolvedValue(undefined)
    const hackSetProgramSpy = vi
      .spyOn(kclManager.rustContext, 'hackSetProgram')
      .mockReturnValue(deferredSetProgram.promise)

    kclManager.editorView.dispatch({
      changes: { from: 4, to: 4, insert: ' stale' },
    })

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(hackSetProgramSpy).toHaveBeenCalledTimes(1)

    kclManager.editorView.dispatch({
      changes: { from: 10, to: 10, insert: ' newer' },
    })
    deferredSetProgram.resolve({
      type: 'Success',
      sceneGraph: sceneGraphDelta.new_graph,
      execOutcome: sceneGraphDelta.exec_outcome,
      checkpointId: 55,
    })
    await flushPromises()

    expect(kclManager.code).toBe('base stale newer')
    expect(modelingSendSpy).not.toHaveBeenCalled()
  })

  it('debounces repeated programmatic updates so only the latest buffer is written', async () => {
    vi.useFakeTimers()

    const { kclManager } = createKclManagerTestHarness('start')
    const writeSpy = vi.spyOn(kclManager, 'write').mockResolvedValue(undefined)

    kclManager.path = '/tmp/kcl-manager-write-test.kcl'
    ;(kclManager as any).markFileCodeAsSynced('start')
    kclManager.engineCommandManager.started = true
    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('start')

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

  it('does not reload Zookeeper disk watcher updates into the active editor', async () => {
    const { kclManager } = createKclManagerTestHarness('from disk')
    const updateCodeEditorSpy = vi.spyOn(kclManager, 'updateCodeEditor')

    kclManager.path = '/tmp/kcl-manager-zookeeper-watch-test.kcl'
    kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = true
    ;(kclManager as any).systemDeps.projectPath.value = '/tmp/project'
    ;(kclManager as any).markFileCodeAsSynced('from disk')

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('zookeeper edit')

    const watchHandler = kclManager.onWatchEvent.at(-1)
    expect(watchHandler).toBeDefined()

    watchHandler?.('change', kclManager.path)
    await flushPromises()

    expect(updateCodeEditorSpy).not.toHaveBeenCalled()
    expect(kclManager.code).toBe('from disk')
  })

  it('does not reload active editor disk updates while Zookeeper history is pending', async () => {
    const { kclManager } = createKclManagerTestHarness('from disk')
    const updateCodeEditorSpy = vi.spyOn(kclManager, 'updateCodeEditor')
    const testInternals = kclManager as unknown as {
      markFileCodeAsSynced(code: string): void
      systemDeps: { projectPath: { value: string } }
    }

    kclManager.path = '/tmp/kcl-manager-zookeeper-history-pending-test.kcl'
    kclManager.zookeeperHistoryRecordingInProgress = true
    testInternals.systemDeps.projectPath.value = '/tmp/project'
    testInternals.markFileCodeAsSynced('from disk')

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('zookeeper edit')

    const watchHandler = kclManager.onWatchEvent.at(-1)
    expect(watchHandler).toBeDefined()

    watchHandler?.('change', kclManager.path)
    await flushPromises()

    expect(updateCodeEditorSpy).not.toHaveBeenCalled()
    expect(kclManager.code).toBe('from disk')
  })

  it('reloads clean editor state from explicit disk refreshes', async () => {
    const { kclManager } = createKclManagerTestHarness('from disk')

    kclManager.path = '/tmp/kcl-manager-explicit-reload-test.kcl'
    ;(kclManager as any).markFileCodeAsSynced('from disk')

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('sketch = 1')
    const updateSpy = vi.spyOn(kclManager, 'updateCodeEditor')

    await kclManager.reloadFromDisk()

    expect(updateSpy).toHaveBeenCalledWith(
      'sketch = 1',
      expect.objectContaining({
        shouldExecute: true,
        shouldClearHistory: true,
        shouldResetCamera: true,
        shouldWriteToDisk: false,
      })
    )
    expect(kclManager.code).toBe('sketch = 1')
  })

  it('arms disk watcher when reusing the singleton editor for an opened file', async () => {
    const { kclManager } = createKclManagerTestHarness('')
    const path = '/tmp/kcl-manager-watch-open-test.kcl'
    const readSpy = vi
      .spyOn(File.ioImplementations, 'read')
      .mockResolvedValue('opened code')
    const watchSpy = vi
      .spyOn(File.ioImplementations, 'watch')
      .mockImplementation(() => {})

    const opened = await KclManager.fromFile(
      new File(path, 101),
      (kclManager as any).systemDeps,
      kclManager
    )

    expect(opened).toBe(kclManager)
    expect(kclManager.watching).toBe(true)
    expect(watchSpy).toHaveBeenCalledWith(
      path,
      expect.any(String),
      expect.any(Function)
    )

    readSpy.mockRestore()
    watchSpy.mockRestore()
  })

  it('refreshes derived state when restoring cached editor state for a reopened file', async () => {
    vi.useFakeTimers()

    const mainPath = '/tmp/kcl-manager-restored-main.kcl'
    const depsPath = '/tmp/kcl-manager-restored-deps.kcl'
    const mainCode = 'import x from "deps.kcl"\n'
    const depsCode = 'export x = 42\n'
    const { kclManager } = createKclManagerTestHarness(mainCode)
    const systemDeps = (kclManager as any).systemDeps

    kclManager.path = mainPath
    kclManager.id = 1

    vi.spyOn(File.ioImplementations, 'read').mockImplementation(
      async (path) => {
        return path === depsPath ? depsCode : mainCode
      }
    )

    await KclManager.fromFile(new File(depsPath, 2), systemDeps, kclManager)

    const sendUpdateFileSpy = vi
      .spyOn(kclManager.rustContext, 'sendUpdateFile')
      .mockResolvedValue(undefined)
    const executeCodeSpy = vi
      .spyOn(kclManager, 'executeCode')
      .mockResolvedValue(undefined)
    kclManager.engineCommandManager.connection = {
      connected: true,
    } as typeof kclManager.engineCommandManager.connection

    await KclManager.fromFile(new File(mainPath, 1), systemDeps, kclManager)

    expect(sendUpdateFileSpy).toHaveBeenCalledWith(1, mainCode)

    await vi.advanceTimersByTimeAsync(1000)

    expect(executeCodeSpy).toHaveBeenCalledWith(mainCode)
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

    await kclManager.updateEditorWithAstAndWriteToFile(createEmptyAst())

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

  it('restores the pre-drag checkpoint when undoing a recovered drag commit', async () => {
    const baselineCode = 'baseline sketch'
    const recoveredCode = 'last good preview'
    const preDragCheckpointId = 7
    const recoveredCheckpointId = 11
    const { kclManager } = createKclManagerTestHarness(baselineCode)
    const modelingSendSpy = vi.fn()

    kclManager.modelingState = {
      matches: (value: unknown) => value === 'sketchSolveMode',
    } as any
    kclManager.modelingSend = modelingSendSpy
    ;(kclManager as any).lastCommittedCode = baselineCode
    ;(kclManager as any).lastCommittedAdditionalSpec = {
      sketchCheckpointId: preDragCheckpointId,
    }
    ;(kclManager as any).lastCommittedSketchCheckpointId = preDragCheckpointId

    const restoreSketchCheckpointSpy = vi
      .spyOn(kclManager.rustContext, 'restoreSketchCheckpoint')
      .mockResolvedValue({
        kclSource: { text: baselineCode },
        sceneGraphDelta: {
          new_graph: [] as unknown as SceneGraphDelta['new_graph'],
          new_objects: [],
          invalidates_ids: true,
          exec_outcome: [] as unknown as SceneGraphDelta['exec_outcome'],
        },
      })

    kclManager.updateCodeEditor(recoveredCode, {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
      shouldAddToHistory: false,
    })

    kclManager.updateCodeEditor(
      recoveredCode,
      {
        shouldExecute: false,
        shouldResetCamera: false,
      },
      {
        sketchCheckpointId: recoveredCheckpointId,
      }
    )

    expect(kclManager.code).toBe(recoveredCode)
    expect(kclManager.currentSketchCheckpointId).toBe(recoveredCheckpointId)

    kclManager.undo()
    await flushPromises()

    expect(kclManager.code).toBe(baselineCode)
    expect(kclManager.currentSketchCheckpointId).toBe(preDragCheckpointId)
    expect(restoreSketchCheckpointSpy).toHaveBeenCalledWith(preDragCheckpointId)
    expect(modelingSendSpy).toHaveBeenCalledWith({
      type: 'update sketch outcome',
      data: {
        sourceDelta: { text: baselineCode },
        sceneGraphDelta: {
          new_graph: [] as unknown as SceneGraphDelta['new_graph'],
          new_objects: [],
          invalidates_ids: true,
          exec_outcome: [] as unknown as SceneGraphDelta['exec_outcome'],
        },
        writeToDisk: false,
        addToHistory: false,
        checkpointId: preDragCheckpointId,
      },
    })
  })

  it('drops stale ast-driven editor rewrites when the document changed while waiting', async () => {
    const { kclManager } = createKclManagerTestHarness('x = 1')
    const originalWasmPromise = kclManager.wasmInstancePromise
    const deferredWasm = createDeferred<Awaited<typeof originalWasmPromise>>()
    const ast = await kclManager.safeParse('x = 2')

    if (ast === null) {
      throw new Error('Expected test KCL to parse')
    }

    kclManager.wasmInstancePromise = deferredWasm.promise

    const pendingRewrite = kclManager.updateEditorWithAstAndWriteToFile(ast, {
      shouldExecute: false,
      shouldWriteToDisk: false,
    })

    kclManager.updateCodeEditor('local newer', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
      shouldAddToHistory: false,
    })

    deferredWasm.resolve(await originalWasmPromise)
    await pendingRewrite

    expect(kclManager.code).toBe('local newer')
  })

  it('allows ast-driven editor rewrites to survive intermediate programmatic updates when requested', async () => {
    const { kclManager } = createKclManagerTestHarness('x = 1')
    const originalWasmPromise = kclManager.wasmInstancePromise
    const deferredWasm = createDeferred<Awaited<typeof originalWasmPromise>>()
    const ast = await kclManager.safeParse('x = 2')

    if (ast === null) {
      throw new Error('Expected test KCL to parse')
    }

    kclManager.wasmInstancePromise = deferredWasm.promise

    const pendingRewrite = kclManager.updateEditorWithAstAndWriteToFile(ast, {
      shouldExecute: false,
      shouldWriteToDisk: false,
      allowProgrammaticDocumentChanges: true,
    })

    kclManager.updateCodeEditor('intermediate programmatic', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
      shouldAddToHistory: false,
    })

    deferredWasm.resolve(await originalWasmPromise)
    await pendingRewrite

    expect(kclManager.code.trim()).toBe('x = 2')
  })

  it('skips disk writes when the on-disk file changed since the last sync', async () => {
    vi.useFakeTimers()

    const path = '/tmp/kcl-manager-cas-write-test.kcl'
    const { kclManager } = createKclManagerTestHarness('disk base')
    const writeSpy = vi.spyOn(kclManager, 'write').mockResolvedValue(undefined)

    kclManager.path = path
    ;(kclManager as any).markFileCodeAsSynced('disk base')
    kclManager.engineCommandManager.started = true

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('external newer')

    kclManager.updateCodeEditor('local newer', {
      shouldExecute: false,
      shouldWriteToDisk: true,
      shouldResetCamera: false,
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(writeSpy).not.toHaveBeenCalled()
    expect(kclManager.code).toBe('local newer')
    expect((kclManager as any).hasUnsavedLocalChanges()).toBe(true)
  })

  it('restores the local recovery snapshot when reopening a file after unsaved edits', async () => {
    vi.useFakeTimers()

    const path = '/tmp/kcl-manager-recovery-test.kcl'
    const recoveryKey = getRecoverySnapshotKey(path)
    const { kclManager } = createKclManagerTestHarness('disk base')

    kclManager.path = path
    ;(kclManager as any).markFileCodeAsSynced('disk base')

    kclManager.updateCodeEditor('recovered newer', {
      shouldExecute: false,
      shouldWriteToDisk: false,
      shouldResetCamera: false,
      shouldAddToHistory: false,
    })

    await vi.advanceTimersByTimeAsync(300)

    const persistedSnapshot = localStorage.getItem(recoveryKey)
    expect(persistedSnapshot).not.toBeNull()
    expect(persistedSnapshot!).toContain('recovered newer')

    vi.spyOn(File.ioImplementations, 'read').mockResolvedValue('disk base')

    const reopened = await KclManager.fromFile(
      new File(path, 99),
      (kclManager as any).systemDeps
    )

    expect(reopened.code).toBe('recovered newer')
    expect((reopened as any).hasUnsavedLocalChanges()).toBe(true)
  })
})
