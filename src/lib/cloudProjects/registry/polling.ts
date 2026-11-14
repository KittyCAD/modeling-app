import { computed, effect } from '@preact/signals-core'
import { watchCloudProject } from '@src/lib/cloudProjects/polling'
import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { extension as defineExtension, type Extension } from 'plankton'
export const cloudProjectPollingExtension: Extension = defineExtension({
  dependencies: {
    cloudProjects: cloudProjectsObservations,
    projectSession: projectSessionObservations,
    fileOperations: fileOperationsObservations,
    router: routerObservations,
  },
  key: 'cloud-project-polling',
  create: ({
    cloudProjects: cloudProjectsInputs,
    projectSession: projectSessionInputs,
    fileOperations: fileOperationsInputs,
    router: routerInputs,
  }) => {
    const clouds = cloudProjectsInputs.cloudStorageService.current
    const sessions = projectSessionInputs.projectSession.current
    const files = fileOperationsInputs.fileOperationsService.current
    const routers = routerInputs.routerService.current
    const currentProject = computed(() => sessions.value?.project.value)
    const currentId = computed(
      () => currentProject.value?.projectIORefSignal.value.cloudProjectId
    )
    return {
      start: () =>
        effect(() => {
          const cloud = clouds.value
          const session = sessions.value
          const project = currentProject.value
          const id = currentId.value
          const fileOperations = files.value
          const router = routers.value
          if (
            !cloud ||
            !session ||
            !project ||
            !id ||
            !fileOperations ||
            !router
          )
            return
          return watchCloudProject({
            cloud,
            session,
            project,
            id,
            fileOperations,
            router,
          })
        }),
    }
  },
})
