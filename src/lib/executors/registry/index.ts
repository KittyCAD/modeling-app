import { isErr } from '@src/lib/trap'
import { factory, provide } from 'plankton'
import { observe } from '@src/registry/inputs'
import { signal } from '@preact/signals-core'
import { createExecutor } from '@src/lib/executors/executor'
import {
  executorCapabilityFacet,
  executorsService,
  type Executor,
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
    const leases = new Map<Editor, { executor: Executor; count: number }>()
    const service: ExecutorsService = {
      executors,
      acquireExecutor: (editor) => {
        let lease = leases.get(editor)
        if (!lease) {
          const executor = service.createExecutor(editor)
          if (isErr(executor)) return executor
          lease = { executor, count: 0 }
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
        if (editor.signal.aborted) return new Error('The editor is closed')
        const { executor, dispose } = createExecutor(
          editor,
          capabilities,
          () => {
            service.closeExecutor(executor.id)
          }
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
