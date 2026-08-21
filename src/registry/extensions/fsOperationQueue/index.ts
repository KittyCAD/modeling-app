import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import {
  fsOperationQueue,
  type FsOperationQueueOperation,
  type FsOperationQueueRecord,
  type FsOperationQueueService,
  type FsOperationQueueState,
} from '@src/registry/contracts/fsOperationQueue'

const maxJournalEntries = 200

const emptyQueueState: FsOperationQueueState = {
  pending: false,
  queued: [],
  journal: [],
}

function sortedBySequence(records: readonly FsOperationQueueRecord[]) {
  return [...records].sort((a, b) => a.sequence - b.sequence)
}

export const fsOperationQueueExtension = defineRegistryItemFactory(() => {
  const state = signal<FsOperationQueueState>(emptyQueueState)
  let queueTail: Promise<unknown> = Promise.resolve()
  let nextSequence = 0

  const publishRecord = (record: FsOperationQueueRecord) => {
    const previous = state.value
    const queued =
      record.status === 'queued'
        ? sortedBySequence([
            ...previous.queued.filter((item) => item.id !== record.id),
            record,
          ])
        : previous.queued.filter((item) => item.id !== record.id)
    const current =
      record.status === 'running'
        ? record
        : previous.current?.id === record.id
          ? undefined
          : previous.current
    const journal = sortedBySequence([
      ...previous.journal.filter((item) => item.id !== record.id),
      record,
    ]).slice(-maxJournalEntries)

    state.value = {
      pending: Boolean(current || queued.length),
      ...(current ? { current } : {}),
      queued,
      journal,
    }
  }

  const createRecord = (
    operation: FsOperationQueueOperation
  ): FsOperationQueueRecord => {
    const sequence = nextSequence++
    return {
      ...operation,
      id: `fs-operation-${sequence}`,
      sequence,
      status: 'queued',
      enqueuedAt: Date.now(),
    }
  }

  const run: FsOperationQueueService['run'] = (operation, operationRun) => {
    const queuedRecord = createRecord(operation)
    publishRecord(queuedRecord)

    const runQueued = () => {
      const runningRecord: FsOperationQueueRecord = {
        ...queuedRecord,
        status: 'running',
        startedAt: Date.now(),
      }
      publishRecord(runningRecord)

      return operationRun().then(
        (result) => {
          publishRecord({
            ...runningRecord,
            status: 'completed',
            completedAt: Date.now(),
          })
          return result
        },
        (error: unknown) => {
          publishRecord({
            ...runningRecord,
            status: 'failed',
            completedAt: Date.now(),
            error,
          })
          return Promise.reject(error)
        }
      )
    }

    const queued = queueTail.then(runQueued, runQueued)
    queueTail = queued.then(
      () => undefined,
      () => undefined
    )

    return queued
  }

  const serviceImpl: FsOperationQueueService = {
    state,
    run,
    waitForIdle: async () => {
      await queueTail.catch(() => undefined)
    },
    getJournal: () => state.value.journal,
    clearJournal: () => {
      const activeRecords = [
        ...(state.value.current ? [state.value.current] : []),
        ...state.value.queued,
      ]
      state.value = {
        ...state.value,
        journal: sortedBySequence(activeRecords),
      }
    },
    cp: (src, dest, options) =>
      run(
        {
          kind: 'cp',
          sourcePath: src,
          targetPath: dest,
        },
        () => Promise.resolve(fsZds.cp(src, dest, options))
      ),
    mkdir: (path, options) =>
      run(
        {
          kind: 'mkdir',
          targetPath: path,
        },
        () => fsZds.mkdir(path, options)
      ),
    rename: (src, dest, options) =>
      run(
        {
          kind: 'rename',
          sourcePath: src,
          targetPath: dest,
        },
        () => fsZds.rename(src, dest, options)
      ),
    rm: (path, options) =>
      run(
        {
          kind: 'rm',
          targetPath: path,
        },
        () => fsZds.rm(path, options)
      ),
    writeFile: (path, data, options) =>
      run(
        {
          kind: 'write-file',
          targetPath: path,
        },
        () => fsZds.writeFile(path, data, options)
      ),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'fs-operation-queue-extension',
      providesServices: [provideService(fsOperationQueue, serviceImpl)],
    }),
  }
}, 'fs-operation-queue-extension')

export default defineRegistryItem({
  id: 'fs-operation-queue',
  uses: [fsOperationQueueExtension],
})
