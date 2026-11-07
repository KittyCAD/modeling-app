import type { EditorMatcher } from '@src/lib/editors/matching'
import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { ComponentType } from 'react'
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

/** A source-matched view, contributed alongside the capability whose output it renders. */
export interface ExecutorViewContribution {
  id: string
  label: string
  capabilityId: string
  matches: EditorMatcher
  /** Higher priorities are preferred by default; ties retain registration order. */
  priority?: number
  Component: ComponentType<{ executor: Executor }>
}

/** A watcher of one editor; its lifecycle and results are independent of other executors. */
export interface Executor {
  /** Long-lived capability resources are released when this executor closes. */
  readonly scope: Scope
  readonly id: symbol
  readonly editor: Editor
  readonly output: ReadonlySignal<ExecutorOutput>
}

/** An explicitly opened view owns its executor independently of editor focus. */
export interface ExecutorViewTab {
  readonly executor: Executor
  readonly viewId: string
}

/** Creates executors explicitly; opening an editor does not create an executor. */
export interface ExecutorsService {
  executors: ReadonlySignal<readonly Executor[]>
  viewTabs: ReadonlySignal<readonly ExecutorViewTab[]>
  /** Opens a new view and starts its executor; closing the executor closes the tab. */
  openView: (editor: Editor, viewId: string) => ExecutorViewTab
  /** Change one tab's contributed view while retaining its executor and output. */
  setView: (executorId: symbol, viewId: string) => void
  /** Starts watching immediately and stops when the watched view is destroyed. */
  createExecutor: (editor: Editor) => Executor
  /** Detaches this executor's watcher without closing or changing its editor. */
  closeExecutor: (id: symbol) => void
}

export const executorsContract = defineContract({
  executorsService: defineService<ExecutorsService>('executors.service'),
  executorCapabilityValueSpec: appendValueSpec<ExecutorCapability>(
    'executors.capabilities'
  ),
  executorViewValueSpec:
    appendValueSpec<ExecutorViewContribution>('executors.views'),
})

export const {
  executorsService,
  executorCapabilityValueSpec,
  executorViewValueSpec,
} = executorsContract
