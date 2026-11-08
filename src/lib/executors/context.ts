import { computed } from '@preact/signals-core'
import type { EditorViewHost } from '@src/lib/editors/registry/contract'
import type {
  ExecutorCapability,
  ExecutorsService,
} from '@src/lib/executors/registry/contract'

/** Share document computations by default; modes with owned render resources can request their own executor. */
export function executionContext<C extends ExecutorCapability>(
  capability: C,
  getExecutors: () => ExecutorsService,
  options: { shared?: boolean } = {}
) {
  return ({ editor, onDispose }: EditorViewHost) => {
    const service = getExecutors()
    const lease =
      options.shared === false ? undefined : service.acquireExecutor(editor)
    const executor = lease?.executor ?? service.createExecutor(editor)
    onDispose(lease?.release ?? (() => service.closeExecutor(executor.id)))
    const result = computed(() => {
      const output = executor.output.value
      return {
        data: output.get(capability),
        error: output.errors[capability.id],
        running: output.running,
        src: output.src,
        contents: output.contents,
      }
    })
    return { executor, result }
  }
}
