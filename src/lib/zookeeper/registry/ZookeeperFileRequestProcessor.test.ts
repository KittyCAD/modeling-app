import { posix } from '@chainner/node-path'
import type { KclManager } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import {
  ZookeeperFileRequestProcessor,
  type ZookeeperNewFileRequest,
} from '@src/lib/zookeeper/registry/ZookeeperFileRequestProcessor'
import type { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

const processors: ZookeeperFileRequestProcessor[] = []
const gates: ReturnType<typeof Promise.withResolvers<undefined>>[] = []
const gate = () => {
  const value = Promise.withResolvers<undefined>()
  gates.push(value)
  return value
}
afterEach(async () => {
  for (const value of gates.splice(0)) value.resolve(undefined)
  await Promise.all(
    processors.splice(0).map((processor) => processor.dispose())
  )
  vi.restoreAllMocks()
})

function setup() {
  const project = {
    name: 'demo',
    path: '/workspace/demo',
    default_file: '/workspace/demo/main.kcl',
  } as Project
  const state = { project, editorCurrent: true, sessionCurrent: true }
  const editor = {
    code: 'initial',
    path: '/workspace/demo/main.kcl',
    updateCodeEditor: vi.fn(),
    scheduleCurrentCodeExecution: vi.fn(),
    engineCommandManager: { modelingSend: vi.fn() },
    modelingState: undefined as
      | { matches: (value: string) => boolean }
      | undefined,
    zookeeperManagerMachineBulkManipulatingFileSystem: false,
  }
  const applyEdits = vi.fn(
    async (
      _root: string,
      _edits: readonly { path: string; contents: unknown }[],
      _progress?: (value: { written: number; total: number }) => void
    ) => {}
  )
  const history = {
    begin: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    cancel: vi.fn(),
    reserve: vi.fn(),
  }
  const session = {
    refreshProject: vi.fn(async () => undefined),
    openFile: vi.fn(async (_path: string) => {}),
  }
  const onApplied = vi.fn()
  const processor = new ZookeeperFileRequestProcessor({
    getProject: () => state.project,
    isEditorCurrent: () => state.editorCurrent,
    isSessionCurrent: () => state.sessionCurrent,
    kclManager: editor as unknown as KclManager,
    history: history as unknown as ZookeeperEditPatchHistory,
    projectOperations: { applyEdits },
    session,
    onEditApplied: onApplied,
  })
  processors.push(processor)
  const enqueue = (
    id: number,
    options: {
      files?: Record<string, string>
      deleted?: string[]
      activePath?: string
      patch?: boolean
    } = {}
  ) => {
    const files = options.files ?? { 'main.kcl': `edit-${id}` }
    const request: ZookeeperNewFileRequest = {
      orderedId: id,
      exchangeId: id,
      projectNameCurrentlyOpened: 'demo',
      fileFocusedOnInEditor: {
        path: options.activePath ?? '/workspace/demo/main.kcl',
        name: 'main.kcl',
        children: null,
      },
      toolOutput: {
        type: 'edit_kcl_code',
        status_code: 200,
        outputs: files,
        ...(options.patch === false
          ? {}
          : {
              zookeeper_edit_patch: {
                run_id: `run-${id}`,
                changed_files: [
                  ...Object.keys(files).map((path) => ({
                    path,
                    status: 'created' as const,
                    contents: files[path],
                  })),
                  ...(options.deleted ?? []).map((path) => ({
                    path,
                    status: 'deleted' as const,
                    previous_contents: 'previous',
                  })),
                ],
              },
            }),
      },
    }
    processor.enqueue(request, () => onApplied(request.toolOutput))
  }
  const idle = () =>
    vi.waitFor(() => expect(processor.hasPendingRequests).toBe(false))
  return {
    processor,
    state,
    editor,
    applyEdits,
    history,
    session,
    onApplied,
    enqueue,
    idle,
  }
}

describe('promise-based Zookeeper file edits', () => {
  it('ignores cloud snapshots without writing or changing the editor', async () => {
    const s = setup()
    s.state.project = { ...s.state.project, cloudProjectId: 'remote' }
    s.enqueue(1)
    await s.idle()
    expect(s.applyEdits).not.toHaveBeenCalled()
    expect(s.editor.updateCodeEditor).not.toHaveBeenCalled()
  })

  it('applies creates before deletions and protects the project entrypoint', async () => {
    const s = setup()
    s.enqueue(1, {
      files: { 'nested/new.kcl': 'new' },
      deleted: ['obsolete.kcl', 'main.kcl'],
    })
    await s.idle()
    expect(s.applyEdits).toHaveBeenCalledWith(
      '/workspace/demo',
      [
        { path: '/workspace/demo/nested/new.kcl', contents: 'new' },
        { path: '/workspace/demo/obsolete.kcl', contents: null },
      ],
      expect.any(Function)
    )
    expect(s.onApplied).toHaveBeenCalledOnce()
  })

  it('serializes writes, history completion and tree refresh before starting another edit', async () => {
    const s = setup()
    const written = gate()
    const historyDone = gate()
    const refreshed = gate()
    s.applyEdits.mockImplementationOnce(() => written.promise)
    s.history.complete.mockImplementationOnce(() => historyDone.promise)
    s.session.refreshProject.mockImplementationOnce(async () => {
      await refreshed.promise
      return undefined
    })
    s.enqueue(1)
    s.enqueue(2)
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
    expect(s.history.complete).not.toHaveBeenCalled()
    written.resolve(undefined)
    await vi.waitFor(() => expect(s.history.complete).toHaveBeenCalledOnce())
    expect(s.applyEdits).toHaveBeenCalledOnce()
    historyDone.resolve(undefined)
    await vi.waitFor(() =>
      expect(s.session.refreshProject).toHaveBeenCalledOnce()
    )
    expect(s.onApplied).not.toHaveBeenCalled()
    refreshed.resolve(undefined)
    await s.idle()
    expect(s.applyEdits).toHaveBeenCalledTimes(2)
    expect(s.onApplied).toHaveBeenCalledTimes(2)
  })

  it('orders waiting edits without interrupting the active write', async () => {
    const s = setup()
    const writing = gate()
    s.applyEdits.mockImplementationOnce(() => writing.promise)
    s.enqueue(1)
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
    s.enqueue(3)
    s.enqueue(2)
    writing.resolve(undefined)
    await s.idle()
    expect(
      s.applyEdits.mock.calls.map(([, edits]) => edits[0].contents)
    ).toEqual(['edit-1', 'edit-2', 'edit-3'])
  })

  it('counts writes across queued batches until their promises complete', async () => {
    const s = setup()
    const writing = gate()
    s.applyEdits.mockImplementationOnce(async (_root, _edits, progress) => {
      progress?.({ written: 1, total: 1 })
      await writing.promise
    })
    s.enqueue(1)
    s.enqueue(2)
    await vi.waitFor(() =>
      expect(s.processor.fileWriteProgress.value).toEqual({
        written: 1,
        total: 2,
      })
    )
    expect(s.processor.hasPendingRequests).toBe(true)
    writing.resolve(undefined)
    await s.idle()
    expect(s.processor.fileWriteProgress.value).toBeUndefined()
  })

  it.each(['write', 'history', 'refresh'] as const)(
    'rejects failed %s completion without acknowledging the edit, then accepts later work',
    async (stage) => {
      const s = setup()
      const fail = new Error('Failure')
      if (stage === 'write') s.applyEdits.mockRejectedValueOnce(fail)
      if (stage === 'history') s.history.complete.mockRejectedValueOnce(fail)
      if (stage === 'refresh')
        s.session.refreshProject.mockRejectedValueOnce(fail)
      s.enqueue(1)
      s.enqueue(2)
      await s.idle()
      expect(s.onApplied).toHaveBeenCalledOnce()
      expect(s.history.cancel).toHaveBeenCalledWith({ exchangeId: 1 })
      expect(s.editor.zookeeperManagerMachineBulkManipulatingFileSystem).toBe(
        false
      )
    }
  )

  it('drops a reset edit that has not started writing', async () => {
    const s = setup()
    const preparing = gate()
    s.history.begin.mockImplementationOnce(() => preparing.promise)
    s.enqueue(1)
    await vi.waitFor(() => expect(s.history.begin).toHaveBeenCalledOnce())
    const reset = s.processor.reset()
    preparing.resolve(undefined)
    await reset
    expect(s.applyEdits).not.toHaveBeenCalled()
    expect(s.onApplied).not.toHaveBeenCalled()
  })

  it.each(['reset', 'dispose'] as const)(
    'drains an already-started write and its history on %s without updating a stale UI',
    async (action) => {
      const s = setup()
      const writing = gate()
      s.applyEdits.mockImplementationOnce(() => writing.promise)
      s.enqueue(1)
      await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
      const stopped = vi.fn()
      const disposal = s.processor[action]().then(stopped)
      await Promise.resolve()
      expect(stopped).not.toHaveBeenCalled()
      writing.resolve(undefined)
      await disposal
      expect(s.history.complete).toHaveBeenCalledOnce()
      expect(s.session.refreshProject).not.toHaveBeenCalled()
      expect(s.editor.updateCodeEditor).not.toHaveBeenCalled()
      expect(s.onApplied).not.toHaveBeenCalled()
    }
  )

  it('reset waits for previous work without waiting for newly queued edits', async () => {
    const s = setup()
    const old = gate()
    const next = gate()
    s.applyEdits
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => next.promise)
    s.enqueue(1)
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
    const reset = s.processor.reset()
    s.enqueue(2)
    old.resolve(undefined)
    await reset
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledTimes(2))
    expect(s.processor.hasPendingRequests).toBe(true)
    next.resolve(undefined)
    await s.idle()
    expect(s.onApplied).toHaveBeenCalledOnce()
  })

  it.each(['project', 'editor'] as const)(
    'never finishes a dispatched write against a replaced %s',
    async (changed) => {
      const s = setup()
      const writing = gate()
      s.applyEdits.mockImplementationOnce(() => writing.promise)
      s.enqueue(1)
      await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
      if (changed === 'project')
        s.state.project = { ...s.state.project, path: '/workspace/other' }
      else s.state.editorCurrent = false
      writing.resolve(undefined)
      await s.idle()
      expect(s.history.complete).not.toHaveBeenCalled()
      expect(s.session.openFile).not.toHaveBeenCalled()
      expect(s.editor.updateCodeEditor).not.toHaveBeenCalled()
      expect(s.applyEdits.mock.calls[0][0]).toBe('/workspace/demo')
    }
  )

  it('ignores stale progress after resetting the conversation', async () => {
    const s = setup()
    const old = gate()
    const next = gate()
    let progress:
      | ((value: { written: number; total: number }) => void)
      | undefined
    s.applyEdits
      .mockImplementationOnce(async (_root, _edits, callback) => {
        progress = callback
        await old.promise
      })
      .mockImplementationOnce(() => next.promise)
    s.enqueue(1)
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
    const reset = s.processor.reset()
    s.enqueue(2)
    old.resolve(undefined)
    await reset
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledTimes(2))
    progress?.({ written: 1, total: 1 })
    expect(s.processor.fileWriteProgress.value).toEqual({
      written: 0,
      total: 1,
    })
    next.resolve(undefined)
    await s.idle()
  })

  it('opens the default file after deleting the active file and awaits navigation', async () => {
    const s = setup()
    const opened = gate()
    s.editor.path = '/workspace/demo/part.kcl'
    s.session.openFile.mockImplementationOnce(() => opened.promise)
    s.enqueue(1, {
      files: {},
      deleted: ['part.kcl'],
      activePath: '/workspace/demo/part.kcl',
    })
    await vi.waitFor(() =>
      expect(s.session.openFile).toHaveBeenCalledWith(
        '/workspace/demo/main.kcl',
        { projectPath: '/workspace/demo' }
      )
    )
    expect(s.onApplied).not.toHaveBeenCalled()
    opened.resolve(undefined)
    await s.idle()
    expect(s.onApplied).toHaveBeenCalledOnce()
  })

  it('does not overwrite an editor that changed files while a write was pending', async () => {
    const s = setup()
    const writing = gate()
    s.applyEdits.mockImplementationOnce(() => writing.promise)
    s.enqueue(1)
    await vi.waitFor(() => expect(s.applyEdits).toHaveBeenCalledOnce())
    s.editor.path = '/workspace/demo/other.kcl'
    writing.resolve(undefined)
    await s.idle()
    expect(s.editor.updateCodeEditor).not.toHaveBeenCalled()
    expect(s.session.openFile).not.toHaveBeenCalled()
  })

  it('requires an explicit patch and permits the next authorized edit', async () => {
    const s = setup()
    s.enqueue(1, { patch: false })
    s.enqueue(2)
    await s.idle()
    expect(s.applyEdits).toHaveBeenCalledOnce()
    expect(s.applyEdits.mock.calls[0][1][0].contents).toBe('edit-2')
  })

  it.each(['Sketch', 'sketchSolveMode', 'idle'])(
    'reloads the model explicitly after completing edits in %s',
    async (mode) => {
      const s = setup()
      s.editor.modelingState = { matches: (value) => value === mode }
      s.enqueue(1)
      await s.idle()
      if (mode === 'sketchSolveMode')
        expect(s.editor.engineCommandManager.modelingSend).toHaveBeenCalledWith(
          { type: 'Exit sketch' }
        )
      else
        expect(s.editor.scheduleCurrentCodeExecution).toHaveBeenCalledWith(
          mode !== 'Sketch'
        )
    }
  )
})
