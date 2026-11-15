import type { EditorMatcher } from '@src/lib/editors/matching'
import { contract, Facet, service } from 'plankton'
import { inputs, observe, observeService } from '@src/registry/inputs'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { Scope } from 'effect/Scope'

/** Passed to `ExecutorCapability.execute`; `src` is captured for that run, while `editor` remains a live document handle. */
export interface ExecutorRunContext {
  readonly executor: Executor
  readonly editor: Editor
  /** Captured alongside the `contents` argument, so async work keeps its original source path. */
  readonly src: string
  readonly signal: AbortSignal
}

/** A registry-contributed computation for matching editor text. The capability may load dependencies; the generic executor schedules it and collects its result. */
export interface ExecutorCapability<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Key used by `ExecutorOutput.data` and `.errors`; duplicate IDs overwrite summary entries, while typed `output.get` uses object identity. */
  id: string
  matches: EditorMatcher
  /** Dependencies beyond editor text. `createExecutor` compares successive values with `Object.is`, so producers must publish a new value when those inputs change. */
  revision?: ReadonlySignal<unknown>
  execute: (
    contents: string,
    context: ExecutorRunContext
  ) => Error | T | Promise<Error | T>
}

/** The successful return type of `ExecutorCapability.execute`, excluding its returned `Error` case. */
export type CapabilityData<C extends ExecutorCapability> = Exclude<
  Awaited<ReturnType<C['execute']>>,
  Error
>

/** Retain the contributed `execute` function's inferred return type for typed `output.get` calls. */
export function defineExecutorCapability<const C extends ExecutorCapability>(
  capability: C
): C {
  return capability
}

/** Results for captured `src`/`contents`. Completed capabilities can publish while `running` remains true for pending siblings. */
export interface ExecutorOutput {
  readonly src: string
  readonly contents: string
  readonly running: boolean
  readonly data: Readonly<Record<string, Record<string, unknown>>>
  readonly errors: Readonly<Record<string, Error>>
  /** `createExecutorOutput` keys successful results by capability object identity; absent, failed, and pending results return `undefined`. */
  get: <C extends ExecutorCapability>(
    capability: C
  ) => CapabilityData<C> | undefined
}

/** One execution owner for an `Editor`. Several executors can watch the same document while retaining separate results and scopes. */
export interface Executor {
  /** Capability resources register finalizers here; closing the executor initiates `Scope.close`. */
  readonly scope: Scope
  readonly id: symbol
  readonly editor: Editor
  readonly output: ReadonlySignal<ExecutorOutput>
  /** Retry this executor's current source and capability revisions without editing its document or refreshing sibling executors. */
  refresh: () => void
}

/** Creates explicit executors or leases shared ones for mode contexts; editor focus does not select the execution target. */
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
