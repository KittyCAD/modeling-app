import fsZds from '@src/lib/fs-zds'
import { listRemoteProjectLibraries } from '@src/lib/fs-zds/cloud/api'
import {
  apiProjectLibraries,
  apiProjectLibraryId,
  isApiProjectLibrary,
} from '@src/lib/projectLibraries/apiProjectLibraries'
import { runtimeService } from '@src/registry/contracts/runtime'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'

import { computed, effect, signal } from '@preact/signals-core'

import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  getDefaultCloudProjectLibrarySetting,
} from '@src/lib/projectLibraries'

import {
  cloudStorageService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'

import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'

import {
  homeProjectEntriesValueSpec,
  homeProjectLoadingLibraryIdsValueSpec,
  homeProjectSettledLibraryIdsValueSpec,
  type HomeProjectEntryContribution,
} from '@src/registry/contracts/homeProjects'

import { authService } from '@src/registry/contracts/auth'

import { routerService } from '@src/registry/contracts/router'
import { pollProjectList } from '@src/lib/projectListPolling'
import { PATHS } from '@src/lib/paths'

import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

import { getProjectInfo, readAppSettingsFile } from '@src/lib/desktop'

import { newKclFile } from '@src/lang/project'

import { collectProjectFilesForUpload } from '@src/lib/projectSession/projectFiles'

import {
  PROJECT_ENTRYPOINT,
  DEFAULT_DEFAULT_LENGTH_UNIT,
} from '@src/lib/constants'

import { isErr, reportRejection } from '@src/lib/trap'

import { getHomeProjectDisplayName } from '@src/lib/homeProjects'

import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'

/** Cloud library entries come from the server; configured legacy disk paths are never opened. */
export default defineRegistryItemFactory((ctx) => {
  const cloud = () => ctx.services.get(cloudStorageService)
  const operations = () => ctx.services.get(fileOperationsService)
  const wasm = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise.'))
  const auth = ctx.services.signal(authService)
  const router = ctx.services.signal(routerService)
  const runtime = ctx.services.signal(runtimeService)
  const libraries = signal<ReturnType<typeof apiProjectLibraries>>([])
  const refreshCatalog = signal(0)
  const libraryIds = computed(() => [
    PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
    ...libraries.value.map((library) => library.id),
  ])
  let stopCatalog = () => {}
  const onVisibilityChange = () => {
    if (!document.hidden) refreshCatalog.value += 1
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const settledAccount = signal<{ id: string | undefined } | undefined>(
    undefined
  )
  let disposed = false
  let stop = () => {}
  queueMicrotask(() => {
    if (disposed) return
    let scope: string | undefined
    stopCatalog = effect(() => {
      const token = auth.value?.token.value
      const account = auth.value?.user.value?.id
      const baseUrl = runtime.value?.current.value.apiBaseUrl
      const loggedIn = auth.value?.isLoggedIn.value
      void refreshCatalog.value
      const nextScope = JSON.stringify([token, account, baseUrl, loggedIn])
      if (scope !== nextScope) {
        scope = nextScope
        libraries.value = []
      }
      if (!loggedIn || !token) return
      const controller = new AbortController()
      void listRemoteProjectLibraries(
        { enabled: true, token, baseUrl },
        controller.signal
      )
        .then((result) => {
          if (!controller.signal.aborted && !disposed)
            libraries.value = apiProjectLibraries(result)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !disposed) reportRejection(error)
        })
      return () => controller.abort()
    })
    stop = effect(() => {
      const loggedIn = auth.value?.isLoggedIn.value
      const token = auth.value?.token.value
      const location = router.value?.location.value
      void token
      if (
        !loggedIn ||
        !(
          location?.pathname === PATHS.HOME ||
          location?.pathname.startsWith(`${PATHS.LIBRARY}/`)
        )
      )
        return
      const accountId = auth.value?.user.value?.id
      return pollProjectList(async () => {
        // Manual refresh uses the same backend. Never overlap its pending request.
        if (cloud().projectsLoading.peek()) return false
        const previous = JSON.stringify(cloud().projects.peek())
        try {
          const projects = await cloud().listProjects()
          return previous !== JSON.stringify(projects)
        } finally {
          if (!disposed && auth.peek()?.user.peek()?.id === accountId)
            settledAccount.value = { id: accountId }
        }
      }, reportRejection)
    })
  })

  const entries = computed<readonly HomeProjectEntryContribution[]>(() => {
    if (!auth.value?.isLoggedIn.value) return []
    const thumbnails = cloud().thumbnails.value
    return cloud()
      .projects.value.filter(
        (project) =>
          project.library_id || project.access?.scope !== 'organization'
      )
      .map((project) => ({
        id: `cloud:${project.id}`,
        source: 'remote',
        status: 'cloud-only',
        name: project.id,
        title: project.title ?? 'Untitled',
        remoteProjectId: project.id,
        localProjectPath: fsZds.join(cloud().root, project.id),
        thumbnail: thumbnails.has(project.id)
          ? { type: 'remote', url: thumbnails.get(project.id)! }
          : undefined,
        libraryIds: [
          project.library_id
            ? apiProjectLibraryId(project.library_id)
            : PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
        ],
        readWriteAccess: project.access?.can_edit ?? true,
        deleteRemoteOnDelete: true,
        modified:
          typeof project.updated_at === 'string'
            ? Date.parse(project.updated_at)
            : undefined,
      }))
  })
  const projectInfo = async (id: string) => {
    const path = await cloud().openProject(id)
    const project = await getProjectInfo(operations(), path, await wasm())
    return {
      ...project,
      cloudProjectId: id,
      libraryPath: cloud().root,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    }
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (
      [...cloud().saves.peek().values()].some((save) => save.state !== 'saved')
    ) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', beforeUnload)
  return {
    id: 'cloud-projects',
    provides: [
      provide(
        homeProjectSettledLibraryIdsValueSpec,
        computed(() => {
          const account = settledAccount.value
          return auth.value?.isLoggedIn.value &&
            account &&
            account.id === auth.value.user.value?.id
            ? libraryIds.value
            : []
        }),
        { key: 'cloud-projects.settled' }
      ),
      provide(
        homeProjectLoadingLibraryIdsValueSpec,
        computed(() =>
          auth.value?.isLoggedIn.value && cloud().projectsLoading.value
            ? libraryIds.value
            : []
        ),
        { key: 'cloud-projects.loading' }
      ),
      provide(
        projectLibraryTypesValueSpec,
        computed(() => ({
          type: CLOUD_PROJECT_LIBRARY_TYPE,
          title: 'Cloud',
          libraries: libraries.value,
        }))
      ),
      provide(homeProjectEntriesValueSpec, entries, {
        key: 'cloud-projects.entries',
      }),
      provide(projectLibrarySettingDefaultPoliciesValueSpec, {
        id: 'cloud-projects.defaults',
        priority: 100,
        getDefaultLibraries: ({ isDesktop }) =>
          isDesktop ? undefined : [getDefaultCloudProjectLibrarySetting()],
      }),
      provide(projectLibraryTypesValueSpec, {
        type: CLOUD_PROJECT_LIBRARY_TYPE,
        title: 'Cloud',
        icon: 'cloud',
        order: 10,
        defaultSetting: getDefaultCloudProjectLibrarySetting(),
        readRealizations: async () => [],
        operations: {
          createProject: {
            isAvailable: ({ library }) => !isApiProjectLibrary(library),
            run: async ({
              requestedProjectTitle,
              initialKclFile,
              initialProject,
            }) => {
              const instance = await wasm()
              const settings = await readAppSettingsFile(operations(), instance)
              const code =
                initialKclFile?.code ??
                newKclFile(
                  undefined,
                  settings.settings?.modeling?.base_unit ??
                    DEFAULT_DEFAULT_LENGTH_UNIT,
                  instance
                )
              if (isErr(code)) return Promise.reject(code)
              const archive = initialProject
                ? initialProject.files.map((file) => ({
                    relativePath: file.requestedFileName,
                    data: file.requestedData,
                  }))
                : [
                    {
                      relativePath:
                        initialKclFile?.fileName ?? PROJECT_ENTRYPOINT,
                      data: new TextEncoder().encode(code),
                    },
                  ]
              const created = await cloud().createProject(
                requestedProjectTitle,
                archive
              )
              return projectInfo(created.id)
            },
          },
          openProject: {
            run: async ({ project }) => {
              if (!project.remoteProjectId) return undefined
              const info = await projectInfo(project.remoteProjectId)
              return {
                localProjectPath: info.path,
                defaultFile: info.default_file,
              }
            },
          },
          renameProject: {
            isAvailable: ({ library }) => !isApiProjectLibrary(library),
            run: async ({ project, requestedName }) => {
              if (project.remoteProjectId)
                await cloud().renameProject(
                  project.remoteProjectId,
                  requestedName
                )
            },
          },
          deleteProject: {
            isAvailable: ({ library }) => !isApiProjectLibrary(library),
            run: async ({ project }) => {
              if (project.remoteProjectId)
                await cloud().deleteProject(project.remoteProjectId)
            },
          },
          duplicateProject: {
            isAvailable: ({ library }) => !isApiProjectLibrary(library),
            run: async ({ project }) => {
              if (!project.remoteProjectId) return undefined
              const title = `${getHomeProjectDisplayName(project)}-copy`
              const created = await cloud().duplicateProject(
                project.remoteProjectId,
                title
              )
              return {
                name: created.id,
                title,
                message: `Successfully duplicated "${getHomeProjectDisplayName(project)}"`,
              }
            },
          },
          cloneProjectFrom: {
            canCloneProject: ({ project }) => Boolean(project.remoteProjectId),
            run: async ({ project }) => {
              if (!project.remoteProjectId) return undefined
              const info = await projectInfo(project.remoteProjectId)
              return {
                localProjectPath: info.path,
                localProjectName: getHomeProjectDisplayName(project),
                defaultFile: info.default_file,
              }
            },
          },
          cloneProjectTo: {
            isAvailable: ({ library }) => !isApiProjectLibrary(library),
            run: async ({ source, project, requestedProjectTitle }) => {
              const archive =
                source.files ??
                (await collectProjectFilesForUpload({
                  fileOperations: operations(),
                  projectRoot: source.localProjectPath,
                  includeIgnored: true,
                }))
              const created = await cloud().createProject(
                requestedProjectTitle ?? getHomeProjectDisplayName(project),
                archive
              )
              const info = await projectInfo(created.id)
              invalidateProjectLibraryRealizations()
              return {
                localProjectPath: info.path,
                defaultFile: info.default_file,
              }
            },
          },
        },
      }),
    ],
    dispose: () => {
      disposed = true
      stop()
      stopCatalog()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', beforeUnload)
    },
  }
}, 'cloud-projects')
