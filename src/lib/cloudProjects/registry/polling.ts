import { computed, effect } from '@preact/signals-core'
import { watchCloudProject } from '@src/lib/cloudProjects/polling'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'
import { extension as defineExtension, type Extension } from 'plankton'
export const cloudProjectPollingExtension: Extension = defineExtension({
  key: 'cloud-project-polling',
  create: (_dependencies, ctx) => {
    const clouds = computed(() => ctx.optional(cloudStorageService))
    const sessions = computed(() => ctx.optional(projectSession))
    const files = computed(() => ctx.optional(fileOperationsService))
    const routers = computed(() => ctx.optional(routerService))
    const currentProject = computed(() => sessions.value?.project.value)
    const currentId = computed(
      () => currentProject.value?.projectIORefSignal.value.cloudProjectId
    )
    let disposed = false
    let stop: (() => void) | undefined
    queueMicrotask(() => {
      if (disposed) return
      stop = effect(() => {
        const cloud = clouds.value
        const session = sessions.value
        const project = currentProject.value
        const id = currentId.value
        const fileOperations = files.value
        const router = routers.value
        if (!cloud || !session || !project || !id || !fileOperations || !router)
          return
        return watchCloudProject({
          cloud,
          session,
          project,
          id,
          fileOperations,
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
})
