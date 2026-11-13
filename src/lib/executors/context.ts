import { computed } from '@preact/signals-core'
import type { EditorViewHost } from '@src/lib/editors/registry/contract'
import type {
  ExecutorCapability,
  ExecutorsService,
} from '@src/lib/executors/registry/contract'

/** Retain one executor per editor instance; modes share coalesced results and release their leases. */
export function executionContext<C extends ExecutorCapability>(
  capability: C,
  getExecutors: () => ExecutorsService
) {
  return ({ editor, onDispose }: EditorViewHost) => {
    const lease = getExecutors().acquireExecutor(editor)
    onDispose(lease.release)
    const result = computed(() => {
      const output = lease.executor.output.value
      return {
        data: output.get(capability),
        error: output.errors[capability.id],
        running: output.running,
        src: output.src,
        contents: output.contents,
      }
    })
    return { executor: lease.executor, result }
  }
}
