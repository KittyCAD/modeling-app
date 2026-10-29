import type { MlCopilotServerMessage, MlToolResult } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import type { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import { ZookeeperFileRequestProcessor } from '@src/lib/zookeeper/registry/ZookeeperFileRequestProcessor'
import {
  type ZookeeperManagerActor,
  type ZookeeperManagerContext,
  type ZookeeperManagerEvents,
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
  zookeeperManagerMachine,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import type * as SystemIOUtils from '@src/lib/fileSystem/workflows/utils'
import {
  type FileWorkflowService,
  waitForIdleState,
} from '@src/lib/fileSystem/workflows/utils'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createActor, fromPromise, waitFor as waitForActor } from 'xstate'

const mocks = vi.hoisted(() => ({
  historyBegin: vi.fn(async () => undefined),
  historyCancel: vi.fn(),
  historyComplete: vi.fn<ZookeeperEditPatchHistory['complete']>(
    async () => undefined
  ),
  historyReserve: vi.fn(),
  modelingSend: vi.fn(),
  systemIOSend: vi.fn(),
  updateCodeEditor: vi.fn(),
  onEditApplied: vi.fn(),
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    relative: (from: string, to: string) =>
      to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
    sep: '/',
  },
}))

vi.mock('@src/lib/fileSystem/workflows/utils', async (importOriginal) => {
  const original = await importOriginal<typeof SystemIOUtils>()

  return {
    ...original,
    waitForIdleState: vi.fn(async () => undefined),
  }
})

const project = {
  name: 'demo',
  path: '/workspace/demo',
} as Project

const kclManagerState = {
  code: 'initial code',
  engineCommandManager: { modelingSend: mocks.modelingSend },
  path: '/workspace/demo/main.kcl',
  updateCodeEditor: mocks.updateCodeEditor,
  zookeeperHistoryRecordingInProgress: false,
  zookeeperManagerMachineBulkManipulatingFileSystem: false,
}
const kclManager = kclManagerState as unknown as KclManager

const history = {
  begin: mocks.historyBegin,
  cancel: mocks.historyCancel,
  complete: mocks.historyComplete,
  reserve: mocks.historyReserve,
} as unknown as ZookeeperEditPatchHistory

const fileWorkflows = {
  bulkCreateAndDeleteKCLFilesAndNavigateToFile: async (data: unknown) =>
    mocks.systemIOSend({ data }),
} as unknown as FileWorkflowService

function patchBackedZookeeperEdit(
  code: string
): Extract<MlToolResult, { type: 'edit_kcl_code' }> {
  return {
    type: 'edit_kcl_code',
    status_code: 201,
    project_name: 'demo',
    outputs: {
      'main.kcl': code,
    },
    zookeeper_edit_patch: {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'main.kcl',
          status: 'created',
          contents: code,
        },
      ],
    },
  }
}

function zookeeperEditWithoutPatch(code: string): MlToolResult {
  return {
    type: 'edit_kcl_code',
    status_code: 201,
    project_name: 'demo',
    outputs: {
      'main.kcl': code,
    },
  }
}

function emitZookeeperFileRequest(
  processor: ZookeeperFileRequestProcessor,
  code: string,
  messageId: number,
  toolOutput: MlToolResult = patchBackedZookeeperEdit(code),
  fileFocusedOnInEditor = {
    name: 'main.kcl',
    path: '/workspace/demo/main.kcl',
  },
  precedingResponses: MlCopilotServerMessage[] = []
) {
  processor.handleActorSnapshot({
    context: {
      conversation: {
        exchanges: [
          {
            responses: [
              ...precedingResponses,
              {
                tool_output: {
                  result: toolOutput,
                },
              },
            ],
          },
        ],
      },
      fileFocusedOnInEditor: {
        ...fileFocusedOnInEditor,
        children: null,
      },
      lastMessageId: messageId,
      lastMessageType: 'tool_output',
      projectNameCurrentlyOpened: 'demo',
    },
  } as unknown as ReturnType<ZookeeperManagerActor['getSnapshot']>)
}

