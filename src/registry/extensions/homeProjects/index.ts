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
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type HomeProjectActionsService,
  type HomeProjectEntryContribution,
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import type { AnyActorRef } from 'xstate'

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined
): HomeProjectEntryContribution[] {
  return projects?.map(homeProjectEntryFromProject) ?? []
}

function sendSystemIOEventAndWaitForMutationRefresh({
  actor,
  event,
  mutationState,
  isRefreshComplete,
}: {
  actor: AnyActorRef
  event: Parameters<AnyActorRef['send']>[0]
  mutationState:
    | SystemIOMachineStates.renamingProject
    | SystemIOMachineStates.deletingProject
  isRefreshComplete?: (snapshot: SystemIOMutationSnapshot) => boolean
}) {
  return new Promise<void>((resolve) => {
    let sawMutationState = false
    let sawRefreshState = false
    let settled = false
    let subscription: { unsubscribe: () => void } | undefined

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      subscription?.unsubscribe()
      resolve()
    }
    const timeout = setTimeout(finish, 5000)
    const mutationRefreshComplete = (snapshot: SystemIOMutationSnapshot) =>
      snapshot.matches(SystemIOMachineStates.idle) &&
      (!isRefreshComplete || !sawRefreshState || isRefreshComplete(snapshot))

    subscription = actor.subscribe((snapshot: SystemIOMutationSnapshot) => {
      if (snapshot.matches(mutationState)) {
        sawMutationState = true
      }
      if (snapshot.matches(SystemIOMachineStates.readingFolders)) {
        sawRefreshState = true
      }
      if (sawMutationState && mutationRefreshComplete(snapshot)) {
        finish()
      }
    })

    actor.send(event)

    const snapshot = actor.getSnapshot() as SystemIOMutationSnapshot
    if (snapshot.matches(mutationState)) {
      sawMutationState = true
    }
    if (snapshot.matches(SystemIOMachineStates.readingFolders)) {
      sawRefreshState = true
    }
    if (
      (!sawMutationState && snapshot.matches(SystemIOMachineStates.idle)) ||
      (sawMutationState && mutationRefreshComplete(snapshot))
    ) {
      finish()
    }
  })
}

type SystemIOMutationSnapshot = {
  matches: (state: SystemIOMachineStates) => boolean
  context?: {
    folders?: Project[]
  }
}

function refreshedFoldersIncludeProjectDisplayName(
  snapshot: SystemIOMutationSnapshot,
  requestedName: string
) {
  return Boolean(
    snapshot.context?.folders?.some(
      (folder) => getProjectDisplayName(folder) === requestedName
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

      const actor = systemIO.value?.actor
      if (!actor) {
        return
      }

      await sendSystemIOEventAndWaitForMutationRefresh({
        actor,
        mutationState: SystemIOMachineStates.renamingProject,
        isRefreshComplete: (snapshot) =>
          refreshedFoldersIncludeProjectDisplayName(snapshot, requestedName),
        event: {
          type: SystemIOMachineEvents.renameProject,
          data: {
            requestedProjectName: requestedName,
            projectName: project.localProjectName,
            redirect: false,
          },
        },
      })
    },
    delete: async (project) => {
      if (!serviceImpl.canDelete(project) || !project.localProjectName) {
        return
      }

      const actor = systemIO.value?.actor
      if (!actor) {
        return
      }

      await sendSystemIOEventAndWaitForMutationRefresh({
        actor,
        mutationState: SystemIOMachineStates.deletingProject,
        event: {
          type: SystemIOMachineEvents.deleteProject,
          data: {
            requestedProjectName: project.localProjectName,
          },
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
