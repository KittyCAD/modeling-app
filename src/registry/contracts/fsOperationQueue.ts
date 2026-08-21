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
  readonly sequence: number
  readonly status: FsOperationQueueStatus
  readonly enqueuedAt: number
  readonly startedAt?: number
  readonly completedAt?: number
  readonly error?: unknown
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
export interface FsOperationQueueService {
  readonly state: Signal<FsOperationQueueState>
  run: <Result>(
    operation: FsOperationQueueOperation,
    run: () => Promise<Result>
  ) => Promise<Result>
  waitForIdle: () => Promise<void>
  getJournal: () => readonly FsOperationQueueRecord[]
  clearJournal: () => void
  cp: IZooDesignStudioFS['cp']
  mkdir: IZooDesignStudioFS['mkdir']
  rename: IZooDesignStudioFS['rename']
  rm: IZooDesignStudioFS['rm']
  writeFile: IZooDesignStudioFS['writeFile']
}

export const fsOperationQueueContract = defineContract({
  fsOperationQueue:
    defineService<FsOperationQueueService>('fs-operation-queue'),
})

export const { fsOperationQueue } = fsOperationQueueContract