function createProcessor(
  isSessionCurrent = () => true,
  isEditorCurrent = () => true
) {
  return new ZookeeperFileRequestProcessor({
    getProject: () => project,
    history,
    isEditorCurrent,
    isSessionCurrent,
    kclManager,
    fileWorkflows,
    onEditApplied: mocks.onEditApplied,
  })
}

describe('ZookeeperFileRequestProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kclManagerState.code = 'initial code'
    kclManagerState.path = '/workspace/demo/main.kcl'
    kclManagerState.zookeeperHistoryRecordingInProgress = false
    kclManagerState.zookeeperManagerMachineBulkManipulatingFileSystem = false
  })

  test('deletes files from the current patch and preserves files recreated by the next edit', async () => {
    const processor = createProcessor()
    const deletion = patchBackedZookeeperEdit('intermediate code')
    deletion.zookeeper_edit_patch?.changed_files?.push({
      path: 'part.kcl',
      status: 'deleted',
      previous_contents: 'old part',
    })
    emitZookeeperFileRequest(processor, 'intermediate code', 1, deletion)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    expect(firstRequest.filesToDelete).toEqual([
      { requestedFileName: 'part.kcl' },
    ])
    firstRequest.onFileSystemSuccess()
    firstRequest.onSuccess()

    const recreation = patchBackedZookeeperEdit('final code')
    recreation.outputs = { ...recreation.outputs, 'part.kcl': 'new part' }
    recreation.zookeeper_edit_patch?.changed_files?.push({
      path: 'part.kcl',
      status: 'created',
      contents: 'new part',
    })
    emitZookeeperFileRequest(
      processor,
      'final code',
      2,
      recreation,
      undefined,
      [{ tool_output: { result: deletion } }]
    )
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    const secondRequest = mocks.systemIOSend.mock.calls[1][0].data
    expect(secondRequest.filesToDelete).toEqual([])
    expect(secondRequest.files).toContainEqual({
      requestedProjectName: 'demo',
      requestedFileName: 'part.kcl',
      requestedCode: 'new part',
    })
    secondRequest.onFileSystemSuccess()
    secondRequest.onSuccess()
    await processor.dispose()
  })

  test('counts completed writes across queued batches and stays busy until editor refresh finishes', async () => {
    const processor = createProcessor()
    const firstOutput = patchBackedZookeeperEdit('first edit')
    firstOutput.outputs = { 'main.kcl': 'first edit', 'part.kcl': 'part = 1' }
    firstOutput.zookeeper_edit_patch?.changed_files?.push({
      path: 'part.kcl',
      status: 'created',
      contents: 'part = 1',
    })
    emitZookeeperFileRequest(processor, 'first edit', 1, firstOutput)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const first = mocks.systemIOSend.mock.calls[0][0].data
    expect(processor.hasPendingRequests).toBe(true)
    expect(processor.fileWriteProgress.value).toEqual({ written: 0, total: 2 })
    first.onFileWriteProgress({ written: 1, total: 2 })
    expect(processor.fileWriteProgress.value).toEqual({ written: 1, total: 2 })

    emitZookeeperFileRequest(processor, 'second edit', 2)
    expect(processor.fileWriteProgress.value).toEqual({ written: 1, total: 3 })
    first.onFileWriteProgress({ written: 2, total: 2 })
    first.onFileSystemSuccess()
    await Promise.resolve()
    expect(processor.hasPendingRequests).toBe(true)
    expect(processor.fileWriteProgress.value).toEqual({ written: 2, total: 3 })
    expect(mocks.systemIOSend).toHaveBeenCalledOnce()
    first.onSuccess()
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    const second = mocks.systemIOSend.mock.calls[1][0].data
    second.onFileWriteProgress({ written: 1, total: 1 })
    second.onFileSystemSuccess()
    expect(processor.fileWriteProgress.value).toEqual({ written: 3, total: 3 })
    second.onSuccess()
    await waitFor(() => expect(processor.hasPendingRequests).toBe(false))
    expect(processor.fileWriteProgress.value).toBeUndefined()
    await processor.dispose()
  })

  test('clears progress after a failed write without counting it as written', async () => {
    const processor = createProcessor()
    emitZookeeperFileRequest(processor, 'first edit', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    request.onFileSystemError()
    await waitFor(() => expect(processor.hasPendingRequests).toBe(false))
    expect(processor.fileWriteProgress.value).toBeUndefined()
    expect(mocks.onEditApplied).not.toHaveBeenCalled()
    await processor.dispose()
  })

  test('ignores old progress callbacks after resetting for a new conversation', async () => {
    const processor = createProcessor()
    emitZookeeperFileRequest(processor, 'old edit', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    const reset = processor.reset()
    expect(processor.fileWriteProgress.value).toBeUndefined()
    request.onFileWriteProgress({ written: 1, total: 1 })
    expect(processor.fileWriteProgress.value).toBeUndefined()
    request.onFileSystemSuccess()
    await reset
    await processor.dispose()
  })

  test('waits for the previous editor refresh before dispatching the next edit', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'intermediate code', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    expect(firstRequest.orderedId).toBe(1)
    firstRequest.onFileSystemSuccess()
    await Promise.resolve()

    emitZookeeperFileRequest(processor, 'intermediate code', 1)
    emitZookeeperFileRequest(processor, 'final code', 2)
    await Promise.resolve()

    expect(mocks.systemIOSend).toHaveBeenCalledOnce()

    firstRequest.onSuccess()

    expect(mocks.updateCodeEditor).toHaveBeenCalledWith('intermediate code', {
      shouldAddToHistory: false,
      shouldClearHistory: false,
      shouldExecute: false,
      shouldResetCamera: true,
      shouldWriteToDisk: false,
    })

    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    expect(mocks.systemIOSend.mock.calls[1][0].data.orderedId).toBe(2)
    expect(mocks.systemIOSend.mock.calls[1][0].data.files[0]).toMatchObject({
      requestedCode: 'final code',
      requestedFileName: 'main.kcl',
    })
    firstRequest.onFileSystemSuccess()
    firstRequest.onFileSystemError()
    firstRequest.onSuccess()
    expect(mocks.historyComplete).toHaveBeenCalledOnce()
    expect(mocks.updateCodeEditor).toHaveBeenCalledOnce()
  })

  test('reorders waiting edits by orderedId without interrupting the active edit', async () => {
    const processor = createProcessor()
    try {
      emitZookeeperFileRequest(processor, 'first edit', 1)
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
      const firstRequest = mocks.systemIOSend.mock.calls[0][0].data

      for (const orderedId of [3, 2]) {
        processor.enqueue(
          {
            orderedId,
            toolOutput: patchBackedZookeeperEdit(`edit ${orderedId}`),
            projectNameCurrentlyOpened: 'demo',
            fileFocusedOnInEditor: {
              name: 'main.kcl',
              path: '/workspace/demo/main.kcl',
              children: null,
            },
            exchangeId: 0,
          },
          mocks.onEditApplied
        )
      }
      await Promise.resolve()
      expect(mocks.systemIOSend).toHaveBeenCalledOnce()

      firstRequest.onFileSystemSuccess()
      firstRequest.onSuccess()
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
      const secondRequest = mocks.systemIOSend.mock.calls[1][0].data
      // notice how it got re-ordered
      expect(secondRequest.orderedId).toBe(2)
      expect(secondRequest.files[0].requestedCode).toBe('edit 2')
      expect(mocks.historyCancel).not.toHaveBeenCalled()

      secondRequest.onFileSystemSuccess()
      secondRequest.onSuccess()
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(3))
      const thirdRequest = mocks.systemIOSend.mock.calls[2][0].data
      expect(thirdRequest.orderedId).toBe(3)
      expect(thirdRequest.files[0].requestedCode).toBe('edit 3')
      thirdRequest.onFileSystemSuccess()
      thirdRequest.onSuccess()
      await waitFor(() => expect(mocks.onEditApplied).toHaveBeenCalledTimes(3))
    } finally {
      for (const [event] of mocks.systemIOSend.mock.calls) {
        event.data.onFileSystemError()
      }
      await processor.dispose()
    }
  })

  test('retains queued live edits through EOS until files and history finish, then releases only the applied edit', async () => {
    const machine = zookeeperManagerMachine.provide({
      actors: {
        [ZookeeperManagerStates.Setup]: fromPromise<
          Partial<ZookeeperManagerContext>,
          {
            context: ZookeeperManagerContext
            event: Extract<
              ZookeeperManagerEvents,
              { type: ZookeeperManagerStates.Setup }
            >
          }
        >(async () => ({
          conversation: {
            exchanges: [{ responses: [], deltasAggregated: '' }],
          },
          conversationId: 'conversation-id',
          projectNameCurrentlyOpened: 'demo',
        })),
        [ZookeeperManagerStates.ContinueCheck]: fromPromise(async () => ({})),
      },
    })
    const actor = createActor(machine, { input: { apiToken: 'token' } }).start()
    const processor = new ZookeeperFileRequestProcessor({
      getProject: () => project,
      history,
      isSessionCurrent: () => true,
      isEditorCurrent: () => true,
      kclManager,
      fileWorkflows,
      onEditApplied: (response) =>
        actor.send({ type: ZookeeperManagerTransitions.EditApplied, response }),
    })
    const subscription = actor.subscribe((snapshot) =>
      processor.handleActorSnapshot(snapshot)
    )
    try {
      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: (event) => actor.send(event),
      })
      await waitForActor(actor, (snapshot) =>
        snapshot.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )
      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'demo',
        projectFiles: [],
      })
      await waitForActor(actor, (snapshot) =>
        snapshot.matches(ZookeeperManagerStates.Ready)
      )

      const first: MlCopilotServerMessage = {
        tool_output: { result: patchBackedZookeeperEdit('first contents') },
      }
      const second: MlCopilotServerMessage = {
        tool_output: { result: patchBackedZookeeperEdit('second contents') },
      }
      const final: MlCopilotServerMessage = {
        end_of_stream: { whole_response: 'Finished' },
      }
      for (const response of [first, second, final]) {
        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response,
        })
      }
      const responses = () =>
        actor.getSnapshot().context.conversation?.exchanges[0].responses
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
      expect(responses()).toEqual([first, second, final])

      let finishHistory: () => void = () => undefined
      mocks.historyComplete.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            finishHistory = () => resolve(undefined)
          })
      )
      const firstWrite = mocks.systemIOSend.mock.calls[0][0].data
      firstWrite.onFileSystemSuccess()
      firstWrite.onSuccess()
      expect(responses()).toContain(first)
      finishHistory()
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
      expect(responses()).toEqual([second, final])
      expect(mocks.historyComplete.mock.calls[0][0].patch).toEqual(
        patchBackedZookeeperEdit('first contents').zookeeper_edit_patch
      )

      const secondWrite = mocks.systemIOSend.mock.calls[1][0].data
      expect(secondWrite.files[0].requestedCode).toBe('second contents')
      secondWrite.onFileSystemSuccess()
      secondWrite.onSuccess()
      await waitFor(() => expect(responses()).toEqual([final]))
      expect(mocks.historyComplete).toHaveBeenCalledTimes(2)
      expect(mocks.systemIOSend).toHaveBeenCalledTimes(2)
    } finally {
      subscription.unsubscribe()
      actor.stop()
      await processor.dispose()
    }
  })

  test.each(['filesystem', 'history'])(
    'does not acknowledge a failed %s write',
    async (failure) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const processor = createProcessor()
      try {
        emitZookeeperFileRequest(processor, 'keep failed payload', 1)
        await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
        const request = mocks.systemIOSend.mock.calls[0][0].data
        if (failure === 'filesystem') {
          request.onFileSystemError()
        } else {
          mocks.historyComplete.mockRejectedValueOnce(
            new Error('History failed')
          )
          request.onFileSystemSuccess()
          request.onSuccess()
          await waitFor(() => expect(log).toHaveBeenCalled())
        }
        // A second request proves the first has settled without suppressing a
        // legitimate acknowledgement through reset/disposal.
        emitZookeeperFileRequest(processor, 'next edit', 2)
        await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
        expect(mocks.onEditApplied).not.toHaveBeenCalled()
        mocks.systemIOSend.mock.calls[1][0].data.onFileSystemError()
      } finally {
        await processor.dispose()
        log.mockRestore()
      }
    }
  )

  test('waits for history when navigation fails after a successful write', async () => {
    let finishHistory: () => void = () => undefined
    mocks.historyComplete.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishHistory = () => resolve(undefined)
        })
    )
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'intermediate code', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    firstRequest.onFileSystemSuccess()
    firstRequest.onFileSystemError()

    emitZookeeperFileRequest(processor, 'final code', 2)
    await Promise.resolve()

    expect(mocks.historyCancel).not.toHaveBeenCalled()
    expect(mocks.systemIOSend).toHaveBeenCalledOnce()

    finishHistory()
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
  })

  test('does not block the next edit when active-file navigation never completes', async () => {
    const processor = createProcessor()
    const deletedFilePath = '/workspace/demo/part.kcl'
    kclManagerState.path = deletedFilePath

    emitZookeeperFileRequest(
      processor,
      'fallback code',
      1,
      {
        type: 'edit_kcl_code',
        status_code: 201,
        project_name: 'demo',
        outputs: { 'main.kcl': 'fallback code' },
        zookeeper_edit_patch: {
          run_id: 'run-1',
          changed_files: [
            {
              path: 'part.kcl',
              status: 'deleted',
              previous_contents: 'deleted code',
            },
          ],
        },
      },
      { name: 'part.kcl', path: deletedFilePath }
    )
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    firstRequest.onFileSystemSuccess()

    emitZookeeperFileRequest(processor, 'next edit', 2)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
  })

  test('does not wait for an editor refresh after the active file changes', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'stale editor code', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    kclManagerState.path = '/workspace/demo/other.kcl'
    firstRequest.onFileSystemSuccess()

    emitZookeeperFileRequest(processor, 'next edit', 2)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
  })

  test('settles an editor refresh callback that throws', async () => {
    mocks.updateCodeEditor.mockImplementationOnce(() => {
      throw new Error('editor refresh failed')
    })
    const processor = createProcessor()

    emitZookeeperFileRequest(
      processor,
      'edit without history',
      1,
      patchBackedZookeeperEdit('edit without history')
    )
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    firstRequest.onFileSystemSuccess()
    expect(() => firstRequest.onSuccess()).toThrow('editor refresh failed')

    emitZookeeperFileRequest(processor, 'next edit', 2)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
  })

  test('ignores outputs without a patch and allows the next authorized edit', async () => {
    const processor = createProcessor()
    emitZookeeperFileRequest(
      processor,
      'unlisted edit',
      1,
      zookeeperEditWithoutPatch('unlisted edit')
    )
    expect(mocks.systemIOSend).not.toHaveBeenCalled()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
    expect(mocks.historyBegin).not.toHaveBeenCalled()
    expect(processor.hasPendingRequests).toBe(false)
    expect(processor.fileWriteProgress.value).toBeUndefined()

    emitZookeeperFileRequest(processor, 'next edit', 2)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    expect(request.files[0].requestedCode).toBe('next edit')
    request.onFileSystemSuccess()
    request.onSuccess()
    await processor.dispose()
  })

  test('counts and dispatches only patch-listed files from a large output snapshot', async () => {
    const processor = createProcessor()
    const output = patchBackedZookeeperEdit('changed code')
    output.outputs = {
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `untouched-${index}.kcl`,
          'height = 1',
        ])
      ),
      ...output.outputs,
    }
    emitZookeeperFileRequest(processor, 'changed code', 1, output)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    expect(request.files).toEqual([
      {
        requestedFileName: 'main.kcl',
        requestedCode: 'changed code',
        requestedProjectName: 'demo',
      },
    ])
    expect(processor.fileWriteProgress.value).toEqual({ written: 0, total: 1 })
    request.onFileWriteProgress({ written: 1, total: 1 })
    request.onFileSystemSuccess()
    request.onSuccess()
    await processor.dispose()
  })

  test('does not refresh an inactive file or stall the next edit', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'intermediate code', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    firstRequest.onFileSystemSuccess()
    kclManagerState.path = '/workspace/demo/other.kcl'
    firstRequest.onSuccess()

    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()

    emitZookeeperFileRequest(processor, 'final code', 2)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
  })

  test('finishes an already-dispatched edit after session disposal', async () => {
    let sessionIsCurrent = true
    const processor = createProcessor(() => sessionIsCurrent)

    emitZookeeperFileRequest(processor, 'completed while disabled', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    sessionIsCurrent = false
    const disposal = processor.dispose()
    kclManagerState.zookeeperHistoryRecordingInProgress = false
    request.onFileSystemSuccess()
    request.onSuccess()
    await disposal

    expect(mocks.onEditApplied).not.toHaveBeenCalled()
    expect(mocks.updateCodeEditor).toHaveBeenCalledWith(
      'completed while disabled',
      expect.objectContaining({
        shouldClearHistory: false,
        shouldExecute: false,
      })
    )
    expect(mocks.historyComplete).toHaveBeenCalledOnce()
    expect(kclManagerState.zookeeperHistoryRecordingInProgress).toBe(false)
  })

  test('does not wait for a missing navigation callback on disposal', async () => {
    let finishHistory: () => void = () => undefined
    mocks.historyComplete.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishHistory = () => resolve(undefined)
        })
    )
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'written before disposal', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    request.onFileSystemSuccess()
    let disposed = false
    const disposal = processor.dispose().then(() => {
      disposed = true
    })

    await Promise.resolve()
    expect(disposed).toBe(false)

    finishHistory()
    await disposal

    expect(mocks.historyComplete).toHaveBeenCalledOnce()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()

    request.onSuccess()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
  })

  test('waits for a dispatched write before disposing an edit', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(
      processor,
      'edit without history',
      1,
      patchBackedZookeeperEdit('edit without history')
    )
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    let disposed = false
    const disposal = processor.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()

    expect(disposed).toBe(false)

    request.onFileSystemSuccess()
    await disposal

    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
  })

  test('reset waits for previous work without waiting for edits queued after the reset', async () => {
    const processor = createProcessor()
    try {
      emitZookeeperFileRequest(processor, 'previous conversation', 1)
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
      const firstRequest = mocks.systemIOSend.mock.calls[0][0].data

      const reset = processor.reset()
      emitZookeeperFileRequest(processor, 'new conversation', 1)
      firstRequest.onFileSystemSuccess()
      firstRequest.onSuccess()
      await reset

      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
      const secondRequest = mocks.systemIOSend.mock.calls[1][0].data
      expect(secondRequest.orderedId).toBe(2)
      expect(secondRequest.files[0].requestedCode).toBe('new conversation')
      expect(mocks.onEditApplied).not.toHaveBeenCalled()
      secondRequest.onFileSystemSuccess()
      secondRequest.onSuccess()
      await waitFor(() => expect(mocks.onEditApplied).toHaveBeenCalledOnce())
    } finally {
      for (const [event] of mocks.systemIOSend.mock.calls) {
        event.data.onFileSystemError()
      }
      await processor.dispose()
    }
  })

  test('finishes a dispatched edit before resetting for a new conversation', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'completed while resetting', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    const reset = processor.reset()
    request.onFileSystemSuccess()
    request.onSuccess()
    await reset

    expect(mocks.onEditApplied).not.toHaveBeenCalled()
    expect(mocks.historyCancel).not.toHaveBeenCalled()
    expect(mocks.historyComplete).toHaveBeenCalledOnce()
    expect(mocks.updateCodeEditor).toHaveBeenCalledWith(
      'completed while resetting',
      expect.objectContaining({ shouldClearHistory: false })
    )
  })

  test('does not wait for a missing navigation callback when resetting', async () => {
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'written before reset', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    request.onFileSystemSuccess()
    await processor.reset()

    expect(mocks.historyComplete).toHaveBeenCalledOnce()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()

    request.onSuccess()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
  })

  test('does not finish a dispatched edit against a replaced editor', async () => {
    let editorIsCurrent = true
    const processor = createProcessor(
      () => true,
      () => editorIsCurrent
    )

    emitZookeeperFileRequest(processor, 'stale editor code', 1)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data

    editorIsCurrent = false
    request.onFileSystemSuccess()
    request.onSuccess()

    expect(mocks.historyCancel).toHaveBeenCalledWith({ exchangeId: 0 })
    expect(mocks.historyComplete).not.toHaveBeenCalled()
    expect(mocks.updateCodeEditor).not.toHaveBeenCalled()
    expect(
      kclManagerState.zookeeperManagerMachineBulkManipulatingFileSystem
    ).toBe(false)
  })

  test('cancels an idle-state wait on disposal', async () => {
    vi.mocked(waitForIdleState).mockImplementationOnce(
      ({ abortSignal }) =>
        new Promise<undefined>((resolve) => {
          abortSignal?.addEventListener('abort', () => resolve(undefined), {
            once: true,
          })
        })
    )
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'never dispatched', 1)
    await waitFor(() => expect(waitForIdleState).toHaveBeenCalledOnce())
    const abortSignal = vi.mocked(waitForIdleState).mock.calls[0][0].abortSignal

    expect(abortSignal?.aborted).toBe(false)
    const disposal = processor.dispose()
    expect(abortSignal?.aborted).toBe(true)
    await disposal
    expect(mocks.systemIOSend).not.toHaveBeenCalled()
    expect(mocks.historyCancel).toHaveBeenCalledWith({ exchangeId: 0 })
  })

  test('drops queued work from the previous conversation on reset', async () => {
    vi.mocked(waitForIdleState).mockImplementationOnce(
      ({ abortSignal }) =>
        new Promise<undefined>((resolve) => {
          abortSignal?.addEventListener('abort', () => resolve(undefined), {
            once: true,
          })
        })
    )
    const processor = createProcessor()

    emitZookeeperFileRequest(processor, 'stale edit', 1)
    await waitFor(() => expect(waitForIdleState).toHaveBeenCalledOnce())
    emitZookeeperFileRequest(processor, 'queued stale edit', 2)

    await processor.reset()
    emitZookeeperFileRequest(processor, 'fresh edit', 1)

    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    expect(mocks.systemIOSend.mock.calls[0][0].data.orderedId).toBe(3)
    expect(mocks.historyCancel).toHaveBeenCalledWith({ exchangeId: 0 })
    expect(mocks.systemIOSend.mock.calls[0][0].data.files[0]).toMatchObject({
      requestedCode: 'fresh edit',
    })
  })
})
