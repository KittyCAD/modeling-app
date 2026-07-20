import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import {
  getProjectInfo,
  writeProjectTitleToProjectToml,
} from '@src/lib/desktop'
import {
  getHomeProjectDisplayName,
  homeProjectEntryFromProject,
} from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  getDefaultDirectoryProjectLibraryPath,
  type ProjectLibrary,
  projectLibraryFromSetting,
} from '@src/lib/projectLibraries'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectActionsService,
  type HomeProjectEntry,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { projectLibrariesValueSpec } from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import toast from 'react-hot-toast'

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined,
  libraryId?: string
): HomeProjectEntryContribution[] {
  return (
    projects?.map((project) => ({
      ...homeProjectEntryFromProject(project),
      libraryId,
    })) ?? []
  )
}

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
        (project.readWriteAccess && project.defaultFile) ||
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
      if (!serviceImpl.canRename(project) || !project.localProjectPath) {
        return
      }

      if (
        homeProjectDisplayNameExists({
          entries: ctx.valueSpecs.get(homeProjectEntriesValueSpec),
          requestedName,
          projectId: project.id,
        })
      ) {
        const message = `Project with title "${requestedName}" already exists`
        toast.error(message)
        return Promise.reject(new Error(message))
      }

      await writeProjectTitleToProjectToml(
        project.localProjectPath,
        requestedName
      )
      toast.success(
        `Successfully renamed "${getHomeProjectDisplayName(project)}" to "${requestedName}"`
      )
      systemIO.value?.actor.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
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
          service.actor.getSnapshot().context.folders,
          DEFAULT_PROJECT_LIBRARY_ID
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

const configuredProjectLibraries = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const libraries = computed<ProjectLibrary[]>(() => {
    const currentSettings = settings.value?.current.value
    if (!currentSettings) {
      return []
    }

    const defaultProjectDirectory = getDefaultDirectoryProjectLibraryPath(
      currentSettings.app.libraries.current
    )

    return currentSettings.app.libraries.current.map((library, index) => ({
      ...projectLibraryFromSetting(library, index, {
        defaultProjectDirectory,
      }),
      icon: 'folder',
      order: index,
    }))
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.configured-project-libraries',
      provides: [
        provide(projectLibrariesValueSpec, libraries, {
          key: 'home-projects.configured-project-libraries',
        }),
      ],
    }),
  }
}, 'home-projects.configured-project-libraries')

const homeProjectsExtension = defineRegistryItem({
  id: 'home-projects',
  uses: [
    configuredProjectLibraries,
    homeProjectActions,
    systemIOLocalHomeProjectEntries,
  ],
})

export default homeProjectsExtension
