import { computed, effect, signal } from '@preact/signals-core'
import { cloudLibrariesSettingsContribution } from '@src/lib/cloudProjects/CloudLibrariesSetting'
import { createCloudProjectCommands } from '@src/lib/cloudProjects/commands'
import { newKclFile } from '@src/lang/project'
import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
import {
  listRemoteProjectLibraries,
  createRemoteProjectLibrary,
} from '@src/lib/cloudProjects/runtime/api'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getProjectInfo, readAppSettingsFile } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { isOffline } from '@src/lib/networkStatus'
import { PATHS } from '@src/lib/paths'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import {
  apiProjectLibraries,
  apiProjectLibraryId,
  getApiProjectLibraryId,
} from '@src/lib/projectLibraries/apiProjectLibraries'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import { collectProjectFilesForUpload } from '@src/lib/projectSession/projectFiles'
import { isErr, reportRejection } from '@src/lib/trap'
import { observations as authObservations } from '@src/registry/contracts/auth'
import { commandsFacet } from '@src/registry/contracts/commands'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesFacet,
  homeProjectLoadingLibraryIdsFacet,
  homeProjectSettledLibraryIdsFacet,
} from '@src/registry/contracts/homeProjects'
import {
  projectLibrarySettingDefaultPoliciesFacet,
  projectLibraryTypesFacet,
} from '@src/registry/contracts/projectLibraries'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { runtimeService } from '@src/registry/contracts/runtime'
import { settingsFacet } from '@src/registry/contracts/settings'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { observeService } from '@src/registry/inputs'
import {
  factory as defineFactory,
  contribute,
  type InputOf,
  type Factory,
} from 'plankton'

