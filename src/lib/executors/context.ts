import { acquireAutomaticExecution } from '@src/lib/executors/automatic'
import { isErr } from '@src/lib/trap'
import { computed } from '@preact/signals-core'
import type { EditorViewHost } from '@src/lib/editors/registry/contract'
import type {
  ExecutorCapability,
  ExecutorsService,
} from '@src/lib/executors/registry/contract'

/** Retain one executor per editor instance; modes share coalesced results and release their leases. */
export function executionContext<C extends ExecutorCapability>(
  capability: C,
  getExecutors: () => ExecutorsService,
  automatic?: () => boolean
) {
  return ({ editor, onDispose }: EditorViewHost) => {
    const lease = getExecutors().acquireExecutor(editor)
    if (isErr(lease)) return lease
    onDispose(lease.release)
    if (automatic)
      onDispose(
        acquireAutomaticExecution(lease.executor, capability, automatic)
      )
    const result = computed(() => {
      const state = lease.executor.result(capability).value
      return {
        ...state,
        src: state.input?.src ?? '',
        contents: state.input?.contents ?? '',
      }
    })
    return { executor: lease.executor, result }
  }
}
