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

/** A registry-contributed computation for matching editor text. The capability may load dependencies; the generic executor runs it on request and collects its result. */
export interface ExecutorCapability<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Key used by `ExecutorOutput.data` and `.errors`; duplicate IDs overwrite summary entries, while typed `output.get` uses object identity. */
  id: string
  matches: EditorMatcher
  /** Dependencies beyond editor text. Freshness compares successive values with `Object.is`, so producers must publish a new value when those inputs change. A reader can select inputs owned by the specific executor. */
  revision?: ReadonlySignal<unknown> | ((executor: Executor) => unknown)
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

/** Retained results may describe different inputs. `src`/`contents` describe the latest request; per-capability result observations carry their own input and freshness. */
export interface ExecutorOutput {
  readonly src: string
  readonly contents: string
  readonly running: boolean
  readonly data: Readonly<Record<string, Record<string, unknown>>>
  readonly errors: Readonly<Record<string, Error>>
  /** `createExecutorOutput` keys successful results by capability object identity; absent and failed results return `undefined`; pending replacements retain completed data. */
  get: <C extends ExecutorCapability>(
    capability: C
  ) => CapabilityData<C> | undefined
}

/** Captured source and dependency identity for one eligible computation. */
export interface ExecutionInput {
  readonly src: string
  readonly contents: string
  readonly revision: unknown
}

/** Last completed attempt remains visible while another request runs or inputs change. */
export interface ExecutionResult<T = Record<string, unknown>> {
  readonly requested?: ExecutionInput
  readonly input?: ExecutionInput
  readonly completed?: symbol
  readonly data?: T
  readonly error?: Error
  readonly running: boolean
  readonly stale: boolean
}

/** One document's independently requested computations and their resource lifetime. */
export interface Executor {
  readonly scope: Scope
  readonly id: symbol
  readonly editor: Editor
  /** Summary of retained completed attempts; use result(capability) for freshness and per-capability progress. */
  readonly output: ReadonlySignal<ExecutorOutput>
  readonly input: (
    capability: ExecutorCapability
  ) => ReadonlySignal<ExecutionInput | undefined>
  readonly result: <C extends ExecutorCapability>(
    capability: C
  ) => ReadonlySignal<ExecutionResult<CapabilityData<C>>>
  /** Capture current inputs and supersede only this capability's previous request. Edits never request or cancel work. */
  readonly run: (capability: ExecutorCapability) => Promise<void>
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
