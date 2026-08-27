import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * Provenance for a write this app performed.
 *
 * Lets a filesystem watcher tell our own writes apart from an independent
 * external edit, so a save does not come back as an incoming change and race the
 * buffer that produced it.
 */
export interface WriteToken {
  path: string
  contentId: string
  at: number
}

export interface FsOperationQueue {
  /**
   * Run an operation with exclusive access to a path.
   *
   * Operations on the same path run in submission order; operations on
   * different paths run concurrently. Two saves of one file can therefore never
   * interleave, which is the failure that leaves a half-written document.
   */
  enqueue<T>(path: string, operation: () => Promise<T>): Promise<T>

  /** Record that we wrote this content, for watcher provenance. */
  recordWrite(path: string, contentId: string): void
  /** True if the given content at that path is one we just wrote. */
  isOwnWrite(path: string, contentId: string): boolean

  readonly pending: ReadonlySignal<number>
}

export const fsOperationsContract = defineContract({
  fsOperationQueueService:
    defineService<FsOperationQueue>('fsOperations.queue'),
})

export const { fsOperationQueueService } = fsOperationsContract
