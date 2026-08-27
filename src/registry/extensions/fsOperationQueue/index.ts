import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds from '@src/lib/fs-zds'
import {
  type FsMutationOperations,
  type FsOperationBatch,
  type FsOperationQueueOperation,
  type FsOperationQueueRecord,
  type FsOperationQueueService,
  type FsOperationQueueState,
  fsOperationQueue,
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

function createFileSystemOperations(
  run: FsOperationBatch['run']
): FsMutationOperations {
  return {
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

  const publishBatchRecord = (record: FsOperationQueueRecord) => {
    const previous = state.value
    state.value = {
      ...previous,
      journal: sortedBySequence([
        ...previous.journal.filter((item) => item.id !== record.id),
        record,
      ]).slice(-maxJournalEntries),
    }
  }

  const createRecord = (
    operation: FsOperationQueueOperation,
    parentId?: string
  ): FsOperationQueueRecord => {
    const sequence = nextSequence++
    return {
      ...operation,
      id: `fs-operation-${sequence}`,
      ...(parentId ? { parentId } : {}),
      sequence,
      status: 'queued',
      enqueuedAt: Date.now(),
    }
  }

  const executeRecord = async <Result>(
    queuedRecord: FsOperationQueueRecord,
    operationRun: (runningRecord: FsOperationQueueRecord) => Promise<Result>,
    publish: (record: FsOperationQueueRecord) => void
  ) => {
    const runningRecord: FsOperationQueueRecord = {
      ...queuedRecord,
      status: 'running',
      startedAt: Date.now(),
    }
    publish(runningRecord)

    try {
      const result = await operationRun(runningRecord)
      publish({
        ...runningRecord,
        status: 'completed',
        completedAt: Date.now(),
      })
      return result
    } catch (error: unknown) {
      publish({
        ...runningRecord,
        status: 'failed',
        completedAt: Date.now(),
        error,
      })
      return Promise.reject(error)
    }
  }

  const enqueue = <Result>(
    operation: FsOperationQueueOperation,
    operationRun: (runningRecord: FsOperationQueueRecord) => Promise<Result>
  ) => {
    const queuedRecord = createRecord(operation)
    publishRecord(queuedRecord)

    const runQueued = () =>
      executeRecord(queuedRecord, operationRun, publishRecord)

    const queued = queueTail.then(runQueued, runQueued)
    queueTail = queued.then(
      () => undefined,
      () => undefined
    )

    return queued
  }

  const run: FsOperationQueueService['run'] = (operation, operationRun) =>
    enqueue(operation, operationRun)

  const batch: FsOperationQueueService['batch'] = (operation, batchRun) =>
    enqueue(operation, async (batchRecord) => {
      let batchTail: Promise<unknown> = Promise.resolve()
      const runInBatch: FsOperationBatch['run'] = (
        childOperation,
        childOperationRun
      ) => {
        const queuedRecord = createRecord(childOperation, batchRecord.id)
        publishBatchRecord(queuedRecord)
        const runChild = () =>
          executeRecord(queuedRecord, childOperationRun, publishBatchRecord)
        const child = batchTail.then(runChild, runChild)
        batchTail = child.then(
          () => undefined,
          () => undefined
        )
        return child
      }
      const batchFacade: FsOperationBatch = {
        id: batchRecord.id,
        run: runInBatch,
        ...createFileSystemOperations(runInBatch),
      }

      try {
        return await batchRun(batchFacade)
      } finally {
        await batchTail
      }
    })

  const fileSystemOperations = createFileSystemOperations(run)

  const serviceImpl: FsOperationQueueService = {
    state,
    run,
    batch,
    waitForIdle: async () => {
      await queueTail.catch(() => undefined)
    },
    getJournal: () => state.value.journal,
    clearJournal: () => {
      const activeRecords = [
        ...state.value.journal.filter(
          (record) => record.status === 'queued' || record.status === 'running'
        ),
        ...(state.value.current ? [state.value.current] : []),
        ...state.value.queued,
      ]
      state.value = {
        ...state.value,
        journal: sortedBySequence(
          activeRecords.filter(
            (record, index, records) =>
              records.findIndex((item) => item.id === record.id) === index
          )
        ),
      }
    },
    ...fileSystemOperations,
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
