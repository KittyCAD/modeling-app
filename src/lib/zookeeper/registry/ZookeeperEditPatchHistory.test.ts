import type { KclManager } from '@src/lang/KclManager'
import { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import type {
  ZookeeperEditPatch,
  ZookeeperEditPatchFile,
} from '@src/lib/zookeeper/zookeeperEditPatch'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import { createTwoFilesPatch } from 'diff'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(async () => 'updated contents'),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (root: string, ...parts: string[]) =>
      parts.reduce((path, part) => `${path}/${part}`, root),
    readFile: mocks.readFile,
    relative: (from: string, to: string) =>
      to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  },
}))

vi.mock('@src/lib/zookeeper/editorPlugin', () => ({
  zookeeperEditPatchHistoryEvent: vi.fn((value) => value),
}))

const projectPath = '/workspace/demo'
const activeFilePath = `${projectPath}/main.kcl`
const patch: ZookeeperEditPatch = {
  run_id: 'run-1',
  changed_files: [
    {
      path: 'main.kcl',
      status: 'created',
      contents: 'updated contents',
    },
  ],
}

function modifiedFile(
  path: string,
  previousContent: string,
  nextContent: string
): ZookeeperEditPatchFile {
  return {
    path,
    status: 'modified',
    diff: createTwoFilesPatch(
      `a/${path}`,
      `b/${path}`,
      previousContent,
      nextContent
    ),
  }
}

function createKclManager() {
  const state = {
    addGlobalHistoryEvent: vi.fn(),
    addGlobalHistoryEventWithCodeChange: vi.fn(),
    captureEditorHistoryState: vi.fn(() => undefined),
    code: 'editor contents',
    path: `${projectPath}/other.kcl`,
    restoreEditorHistoryState: vi.fn(),
    zookeeperHistoryRecordingInProgress: false,
  }

  return {
    manager: state as unknown as KclManager,
    state,
  }
}

function endOfStreamSnapshot(
  lastMessageId: number,
  exchangeCount = 1
): ReturnType<ZookeeperManagerActor['getSnapshot']> {
  return {
    context: {
      conversation: {
        exchanges: Array.from({ length: exchangeCount }, () => ({})),
      },
      lastMessageId,
      lastMessageType: 'end_of_stream',
    },
  } as unknown as ReturnType<ZookeeperManagerActor['getSnapshot']>
}

function replayedEndOfStreamSnapshot(): ReturnType<
  ZookeeperManagerActor['getSnapshot']
> {
  return {
    context: {
      conversation: {
        exchanges: [{ responses: [{ end_of_stream: {} }] }],
      },
      lastMessageId: undefined,
      lastMessageType: undefined,
    },
  } as unknown as ReturnType<ZookeeperManagerActor['getSnapshot']>
}

function separateErrorSnapshot(
  lastMessageId?: number
): ReturnType<ZookeeperManagerActor['getSnapshot']> {
  return {
    context: {
      conversation: {
        exchanges: [
          { responses: [{ tool_output: {} }] },
          { responses: [{ error: {} }] },
        ],
      },
      lastMessageId,
      lastMessageType: undefined,
    },
  } as unknown as ReturnType<ZookeeperManagerActor['getSnapshot']>
}

async function completeWrite(
  history: ZookeeperEditPatchHistory,
  editPatch = patch,
  exchangeId = 0
) {
  await history.complete({
    activeFileDeleted: false,
    activeFilePath,
    exchangeId,
    patch: editPatch,
    projectPath,
    requestIsCurrent: () => true,
  })
}

