import { editorMatchContext } from '@src/lib/editors/matching'
import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { batch, signal } from '@preact/signals-core'
import { createExecutor } from '@src/lib/executors/executor'
import {
  executorCapabilityValueSpec,
  executorsService,
  type Executor,
  type ExecutorsService,
  type ExecutorViewTab,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import { createOpenExecutorCommand } from '@src/lib/executors/commands'
import { viewsForSource } from '@src/lib/executors/views'
import { editorsService } from '@src/lib/editors/registry/contract'
import { provideCommand } from '@src/registry/contracts/commands'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Owns explicitly created executors, without owning editors, files, or their contents. */
const extension = defineRegistryItemFactory(({ valueSpecs, services }) => {
  const executors = signal<readonly Executor[]>([])
  const viewTabs = signal<readonly ExecutorViewTab[]>([])
  const capabilities = valueSpecs.signal(executorCapabilityValueSpec)
  const views = valueSpecs.signal(executorViewValueSpec)
  const disposers = new Map<symbol, () => void>()
  const service: ExecutorsService = {
    executors,
    viewTabs,
    openView: (editor, viewId) =>
      batch(() => {
        const tab = { executor: service.createExecutor(editor), viewId }
        viewTabs.value = [...viewTabs.peek(), tab]
        return tab
      }),
    setView: (id, viewId) => {
      const tab = viewTabs.peek().find(({ executor }) => executor.id === id)
      if (!tab || tab.viewId === viewId) return
      if (
        !viewsForSource(
          editorMatchContext(tab.executor.editor),
          capabilities.peek(),
          views.peek()
        ).some((view) => view.id === viewId)
      )
        return
      viewTabs.value = viewTabs
        .peek()
        .map((current) => (current === tab ? { ...tab, viewId } : current))
    },
    createExecutor: (editor) => {
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
      batch(() => {
        viewTabs.value = viewTabs.peek().filter((tab) => tab.executor.id !== id)
        executors.value = executors
          .peek()
          .filter((executor) => executor.id !== id)
      })
    },
  }
  const openCommand = createOpenExecutorCommand(
    service,
    () => services.get(editorsService),
    () => services.optional(projectSessionService),
    () => services.get(fileOperationsService),
    capabilities,
    views
  )
  return {
    id: 'executors',
    provides: [provideCommand(openCommand)],
    providesServices: [provideService(executorsService, service)],
    dispose: () => {
      openCommand.onCancel?.()
      for (const dispose of disposers.values()) dispose()
      disposers.clear()
      executors.value = []
      viewTabs.value = []
    },
  }
}, 'executors')

export default withProjectShellFeature(extension, 'executors')
