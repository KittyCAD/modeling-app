import { computed, effect } from '@preact/signals-core'
import { watchCloudProject } from '@src/lib/cloudProjects/polling'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'
import { type Subtree } from 'plankton'
export const cloudProjectPollingExtension: Subtree = {
  key: 'cloud-project-polling',
  create: (ctx) => {
    const clouds = computed(() => ctx.optional(cloudStorageService))
    const sessions = computed(() => ctx.optional(projectSession))
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
        if (!cloud || !session || !project || !id) return
        return watchCloudProject({
          cloud,
          session,
          project,
          id,
          fileOperations: ctx.required(fileOperationsService),
          router: ctx.required(routerService),
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
}
