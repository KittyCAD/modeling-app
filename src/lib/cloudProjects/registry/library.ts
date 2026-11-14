import { computed, effect, signal } from '@preact/signals-core'
import { newKclFile } from '@src/lang/project'
import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
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
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import { pollProjectList } from '@src/lib/projectListPolling'
import { collectProjectFilesForUpload } from '@src/lib/projectSession/projectFiles'
import { isErr, reportRejection } from '@src/lib/trap'
import { observations as authObservations } from '@src/registry/contracts/auth'
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
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
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
  },
  key: 'cloud-projects-library',
  create: ({
    cloudProjects: cloudProjectsInputs,
    fileOperations: fileOperationsInputs,
    wasm: wasmInputs,
    auth: authInputs,
    router: routerInputs,
  }) => {
    const cloud = () => cloudProjectsInputs.cloudStorageService.required()
    const operations = () =>
      fileOperationsInputs.fileOperationsService.required()
    const wasm = () =>
      wasmInputs.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise.'))
    const auth = authInputs.authService.current
    const router = routerInputs.routerService.current
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
          (project) => project.access?.scope !== 'organization'
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
          libraryIds: [PERSONAL_CLOUD_PROJECT_LIBRARY_ID],
          readWriteAccess: true,
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
          canCloneProject: ({ project }) =>
            Boolean(project.remoteProjectId && project.readWriteAccess),
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
          run: async ({ source, project, requestedProjectTitle }) => {
            const archive = await collectProjectFilesForUpload({
              fileOperations: operations(),
              projectRoot: source.localProjectPath,
            })
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
    } satisfies InputOf<typeof projectLibraryTypesFacet>
    return {
      start: () =>
        effect(() => {
          const loggedIn = auth.value?.isLoggedIn.value
          const token = auth.value?.token.value
          const location = router.value?.location.value
          void token
          if (
            !loggedIn ||
            !(
              location?.pathname === PATHS.HOME ||
              location?.pathname ===
                `${PATHS.LIBRARY}/${PERSONAL_CLOUD_PROJECT_LIBRARY_ID}`
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
                settledAccount.value = {
                  id: accountId,
                }
            }
          }, reportRejection)
        }),
      items: [
        contribute(
          homeProjectSettledLibraryIdsFacet,
          () =>
            computed(() => {
              const account = settledAccount.value
              return auth.value?.isLoggedIn.value &&
                account &&
                account.id === auth.value.user.value?.id
                ? [PERSONAL_CLOUD_PROJECT_LIBRARY_ID]
                : []
            }).value,
          {
            key: 'cloud-projects.settled',
          }
        ),
        contribute(
          homeProjectLoadingLibraryIdsFacet,
          () =>
            computed(() =>
              auth.value?.isLoggedIn.value && cloud().projectsLoading.value
                ? [PERSONAL_CLOUD_PROJECT_LIBRARY_ID]
                : []
            ).value,
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
        contribute(
          projectLibraryTypesFacet,
          () => _projectLibraryTypesContribution
        ),
      ],
      dispose: () => {
        disposed = true
        window.removeEventListener('beforeunload', beforeUnload)
      },
    }
  },
}) satisfies Factory