/** Cloud library entries come from the server; configured legacy disk paths are never opened. */
export default defineFactory({
  dependencies: {
    cloudProjects: cloudProjectsObservations,
    fileOperations: fileOperationsObservations,
    wasm: wasmObservations,
    auth: authObservations,
    router: routerObservations,
    runtime: observeService(runtimeService),
  },
  key: 'cloud-projects-library',
  create: ({
    cloudProjects: cloudProjectsInputs,
    fileOperations: fileOperationsInputs,
    wasm: wasmInputs,
    auth: authInputs,
    router: routerInputs,
    runtime: runtimeInput,
  }) => {
    const cloud = () => cloudProjectsInputs.cloudStorageService.required()
    const operations = () =>
      fileOperationsInputs.fileOperationsService.required()
    const wasm = () =>
      wasmInputs.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise.'))
    const auth = authInputs.authService.current
    const router = routerInputs.routerService.current
    const runtime = runtimeInput.current
    const libraries = signal<ReturnType<typeof apiProjectLibraries>>([])
    const organization = computed(() => auth.value?.organization.current.value)
    const refreshCatalog = signal(0)
    const libraryIds = computed(() => [
      PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      ...libraries.value.map((library) => library.id),
    ])
    const pathname = computed(() => router.value?.location.value.pathname)
    const settledAccount = signal<
      | {
          id: string | undefined
        }
      | undefined
    >(undefined)
    let disposed = false
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
          projectPath: fsZds.join(cloud().root, project.id),
          watchThumbnail: () => cloud().watchThumbnail(project.id),
          thumbnail: thumbnails.has(project.id)
            ? {
                type: 'remote',
                url: thumbnails.get(project.id)!,
              }
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
      const project = await getProjectInfo(operations(), path, await wasm(), {
        createMissingEntrypoint: false,
        readOnly: cloud().isReadOnlyProject(id),
      })
      return {
        ...project,
        cloudProjectId: id,
        libraryPath: cloud().root,
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        [...cloud().saves.peek().values()].some(
          (save) => save.state !== 'saved'
        )
      ) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    const _projectLibrarySettingDefaultPoliciesContribution: InputOf<
      typeof projectLibrarySettingDefaultPoliciesFacet
    > = {
      id: 'cloud-projects.defaults',
      priority: 100,
      getDefaultLibraries: ({ isDesktop }) =>
        isDesktop ? undefined : [getDefaultCloudProjectLibrarySetting()],
    } satisfies InputOf<typeof projectLibrarySettingDefaultPoliciesFacet>
    const _projectLibraryTypesContribution: InputOf<
      typeof projectLibraryTypesFacet
    > = {
      type: CLOUD_PROJECT_LIBRARY_TYPE,
      title: 'Cloud',
      icon: 'cloud',
      order: 10,
      defaultSetting: getDefaultCloudProjectLibrarySetting(),
      hideInSettingsOnPlatform: 'both',
      readRealizations: async () => [],
      operations: {
        refresh: {
          run: async () => {
            if (isOffline())
              return new Error(
                'Connect to the internet to refresh cloud projects.'
              )
            if (!auth.peek()?.isLoggedIn.peek())
              return new Error('Sign in to refresh cloud projects.')
            const storage = cloud()
            if (storage.projectsLoading.peek()) return
            refreshCatalog.value += 1
            try {
              await storage.listProjects()
            } catch (cause) {
              return new Error('Could not refresh projects. Try again.', {
                cause,
              })
            }
          },
        },
        createProject: {
          run: async ({
            library,
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
              archive,
              { libraryId: getApiProjectLibraryId(library) }
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
          run: async ({ project, requestedName }) => {
            if (project.remoteProjectId)
              await cloud().renameProject(
                project.remoteProjectId,
                requestedName
              )
          },
        },
        deleteProject: {
          run: async ({ project }) => {
            if (project.remoteProjectId)
              await cloud().deleteProject(project.remoteProjectId)
          },
        },
        duplicateProject: {
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
          run: async ({ library, source, project, requestedProjectTitle }) => {
            const archive =
              source.files ??
              (await collectProjectFilesForUpload({
                fileOperations: operations(),
                projectRoot: source.localProjectPath,
                includeIgnored: true,
              }))
            const created = await cloud().createProject(
              requestedProjectTitle ?? getHomeProjectDisplayName(project),
              archive,
              { libraryId: getApiProjectLibraryId(library) }
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
    } satisfies InputOf<typeof projectLibraryTypesFacet>
    const newLibraryCommand = () =>
      createCloudProjectCommands({
        enabled: () => Boolean(auth.value?.isLoggedIn.value && !isOffline()),
        organization: () => organization.value,
        createLibrary: async (name, scope) => {
          await createRemoteProjectLibrary(
            {
              enabled: true,
              token: auth.peek()?.token.peek(),
              baseUrl: runtime.peek()?.current.peek().apiBaseUrl,
            },
            name,
            scope
          )
          refreshCatalog.value += 1
        },
      })[0]
    return {
      start: () => {
        const onVisibilityChange = () => {
          if (!document.hidden) refreshCatalog.value += 1
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        let scope: string | undefined
        const stopCatalog = effect(() => {
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
          const config = { enabled: true, token, baseUrl }
          void listRemoteProjectLibraries(config, controller.signal)
            .then((result) => {
              if (!controller.signal.aborted && !disposed)
                libraries.value = apiProjectLibraries(result)
            })
            .catch((error: unknown) => {
              if (!controller.signal.aborted && !disposed)
                reportRejection(error)
            })
          return () => controller.abort()
        })
        const stopProjects = effect(() => {
          const loggedIn = auth.value?.isLoggedIn.value
          const token = auth.value?.token.value
          const path = pathname.value
          void token
          if (
            !loggedIn ||
            !(path === PATHS.HOME || path?.startsWith(`${PATHS.LIBRARY}/`))
          )
            return
          const accountId = auth.value?.user.value?.id
          const storage = cloud()
          if (storage.projectsLoading.peek()) return
          void storage
            .listProjects()
            .catch(reportRejection)
            .finally(() => {
              if (!disposed && auth.peek()?.user.peek()?.id === accountId)
                settledAccount.value = { id: accountId }
            })
        })
        return () => {
          stopCatalog()
          stopProjects()
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      },
      items: [
        contribute(settingsFacet, () => cloudLibrariesSettingsContribution, {
          precedence: 'low',
        }),
        contribute(commandsFacet, newLibraryCommand, {
          key: 'cloud-projects.create-library',
        }),
        contribute(
          homeProjectSettledLibraryIdsFacet,
          () => {
            const account = settledAccount.value
            return auth.value?.isLoggedIn.value &&
              account &&
              account.id === auth.value.user.value?.id
              ? libraryIds.value
              : []
          },
          {
            key: 'cloud-projects.settled',
          }
        ),
        contribute(
          homeProjectLoadingLibraryIdsFacet,
          () =>
            auth.value?.isLoggedIn.value && cloud().projectsLoading.value
              ? libraryIds.value
              : [],
          {
            key: 'cloud-projects.loading',
          }
        ),
        contribute(homeProjectEntriesFacet, () => entries.value, {
          key: 'cloud-projects.entries',
        }),
        contribute(
          projectLibrarySettingDefaultPoliciesFacet,
          () => _projectLibrarySettingDefaultPoliciesContribution
        ),
        contribute(projectLibraryTypesFacet, () => ({
          ..._projectLibraryTypesContribution,
          libraries: libraries.value,
        })),
      ],
      dispose: () => {
        disposed = true
        window.removeEventListener('beforeunload', beforeUnload)
      },
    }
  },
}) satisfies Factory
