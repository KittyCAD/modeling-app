import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal, Signal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import type { SystemIOActor, SystemIOInput } from '@src/machines/systemIO/utils'

export type ProjectHandle = {
  readonly path: string
}

export type ProjectHandles = readonly ProjectHandle[] | undefined

export type Projects = readonly Project[] | undefined

export type SystemIOOperationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type SystemIORequestBase<
  TType extends string = string,
  TInput = unknown,
> = {
  readonly type: TType
  readonly input: TInput
}

export type SystemIOOperationSnapshot<
  TRequest extends SystemIORequestBase = SystemIORequestBase,
> = {
  readonly id: string
  readonly request: TRequest
  readonly status: SystemIOOperationStatus
  readonly enqueuedAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly error?: unknown
}

export type SystemIOOperation<
  TResult,
  TRequest extends SystemIORequestBase = SystemIORequestBase,
> = {
  readonly id: string
  readonly request: TRequest
  readonly status: ReadonlySignal<SystemIOOperationStatus>
  readonly result: Promise<TResult>
  cancel: () => void
}

export type SystemIOScanProjectDirectoryInput = {
  readonly projectDirectoryPath: string
  /**
   * Transitional compatibility bridge for the legacy default-directory state.
   * Library scans should leave this false so arbitrary source reads do not
   * replace `projects`/`projectHandles` or sync folders into the XState actor.
   */
  readonly publishToCurrentProjectDirectory?: boolean
}

export type SystemIOScanProjectDirectoryRequest = SystemIORequestBase<
  'projectDirectory.scan',
  SystemIOScanProjectDirectoryInput
>

export type SystemIORequest = SystemIOScanProjectDirectoryRequest

export type SystemIORequestResult<TRequest extends SystemIORequest> =
  TRequest extends SystemIOScanProjectDirectoryRequest ? Projects : never

export type SystemIORequestOptions = {
  readonly signal?: AbortSignal
}

export function scanProjectDirectoryRequest(
  input: SystemIOScanProjectDirectoryInput
): SystemIOScanProjectDirectoryRequest {
  return {
    type: 'projectDirectory.scan',
    input,
  }
}

export type SystemIOService = {
  /**
   * Transitional bridge for callers that still consume the legacy XState actor.
   * New filesystem/project-directory work should prefer request/signals.
   */
  readonly actor: SystemIOActor | undefined
  readonly operations: ReadonlySignal<readonly SystemIOOperationSnapshot[]>
  /**
   * Maximum number of {@link operations} snapshots to retain. Settled records
   * are evicted oldest-first once the count exceeds this; in-flight operations
   * are always kept. Writable so a debug/inspection UI (or a developer in a
   * pinch) can raise it — set it to `Infinity` to keep every record.
   */
  readonly operationRecordLimit: Signal<number>
  readonly projectHandles: ReadonlySignal<ProjectHandles>
  readonly projects: ReadonlySignal<Projects>
  scanProjectDirectory: (
    input: SystemIOScanProjectDirectoryInput,
    options?: SystemIORequestOptions
  ) => Promise<Projects>
  startActor: (input: SystemIOInput) => SystemIOActor
  request: <TRequest extends SystemIORequest>(
    request: TRequest
  ) => SystemIOOperation<SystemIORequestResult<TRequest>, TRequest>
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIOService>('system-io.service'),
})

export const { systemIOService } = systemIOContract
