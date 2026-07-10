import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { getProjectInfo } from '@src/lib/desktop'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

function homeProjectDisplayNameExists({
  entries,
  requestedName,
  projectId,
}: {
  entries: readonly HomeProjectEntry[] | undefined
  requestedName: string
  projectId: string
}) {
  return Boolean(
    entries?.some(
      (project) =>
        project.id !== projectId &&
        getHomeProjectDisplayName(project) === requestedName
    )
  )
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
        (project.readWriteAccess && project.localProjectPath) ||
          project.defaultFile ||
          project.remoteProjectId
      ),
    canRename: (project) =>
      Boolean(project.localProjectPath && project.readWriteAccess),
    canDelete: (project) =>
      Boolean(project.localProjectName && project.readWriteAccess),
    open: async (project) => {
      if (project.readWriteAccess && project.defaultFile) {
        return { defaultFile: project.defaultFile }
      }

      if (project.readWriteAccess && project.localProjectPath) {
        const projectInfo = await systemIO.value?.request({
          type: 'project.loadTree',
          projectPath: project.localProjectPath,
        })
        return projectInfo?.default_file
          ? { defaultFile: projectInfo.default_file }
          : undefined
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
      await systemIO.value?.refreshLocalProjects()
      return { defaultFile: projectInfo.default_file }
    },
    rename: async (project, requestedName) => {
      if (
        !serviceImpl.canRename(project) ||
        !project.localProjectPath ||
        !project.localProjectName
      ) {
        return
      }

      if (
        homeProjectDisplayNameExists({
          entries: ctx.valueSpecs.get(homeProjectEntriesValueSpec),
          requestedName,
          projectId: project.id,
        })
      ) {
        const message = `Project with name "${requestedName}" already exists`
        toast.error(message)
        return Promise.reject(new Error(message))
      }

      await systemIO.value?.request({
        type: 'project.rename',
        projectName: project.localProjectName,
        requestedProjectName: requestedName,
      })
      toast.success(
        `Successfully renamed "${getHomeProjectDisplayName(project)}" to "${requestedName}"`
      )
    },
    delete: async (project) => {
      if (!serviceImpl.canDelete(project) || !project.localProjectName) {
        return
      }

      await systemIO.value?.request({
        type: 'project.delete',
        projectName: project.localProjectName,
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

      const disposeEntriesEffect = effect(() => {
        entries.value = service.localProjectEntriesSignal.value
      })
      systemIOSubscription = {
        unsubscribe: disposeEntriesEffect,
      }
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
