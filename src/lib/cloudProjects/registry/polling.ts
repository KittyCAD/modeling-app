import { defineRegistryItemFactory } from '@kittycad/registry'
import { computed, effect } from '@preact/signals-core'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { projectSession } from '@src/registry/contracts/projectSession'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { routerService } from '@src/registry/contracts/router'
import { watchCloudProject } from '@src/lib/cloudProjects/polling'

export const cloudProjectPollingExtension = defineRegistryItemFactory((ctx) => {
  const clouds = ctx.services.signal(cloudStorageService)
  const sessions = ctx.services.signal(projectSession)
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
        fileOperations: ctx.services.get(fileOperationsService),
        router: ctx.services.get(routerService),
      })
    })
  })
  return {
    id: 'cloud-project-polling',
    dispose: () => {
      disposed = true
      stop?.()
    },
  }
}, 'cloud-project-polling')
