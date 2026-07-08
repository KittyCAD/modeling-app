import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { getProjectInfo } from '@src/lib/desktop'
import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectActionsService,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined
): HomeProjectEntryContribution[] {
  return projects?.map(homeProjectEntryFromProject) ?? []
}

const homeProjectActions = defineRegistryItemFactory((ctx) => {
  const systemIO = ctx.services.signal(systemIOService)
  const cloudSync = ctx.services.signal(cloudSyncService)

  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise registry value.'))

  const serviceImpl: HomeProjectActionsService = {
    canOpen: (project) =>
      Boolean(
        (project.readWriteAccess && project.defaultFile) ||
          project.remoteProjectId
      ),
    canRename: (project) =>
      Boolean(project.localProjectName && project.readWriteAccess),
    canDelete: (project) =>
      Boolean(project.localProjectName && project.readWriteAccess),
    open: async (project) => {
      if (project.readWriteAccess && project.defaultFile) {
        return { defaultFile: project.defaultFile }
      }

      if (!project.remoteProjectId) {
        return undefined
      }

      const syncedProject = await cloudSync.value?.ensureProjectLocallySynced(
        project.remoteProjectId
      )
      if (!syncedProject) {
        return undefined
      }

      const projectInfo = await getProjectInfo(
        syncedProject.projectPath,
        await getWasmPromise()
      )
      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
      return { defaultFile: projectInfo.default_file }
    },
    rename: async (project, requestedName) => {
      if (!serviceImpl.canRename(project) || !project.localProjectName) {
        return
      }

      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.renameProject,
        data: {
          requestedProjectName: requestedName,
          projectName: project.localProjectName,
          redirect: false,
        },
      })
    },
    delete: async (project) => {
      if (!serviceImpl.canDelete(project) || !project.localProjectName) {
        return
      }

      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.deleteProject,
        data: {
          requestedProjectName: project.localProjectName,
        },
      })
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.actions',
      providesServices: [
        provideService(homeProjectActionsService, serviceImpl),
      ],
    }),
  }
}, 'home-projects.actions')

const systemIOLocalHomeProjectEntries = defineRegistryItemFactory((ctx) => {
  const entries = signal<HomeProjectEntryContribution[]>([])
  const systemIO = ctx.services.signal(systemIOService)
  let systemIOSubscription: { unsubscribe: () => void } | undefined
  let disposeSystemIOEffect: (() => void) | undefined
  let disposed = false

  queueMicrotask(() => {
    if (disposed) {
      return
    }

    disposeSystemIOEffect = effect(() => {
      const service = systemIO.value
      systemIOSubscription?.unsubscribe()
      systemIOSubscription = undefined
      entries.value = []

      if (!service) {
        return
      }

      const updateEntries = () => {
        entries.value = localHomeProjectEntriesFromProjects(
          service.actor.getSnapshot().context.folders
        )
      }

      updateEntries()
      systemIOSubscription = service.actor.subscribe(updateEntries)
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.system-io-local-projects',
      provides: [
        provide(homeProjectEntriesValueSpec, entries, {
          key: 'home-projects.system-io-local-projects',
        }),
      ],
      dispose: () => {
        disposed = true
        disposeSystemIOEffect?.()
        systemIOSubscription?.unsubscribe()
      },
    }),
  }
}, 'home-projects.system-io-local-projects')

const homeProjectsExtension = defineRegistryItem({
  id: 'home-projects',
  uses: [homeProjectActions, systemIOLocalHomeProjectEntries],
})

export default homeProjectsExtension
