import { defineRegistryItemFactory } from '@kittycad/registry'
import { computed, effect } from '@preact/signals-core'
import { watchProjectStorage } from '@src/lib/projectSession/watchStorage'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectLibrariesService } from '@src/registry/contracts/projectLibraries'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'

export default defineRegistryItemFactory((ctx) => {
  const sessions = ctx.services.signal(projectSession)
  const files = ctx.services.signal(fileOperationsService)
  const libraries = ctx.services.signal(projectLibrariesService)
  const routers = ctx.services.signal(routerService)
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
    id: 'project-session.storage-watcher',
    dispose: () => {
      disposed = true
      stop?.()
    },
  }
}, 'project-session.storage-watcher')
