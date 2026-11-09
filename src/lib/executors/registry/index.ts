import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { createExecutor } from '@src/lib/executors/executor'
import {
  executorCapabilityValueSpec,
  executorsService,
  type Executor,
  type ExecutorsService,
} from '@src/lib/executors/registry/contract'
import type { Editor } from '@src/lib/editors/registry/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Owns explicitly created executors, without owning editors, files, or their contents. */
const extension = defineRegistryItemFactory(({ valueSpecs, services }) => {
  const executors = signal<readonly Executor[]>([])
  const capabilities = valueSpecs.signal(executorCapabilityValueSpec)
  const disposers = new Map<symbol, () => void>()
  const leases = new Map<Editor, { executor: Executor; count: number }>()
  const service: ExecutorsService = {
    executors,
    acquireExecutor: (editor) => {
      let lease = leases.get(editor)
      if (!lease) {
        lease = { executor: service.createExecutor(editor), count: 0 }
        leases.set(editor, lease)
      }
      lease.count++
      const current = lease
      let released = false
      return {
        executor: current.executor,
        release: () => {
          if (released) return
          released = true
          if (--current.count === 0) {
            if (leases.get(editor) === current) leases.delete(editor)
            service.closeExecutor(current.executor.id)
          }
        },
      }
    },
    createExecutor: (editor) => {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- An executor cannot acquire an already closed document.
      if (editor.signal.aborted) throw new Error('The editor is closed')
      const { executor, dispose } = createExecutor(editor, capabilities, () => {
        service.closeExecutor(executor.id)
      })
      const id = executor.id
      // Executors may also watch editor handles owned outside the editors service.
      const lifetime = services
        .optional(projectSessionService)
        ?.currentSession.peek()?.signal
      const close = () => service.closeExecutor(id)
      lifetime?.addEventListener('abort', close, { once: true })
      disposers.set(id, () => {
        lifetime?.removeEventListener('abort', close)
        dispose()
      })
      executors.value = [...executors.peek(), executor]
      return executor
    },
    closeExecutor: (id) => {
      const dispose = disposers.get(id)
      if (!dispose) return
      disposers.delete(id)
      dispose()
      for (const [editor, lease] of leases)
        if (lease.executor.id === id) leases.delete(editor)
      executors.value = executors
        .peek()
        .filter((executor) => executor.id !== id)
    },
  }
  return {
    id: 'executors',

    providesServices: [provideService(executorsService, service)],
    dispose: () => {
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
      executors.value = []
      leases.clear()
    },
  }
}, 'executors')

export { extension as executorsExtension }

export default withProjectShellFeature(extension, 'executors')
