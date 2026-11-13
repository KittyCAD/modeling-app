import { signal } from '@preact/signals-core'
import { retryProjectSave } from '@src/lib/projectSession/retrySave'
import type { ProjectStorage } from '@src/lib/projectSession/storage'
import { afterEach, expect, test, vi } from 'vitest'

function setup(cloud = true) {
  const saveState = signal<{ state: 'saved' | 'saving' | 'failed' }>({
    state: 'failed',
  })
  const editor = {
    path: '/project/main.kcl',
    code: 'saved contents',
    flushWriteToFile: vi.fn(async () => true),
    textFileIO: { read: vi.fn(async () => 'saved contents') },
    synchronizeCurrentEditorAfterDirectGlobalReplay: vi.fn(() => true),
  }
  const project = {
    path: '/project',
    executingEditor: signal<typeof editor | null>(editor),
  }
  let current: typeof project | undefined = project
  const storage: Pick<ProjectStorage, 'saveState' | 'retry'> = {
    saveState: cloud ? saveState : undefined,
    retry: vi.fn(async () => {
      saveState.value = { state: 'saved' }
    }),
  }
  return {
    editor,
    project,
    storage,
    saveState,
    dependencies: { getProject: () => current, storageFor: () => storage },
    switchProject: () => {
      current = { ...project }
    },
    close: () => {
      current = undefined
    },
  }
}

afterEach(() => vi.useRealTimers())

test('retries a local editor write without treating it as a storage snapshot', async () => {
  const session = setup(false)
  await expect(retryProjectSave(session.dependencies)).resolves.toBeUndefined()
  expect(session.editor.flushWriteToFile).toHaveBeenCalledOnce()
  expect(session.storage.retry).not.toHaveBeenCalled()
  expect(session.editor.textFileIO.read).not.toHaveBeenCalled()
})

test('reports a local retry that still leaves unsaved changes', async () => {
  const session = setup(false)
  session.editor.flushWriteToFile.mockResolvedValue(false)
  await expect(retryProjectSave(session.dependencies)).resolves.toBeInstanceOf(
    Error
  )
})

test('marks the cloud editor synchronized only after confirming its saved contents', async () => {
  const session = setup()
  await expect(retryProjectSave(session.dependencies)).resolves.toBeUndefined()
  expect(
    session.editor.synchronizeCurrentEditorAfterDirectGlobalReplay
  ).toHaveBeenCalledWith({
    filePath: '/project/main.kcl',
    nextContent: 'saved contents',
    shouldSyncRust: false,
  })
})

test('keeps a new edit made while cloud retry is pending', async () => {
  vi.useFakeTimers()
  const session = setup()
  const pending = Promise.withResolvers<undefined>()
  session.storage.retry = () => pending.promise
  const retry = retryProjectSave(session.dependencies)
  await vi.advanceTimersByTimeAsync(7_000)
  session.editor.code = 'a newer edit'
  session.saveState.value = { state: 'saved' }
  pending.resolve(undefined)
  await retry
  expect(session.editor.code).toBe('a newer edit')
  expect(
    session.editor.synchronizeCurrentEditorAfterDirectGlobalReplay
  ).not.toHaveBeenCalled()
})

test('does not mark contents saved when cloud retry is still unsuccessful', async () => {
  const session = setup()
  session.storage.retry = async () => {}
  await retryProjectSave(session.dependencies)
  expect(
    session.editor.synchronizeCurrentEditorAfterDirectGlobalReplay
  ).not.toHaveBeenCalled()
})

test.each(['retry', 'read'] as const)(
  'ignores a slow cloud %s after switching project, file, or closing',
  async (phase) => {
    vi.useFakeTimers()
    for (const change of ['project', 'editor', 'path', 'close'] as const) {
      const session = setup()
      const pending = Promise.withResolvers<undefined>()
      if (phase === 'retry') session.storage.retry = () => pending.promise
      else
        session.editor.textFileIO.read.mockImplementation(async () => {
          await pending.promise
          return 'saved contents'
        })
      const retry = retryProjectSave(session.dependencies)
      await vi.advanceTimersByTimeAsync(7_000)
      if (change === 'project') session.switchProject()
      else if (change === 'editor')
        session.project.executingEditor.value = { ...session.editor }
      else if (change === 'path') session.editor.path = '/project/other.kcl'
      else session.close()
      session.saveState.value = { state: 'saved' }
      pending.resolve(undefined)
      await retry
      expect(
        session.editor.synchronizeCurrentEditorAfterDirectGlobalReplay
      ).not.toHaveBeenCalled()
      if (phase === 'retry')
        expect(session.editor.textFileIO.read).not.toHaveBeenCalled()
    }
  }
)

test.each(['retry', 'read'] as const)(
  'returns a cloud %s failure to the caller',
  async (phase) => {
    const session = setup()
    const failure = new Error('Connection lost')
    if (phase === 'retry') session.storage.retry = () => Promise.reject(failure)
    else session.editor.textFileIO.read.mockRejectedValue(failure)
    await expect(retryProjectSave(session.dependencies)).resolves.toBe(failure)
    expect(
      session.editor.synchronizeCurrentEditorAfterDirectGlobalReplay
    ).not.toHaveBeenCalled()
  }
)

test('does nothing when no project is open', async () => {
  const session = setup()
  session.close()
  await retryProjectSave(session.dependencies)
  expect(session.storage.retry).not.toHaveBeenCalled()
  expect(session.editor.flushWriteToFile).not.toHaveBeenCalled()
})
