import { isErr } from '@src/lib/trap'
import { factory, provide } from 'plankton'
import { observe } from '@src/registry/inputs'
import { signal, type Signal, type ReadonlySignal } from '@preact/signals-core'
import { createExecutor } from '@src/lib/executors/executor'
import {
  executorCapabilityFacet,
  executorsService,
  type Executor,
  type ExecutorCapability,
  type ExecutorsService,
} from '@src/lib/executors/registry/contract'
import type { Editor } from '@src/lib/editors/registry/contract'
import { observations as projectObservations } from '@src/lib/projectSession/next/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Owns explicitly created executors, without owning editors, files, or their contents. */
const extension = factory({
  key: 'executors',
  dependencies: {
    capabilities: observe(executorCapabilityFacet),
    projects: projectObservations,
  },
  create: ({ capabilities, projects }) => {
    const executors = signal<readonly Executor[]>([])
    const disposers = new Map<symbol, () => void>()
    const leases = new Map<
      Editor,
      {
        executor: Executor
        count: number
        requested: Signal<readonly ExecutorCapability[]>
      }
    >()
    const openExecutor = (
      editor: Editor,
      requested?: ReadonlySignal<readonly ExecutorCapability[]>
    ): Executor | Error => {
      if (editor.signal.aborted) return new Error('The editor is closed')
      const { executor, dispose } = createExecutor(
        editor,
        capabilities,
        () => {
          service.closeExecutor(executor.id)
        },
        requested
      )
      const id = executor.id
      // Executors may also watch editor handles owned outside the editors service.
      const lifetime = projects.projectSessionService.current
        .peek()
        ?.currentSession.peek()?.signal
      const close = () => service.closeExecutor(id)
      lifetime?.addEventListener('abort', close, { once: true })
      disposers.set(id, () => {
        lifetime?.removeEventListener('abort', close)
        dispose()
      })
      executors.value = [...executors.peek(), executor]
      return executor
    }
    const service: ExecutorsService = {
      executors,
      acquireExecutor: (editor, capability) => {
        let lease = leases.get(editor)
        if (!lease) {
          const requested = signal<readonly ExecutorCapability[]>([])
          const executor = openExecutor(editor, requested)
          if (isErr(executor)) return executor
          lease = { executor, count: 0, requested }
          leases.set(editor, lease)
        }
        lease.count++
        if (capability)
          lease.requested.value = [...lease.requested.peek(), capability]
        const current = lease
        let released = false
        return {
          executor: current.executor,
          release: () => {
            if (released) return
            released = true
            if (capability) {
              const index = current.requested.peek().indexOf(capability)
              current.requested.value = current.requested
                .peek()
                .filter((_, candidate) => candidate !== index)
            }
            if (--current.count === 0) {
              if (leases.get(editor) === current) leases.delete(editor)
              service.closeExecutor(current.executor.id)
            }
          },
        }
      },
      createExecutor: (editor) => openExecutor(editor),
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
      exports: service,
      items: [provide(executorsService, service)],
      dispose: () => {
        for (const dispose of disposers.values()) dispose()
        disposers.clear()
        executors.value = []
        leases.clear()
      },
    }
  },
})

export default withProjectShellFeature(extension, 'executors')
