import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
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

export type SystemIORefreshProjectsInput = {
  readonly projectDirectoryPath: string
}

export type SystemIORefreshProjectsRequest = SystemIORequestBase<
  'projects.refresh',
  SystemIORefreshProjectsInput
>

export type SystemIORequest = SystemIORefreshProjectsRequest

export type SystemIORequestResult<TRequest extends SystemIORequest> =
  TRequest extends SystemIORefreshProjectsRequest ? Projects : never

export type SystemIOService = {
  /**
   * Transitional bridge for callers that still consume the legacy XState actor.
   * New filesystem/project-directory work should prefer request/signals.
   */
  readonly actor: SystemIOActor | undefined
  readonly operations: ReadonlySignal<readonly SystemIOOperationSnapshot[]>
  readonly projectHandles: ReadonlySignal<ProjectHandles>
  readonly projects: ReadonlySignal<Projects>
  startActor: (input: SystemIOInput) => SystemIOActor
  request: <TRequest extends SystemIORequest>(
    request: TRequest
  ) => SystemIOOperation<SystemIORequestResult<TRequest>, TRequest>
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIOService>('system-io.service'),
})

export const { systemIOService } = systemIOContract
