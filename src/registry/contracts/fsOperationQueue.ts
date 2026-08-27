import { defineContract, defineService } from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export type FsOperationQueueStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'

export interface FsOperationQueueOperation {
  readonly kind: string
  readonly sourcePath?: string
  readonly targetPath?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface FsOperationQueueRecord extends FsOperationQueueOperation {
  readonly id: string
  readonly parentId?: string
  readonly sequence: number
  readonly status: FsOperationQueueStatus
  readonly enqueuedAt: number
  readonly startedAt?: number
  readonly completedAt?: number
  readonly error?: unknown
}

/** Mutating filesystem operations that can run alone or within a batch. */
export interface FsMutationOperations {
  cp: IZooDesignStudioFS['cp']
  mkdir: IZooDesignStudioFS['mkdir']
  rename: IZooDesignStudioFS['rename']
  rm: IZooDesignStudioFS['rm']
  writeFile: IZooDesignStudioFS['writeFile']
}

/**
 * Filesystem facade bound to one exclusively scheduled batch.
 *
 * Calls made through this facade are serialized inside the batch without
 * re-entering the top-level queue. A batch provides scheduling atomicity only;
 * it does not roll back filesystem effects when a later operation fails.
 */
export interface FsOperationBatch extends FsMutationOperations {
  readonly id: string
  run: <Result>(
    operation: FsOperationQueueOperation,
    run: () => Promise<Result>
  ) => Promise<Result>
}

export interface FsOperationQueueState {
  readonly pending: boolean
  readonly current?: FsOperationQueueRecord
  readonly queued: readonly FsOperationQueueRecord[]
  readonly journal: readonly FsOperationQueueRecord[]
}

/**
 * Serializes mutating filesystem work through one observable chokepoint.
 *
 * Domain services should expose domain-specific operations, but mutating
 * filesystem effects should run through this queue so ordering and error
 * reporting can be tested independently of those domains.
 */
export interface FsOperationQueueService extends FsMutationOperations {
  readonly state: Signal<FsOperationQueueState>
  run: <Result>(
    operation: FsOperationQueueOperation,
    run: () => Promise<Result>
  ) => Promise<Result>
  batch: <Result>(
    operation: FsOperationQueueOperation,
    run: (batch: FsOperationBatch) => Promise<Result>
  ) => Promise<Result>
  waitForIdle: () => Promise<void>
  getJournal: () => readonly FsOperationQueueRecord[]
  clearJournal: () => void
}

export const fsOperationQueueContract = defineContract({
  fsOperationQueue:
    defineService<FsOperationQueueService>('fs-operation-queue'),
})

export const { fsOperationQueue } = fsOperationQueueContract