describe('ZookeeperEditPatchHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flushes a completed write only after the exchange ends', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)

    expect(state.zookeeperHistoryRecordingInProgress).toBe(true)
    expect(state.addGlobalHistoryEvent).not.toHaveBeenCalled()

    history.handleActorSnapshot(endOfStreamSnapshot(1))

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('flushes a completed write when a live error ends the conversation', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.handleActorSnapshot(separateErrorSnapshot(2))

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('recognizes a terminal response restored from conversation history', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.handleActorSnapshot(replayedEndOfStreamSnapshot())

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('recognizes a separate error exchange restored from history', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.handleActorSnapshot(separateErrorSnapshot())

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('waits for a pending write after a terminal error', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    history.handleActorSnapshot(separateErrorSnapshot(2))

    expect(state.addGlobalHistoryEvent).not.toHaveBeenCalled()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(true)

    await completeWrite(history)

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('clears an unused reservation when the write is cancelled', () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    expect(state.zookeeperHistoryRecordingInProgress).toBe(true)

    history.cancel({ exchangeId: 0 })

    expect(state.addGlobalHistoryEvent).not.toHaveBeenCalled()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('preserves completed snapshots when a later write is cancelled', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)
    const laterPatch: ZookeeperEditPatch = {
      run_id: patch.run_id,
      changed_files: [
        {
          path: 'later.kcl',
          status: 'created',
          contents: 'later contents',
        },
      ],
    }

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await history.begin({
      activeFilePath,
      exchangeId: 0,
      patch: laterPatch,
      projectPath,
      reserved: true,
    })
    history.cancel({ exchangeId: 0 })
    history.handleActorSnapshot(endOfStreamSnapshot(1))

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotFiles: [expect.objectContaining({ relativePath: 'main.kcl' })],
      })
    )
  })

  it('falls back to the patch when a previous-content snapshot fails', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)
    const previousCode = 'before = 1\n'
    const requestedCode = 'after = 2\n'
    const editPatch: ZookeeperEditPatch = {
      run_id: patch.run_id,
      changed_files: [
        modifiedFile('main.kcl', previousCode, requestedCode),
        modifiedFile('side.kcl', 'side = 1\n', 'side = 2\n'),
      ],
    }
    const readError = new Error('snapshot read failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.path = activeFilePath
    state.code = previousCode
    mocks.readFile.mockRejectedValueOnce(readError)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await history.begin({
      activeFilePath,
      exchangeId: 0,
      patch: editPatch,
      projectPath,
      reserved: true,
    })
    state.code = requestedCode
    await history.complete({
      activeFileDeleted: false,
      activeFilePath,
      activeFileRequestedCode: requestedCode,
      exchangeId: 0,
      patch: editPatch,
      projectPath,
      requestIsCurrent: () => true,
    })
    history.handleActorSnapshot(endOfStreamSnapshot(1))

    expect(mocks.readFile).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to capture Zookeeper history snapshots.',
      readError
    )
    expect(state.addGlobalHistoryEventWithCodeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: editPatch,
        snapshotFiles: [],
      }),
      requestedCode,
      previousCode
    )
    consoleError.mockRestore()
  })

  it('falls back to the full patch instead of replaying partial snapshots', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)
    const firstPatch: ZookeeperEditPatch = {
      run_id: patch.run_id,
      changed_files: [modifiedFile('first.kcl', 'first = 1\n', 'first = 2\n')],
    }
    const secondPatch: ZookeeperEditPatch = {
      run_id: patch.run_id,
      changed_files: [
        modifiedFile('second.kcl', 'second = 1\n', 'second = 2\n'),
      ],
    }
    const readError = new Error('next snapshot read failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.readFile
      .mockResolvedValueOnce('first = 1\n')
      .mockResolvedValueOnce('first = 2\n')
      .mockResolvedValueOnce('second = 1\n')
      .mockRejectedValueOnce(readError)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await history.begin({
      activeFilePath,
      exchangeId: 0,
      patch: firstPatch,
      projectPath,
      reserved: true,
    })
    await completeWrite(history, firstPatch)
    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await history.begin({
      activeFilePath,
      exchangeId: 0,
      patch: secondPatch,
      projectPath,
      reserved: true,
    })
    await completeWrite(history, secondPatch)
    history.handleActorSnapshot(endOfStreamSnapshot(1))

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to capture Zookeeper history snapshots.',
      readError
    )
    expect(state.addGlobalHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          changed_files: expect.arrayContaining([
            expect.objectContaining({ path: 'first.kcl' }),
            expect.objectContaining({ path: 'second.kcl' }),
          ]),
        }),
        snapshotFiles: [],
      })
    )
    consoleError.mockRestore()
  })

  it('releases a reservation when the request becomes stale', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await history.complete({
      activeFileDeleted: false,
      activeFilePath,
      exchangeId: 0,
      patch,
      projectPath,
      requestIsCurrent: () => false,
    })

    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(state.addGlobalHistoryEvent).not.toHaveBeenCalled()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('does not carry interrupted history into a fresh conversation', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.reset()
    await completeWrite(history)

    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)

    const nextPatch: ZookeeperEditPatch = {
      ...patch,
      run_id: 'run-2',
    }
    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history, nextPatch)
    history.handleActorSnapshot(endOfStreamSnapshot(2))

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledOnce()
    expect(state.addGlobalHistoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ run_id: 'run-2' }),
      })
    )
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('clears the recording flag when recording the history event throws', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)
    const error = new Error('history failed')
    state.addGlobalHistoryEvent.mockImplementationOnce(() => {
      throw error
    })

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)

    expect(() => history.handleActorSnapshot(endOfStreamSnapshot(1))).toThrow(
      error
    )
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  it('finishes every pending exchange when one history event throws', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)
    const error = new Error('first history failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.addGlobalHistoryEvent.mockImplementationOnce(() => {
      throw error
    })

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    await completeWrite(history)
    history.reserve({ activeFilePath, exchangeId: 1, projectPath })
    await completeWrite(history, { ...patch, run_id: 'run-2' }, 1)

    history.finishPending()

    expect(state.addGlobalHistoryEvent).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to finish Zookeeper history.',
      error
    )
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
    consoleError.mockRestore()
  })

  it('drops pending and late work when disposed', async () => {
    const { manager, state } = createKclManager()
    const history = new ZookeeperEditPatchHistory(manager)

    history.reserve({ activeFilePath, exchangeId: 0, projectPath })
    history.dispose()
    history.dispose()
    await completeWrite(history)
    history.handleActorSnapshot(endOfStreamSnapshot(1))

    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(state.addGlobalHistoryEvent).not.toHaveBeenCalled()
    expect(state.zookeeperHistoryRecordingInProgress).toBe(false)
  })
})
