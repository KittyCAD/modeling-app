import type { ReadonlySignal } from '@preact/signals-core'
import type {
  ExecutorCapability,
  ExecutorRunContext,
} from '@src/lib/executors/registry/contract'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import type { KclSourceSnapshot } from '@src/lib/kcl/execution/sources'
import { isErr } from '@src/lib/trap'

/** Capture one connection-independent source snapshot for every view leasing this executor. */
export function createKclExecution(
  loadSources: (
    contents: string,
    context: ExecutorRunContext
  ) => Promise<KclSourceSnapshot | Error>,
  revision?: ReadonlySignal<unknown>
) {
  const capability = defineExecutorCapability({
    id: 'kcl.execution',
    revision,
    matches: ({ languageId, backing }) =>
      backing === 'text' && languageId === 'kcl',
    async execute(contents: string, context: ExecutorRunContext) {
      const sources = await loadSources(contents, context)
      if (isErr(sources)) return sources
      if (context.signal.aborted)
        return new Error('KCL source capture was cancelled')
      return { sources }
    },
  })
  return { capability }
}

/** Any computation supplying captured KCL sources can drive an engine-backed scene. */
export type KclExecutionCapability = ExecutorCapability<{
  sources: KclSourceSnapshot
}>
