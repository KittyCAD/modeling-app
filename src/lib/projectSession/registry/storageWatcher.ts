import { computed, effect } from '@preact/signals-core'
import { watchProjectStorage } from '@src/lib/projectSession/watchStorage'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectLibrariesService } from '@src/registry/contracts/projectLibraries'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'
import { type Subtree } from 'plankton'
export default {
  key: 'project-session.storage-watcher',
  create: (ctx) => {
    const sessions = computed(() => ctx.optional(projectSession))
    const files = computed(() => ctx.optional(fileOperationsService))
    const libraries = computed(() => ctx.optional(projectLibrariesService))
    const routers = computed(() => ctx.optional(routerService))
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
} satisfies Subtree
