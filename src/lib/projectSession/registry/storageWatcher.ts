import { computed, effect } from '@preact/signals-core'
import { watchProjectStorage } from '@src/lib/projectSession/watchStorage'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { observations as projectLibrariesObservations } from '@src/registry/contracts/projectLibraries'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { extension as defineExtension, type Extension } from 'plankton'
export default defineExtension({
  dependencies: {
    projectSession: projectSessionObservations,
    fileOperations: fileOperationsObservations,
    projectLibraries: projectLibrariesObservations,
    router: routerObservations,
  },
  key: 'project-session.storage-watcher',
  create: ({
    projectSession: projectSessionInputs,
    fileOperations: fileOperationsInputs,
    projectLibraries: projectLibrariesInputs,
    router: routerInputs,
  }) => {
    const sessions = computed(
      () => projectSessionInputs.projectSession.current.value
    )
    const files = computed(
      () => fileOperationsInputs.fileOperationsService.current.value
    )
    const libraries = computed(
      () => projectLibrariesInputs.projectLibrariesService.current.value
    )
    const routers = computed(() => routerInputs.routerService.current.value)
    const currentProject = computed(() => sessions.value?.project.value)
    const currentPath = computed(() => currentProject.value?.path)
    let disposed = false
    let stop: (() => void) | undefined
    queueMicrotask(() => {
      if (disposed) return
      stop = effect(() => {
        const session = sessions.value
        const project = currentProject.value
        const path = currentPath.value
        const fileOperations = files.value
        const projectLibraries = libraries.value
        const router = routers.value
        if (
          !session ||
          !project ||
          !path ||
          !fileOperations ||
          !projectLibraries ||
          !router
        )
          return
        return watchProjectStorage({
          path,
          storage: session.storageFor(path),
          isCurrent: () => session.project.peek() === project,
          fileOperations,
          projectLibraries,
          session,
          router,
        })
      })
    })
    return {
      items: [],
      dispose: () => {
        disposed = true
        stop?.()
      },
    }
  },
}) satisfies Extension
