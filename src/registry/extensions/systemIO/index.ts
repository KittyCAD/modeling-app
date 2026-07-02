import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import {
  getProjectInfo,
  readRecentProjectsForEnvironment,
  recentProjectsRevisionSignal,
} from '@src/lib/desktop'
import {
  getOpfsCloudProjectMetadataIndex,
  getOpfsCloudProjectModifiedTime,
  opfsCloudSyncStatus,
} from '@src/lib/fs-zds/opfsCloud'
import {
  type ProjectHandle,
  type ProjectHandles,
  type Projects,
  type SystemIOService,
  projectHandlesValueSpec,
  projectsValueSpec,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

function normalizeProjectPathForCloudMetadata(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
}

export async function listProjectHandlesFromRecentProjects(
  environmentName?: string
): Promise<readonly ProjectHandle[]> {
  const recentProjects = await readRecentProjectsForEnvironment(environmentName)
  return recentProjects.map((project) => ({ path: project.path }))
}

const refreshProjectHandlesForSignalInputs = (
  _recentProjectsRevision: unknown,
  _cloudLastSyncedAt: unknown,
  refreshProjectHandles: SystemIOService['refreshProjectHandles']
) => {
  void refreshProjectHandles()
}

export const systemIOExtension = defineRegistryItemFactory((ctx) => {
  const recentProjectHandles = signal<ProjectHandles>(undefined)
  const projectHandles = ctx.valueSpecs.signal(projectHandlesValueSpec)
  const projects = ctx.valueSpecs.signal(projectsValueSpec)
  let latestRefreshId = 0
  let disposed = false
  let disposeRecentProjectsEffect: (() => void) | undefined

  const refreshProjectHandles: SystemIOService['refreshProjectHandles'] =
    async () => {
      const refreshId = ++latestRefreshId
      const nextProjectHandles = await listProjectHandlesFromRecentProjects()

      if (!disposed && refreshId === latestRefreshId) {
        recentProjectHandles.value = nextProjectHandles
      }

      return nextProjectHandles
    }

  const activate = () => {
    disposeRecentProjectsEffect = effect(() => {
      refreshProjectHandlesForSignalInputs(
        recentProjectsRevisionSignal.value,
        opfsCloudSyncStatus.value.lastSyncedAt,
        refreshProjectHandles
      )
    })
    return undefined
  }

  const serviceImpl: SystemIOService = {
    projectHandles,
    projects,
    refreshProjectHandles,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-extension',
      provides: [
        provide(projectHandlesValueSpec, recentProjectHandles, {
          key: 'system-io.recent-projects',
        }),
      ],
      providesServices: [provideService(systemIOService, serviceImpl)],
      activate,
      dispose: () => {
        disposed = true
        disposeRecentProjectsEffect?.()
      },
    }),
  }
}, 'system-io-extension')

export const systemIOProjectsExtension = defineRegistryItemFactory((ctx) => {
  const projectHandles = ctx.valueSpecs.signal(projectHandlesValueSpec)
  const projects = signal<Projects>(undefined)
  let latestRefreshId = 0
  let disposed = false
  let disposeProjectHandlesEffect: (() => void) | undefined

  const getWasmPromise = () => ctx.valueSpecs.get(wasmPromiseValueSpec)

  const refreshProjectsFromHandles = async (handles: ProjectHandles) => {
    const refreshId = ++latestRefreshId

    if (handles === undefined) {
      projects.value = undefined
      return
    }

    if (handles.length === 0) {
      projects.value = []
      return
    }

    const wasmPromise = getWasmPromise()
    if (!wasmPromise) {
      projects.value = []
      return
    }

    const wasmInstance = await wasmPromise
    const cloudProjectMetadataByPath = opfsCloudSyncStatus.value.enabled
      ? await getOpfsCloudProjectMetadataIndex().catch(() => new Map())
      : new Map()
    const nextProjects: NonNullable<Projects> = []

    for (const handle of handles) {
      try {
        const project = await getProjectInfo(handle.path, wasmInstance)
        const cloudMetadata = cloudProjectMetadataByPath.get(
          normalizeProjectPathForCloudMetadata(handle.path)
        )
        project.cloudProjectId ??= cloudMetadata?.remoteProjectId
        if (project.metadata) {
          project.metadata.modified = getOpfsCloudProjectModifiedTime(
            cloudMetadata,
            project.metadata.modified
          )
        }

        if (project.kcl_file_count === 0 && project.readWriteAccess) {
          continue
        }

        nextProjects.push(project)
      } catch {
        // Ignore handles that no longer point at readable projects.
      }
    }

    if (!disposed && refreshId === latestRefreshId) {
      projects.value = nextProjects
    }
  }

  const activate = () => {
    disposeProjectHandlesEffect = effect(() => {
      void refreshProjectsFromHandles(projectHandles.value)
    })
    return undefined
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-projects-extension',
      provides: [
        provide(projectsValueSpec, projects, {
          key: 'system-io.project-handles',
        }),
      ],
      activate,
      dispose: () => {
        disposed = true
        disposeProjectHandlesEffect?.()
      },
    }),
  }
}, 'system-io-projects-extension')

const systemIORegistryItem = defineRegistryItem({
  id: 'systemIO',
  uses: [systemIOExtension, systemIOProjectsExtension],
})

export default systemIORegistryItem
