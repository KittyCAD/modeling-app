import type { EditorMatcher } from '@src/lib/editors/matching'
import { contract, Facet, service } from 'plankton'
import { inputs, observe, observeService } from '@src/registry/inputs'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { Scope } from 'effect/Scope'

/** Live editor handle plus a source snapshot; interruption aborts signal when supported. */
export interface ExecutorRunContext {
  readonly executor: Executor
  readonly editor: Editor
  /** Captured with the contents; use this path rather than rereading the live editor after awaiting. */
  readonly src: string
  readonly signal: AbortSignal
}

/** A computation contributed for a matching source snapshot, without file IO. */
export interface ExecutorCapability<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique contribution ID, used to name its data or error in the output. */
  id: string
  matches: EditorMatcher
  execute: (
    contents: string,
    context: ExecutorRunContext
  ) => Error | T | Promise<Error | T>
}

/** Infer a capability's successful data from its synchronous or asynchronous execute function. */
export type CapabilityData<C extends ExecutorCapability> = Exclude<
  Awaited<ReturnType<C['execute']>>,
  Error
>

/** Preserve the concrete function return type and literal ID when defining a capability. */
export function defineExecutorCapability<const C extends ExecutorCapability>(
  capability: C
): C {
  return capability
}

/** An atomic snapshot with typed capability lookups and ID-indexed summaries. */
export interface ExecutorOutput {
  readonly src: string
  readonly contents: string
  readonly running: boolean
  readonly data: Readonly<Record<string, Record<string, unknown>>>
  readonly errors: Readonly<Record<string, Error>>
  /** Read data produced by this exact capability; absent, failed, and pending results are undefined. */
  get: <C extends ExecutorCapability>(
    capability: C
  ) => CapabilityData<C> | undefined
}

/** A watcher of one editor; its lifecycle and results are independent of other executors. */
export interface Executor {
  /** Long-lived capability resources are released when this executor closes. */
  readonly scope: Scope
  readonly id: symbol
  readonly editor: Editor
  readonly output: ReadonlySignal<ExecutorOutput>
  /** Retry current source and dependencies in this executor only. */
  refresh: () => void
}

/** Computation is acquired explicitly by mode contexts or other consumers, independently of focus. */
export interface ExecutorsService {
  executors: ReadonlySignal<readonly Executor[]>
  createExecutor: (editor: Editor) => Executor | Error
  acquireExecutor: (editor: Editor) =>
    | {
        executor: Executor
        release: () => void
      }
    | Error
  closeExecutor: (id: symbol) => void
}

export const executorsContract = contract({
  executorsService: service<ExecutorsService>('executors.service'),
  executorCapabilityFacet: new Facet(
    'executors.capabilities',
    (values: readonly ExecutorCapability[]) => values
  ),
})

export const { executorsService, executorCapabilityFacet } = executorsContract

export const observations = inputs({
  executorsService: observeService(executorsService),
  executorCapabilityFacet: observe(executorCapabilityFacet),
})
