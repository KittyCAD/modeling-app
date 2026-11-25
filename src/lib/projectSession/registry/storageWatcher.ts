import { computed, effect } from '@preact/signals-core'
import { watchProjectStorage } from '@src/lib/projectSession/watchStorage'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { observations as projectLibrariesObservations } from '@src/registry/contracts/projectLibraries'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { factory as defineFactory, type Factory } from 'plankton'
export default defineFactory({
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
    const sessions = projectSessionInputs.projectSession.current
    const files = fileOperationsInputs.fileOperationsService.current
    const libraries = projectLibrariesInputs.projectLibrariesService.current
    const routers = routerInputs.routerService.current
    const currentProject = computed(() => sessions.value?.project.value)
    const currentPath = computed(() => currentProject.value?.path)
    return {
      start: () =>
        effect(() => {
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
        }),
    }
  },
}) satisfies Factory
