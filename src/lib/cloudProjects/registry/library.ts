import { computed, effect, signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { UserOrgInfo } from '@kittycad/lib'
import {
  createOrganizationSharingCommand,
  SHARE_PROJECT_WITH_ORGANIZATION_COMMAND,
} from '@src/lib/cloudProjects/organizationSharing'
import { projectExplorerProjectMenuItemsFacet } from '@src/registry/contracts/projectExplorer'
import { createElement } from 'react'
import { CloudLibraryCreateButton } from '@src/lib/cloudProjects/CloudLibraryCreateButton'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import {
  canDeleteCloudLibrary,
  createCloudLibraryDeleteCommand,
  DELETE_CLOUD_LIBRARY_COMMAND,
} from '@src/lib/cloudProjects/libraryDeletion'
import {
  createCloudProjectCommands,
  CREATE_CLOUD_LIBRARY_COMMAND,
} from '@src/lib/cloudProjects/commands'
import { selectCommand } from '@src/lib/commandUtils'
import { newKclFile } from '@src/lang/project'
import { observations as cloudProjectsObservations } from '@src/lib/cloudProjects/registry/contract'
import {
  listRemoteProjectLibraries,
  getCurrentOrganization,
  createRemoteProjectLibrary,
  deleteRemoteProjectLibrary,
  type RemoteProjectLibrary,
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
  ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID,
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
import {
  observations as commandsObservations,
  commandsFacet,
} from '@src/registry/contracts/commands'
import {
  homeSidebarItemsFacet,
  type HomeSidebarItemProps,
} from '@src/registry/contracts/homeSidebar'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import {
  type HomeProjectEntry,
  homeProjectEntriesFacet,
  homeProjectLoadingLibraryIdsFacet,
  homeProjectSettledLibraryIdsFacet,
} from '@src/registry/contracts/homeProjects'
import {
  projectLibrarySettingDefaultPoliciesFacet,
  projectLibraryTypesFacet,
  type ProjectLibraryHomeContextMenuProps,
} from '@src/registry/contracts/projectLibraries'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { runtimeService } from '@src/registry/contracts/runtime'
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
    commands: commandsObservations,
  },
  key: 'cloud-projects-library',
  create: ({
    cloudProjects: cloudProjectsInputs,
    fileOperations: fileOperationsInputs,
    wasm: wasmInputs,
    auth: authInputs,
    router: routerInputs,
    runtime: runtimeInput,
    commands: commandsInputs,
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
    const remoteLibraries = signal<RemoteProjectLibrary[]>([])
    const libraries = computed(() => apiProjectLibraries(remoteLibraries.value))
    const organization = signal<UserOrgInfo | undefined>(undefined)
    const contributedLibraries = computed(() => {
      const org = organization.value
      return org
        ? [
            ...libraries.value,
            {
              id: ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID,
              title: `${org.name ?? 'Organization'} projects`,
              type: CLOUD_PROJECT_LIBRARY_TYPE,
              source: '/organization',
              path: 'zoo://organization',
              organizationId: org.id,
            },
          ]
        : libraries.value
    })
    const refreshCatalog = signal(0)
    const libraryIds = computed(() => [
      PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
      ...contributedLibraries.value.map((library) => library.id),
    ])
    const pathname = computed(() => router.value?.location.value.pathname)
    const settledAccount = signal<
      | {
          id: string | undefined
          projectsLoaded: boolean
        }
      | undefined
    >(undefined)
    let disposed = false
    const finishProjectListing = (
      id: string | undefined,
      projectsLoaded: boolean
    ) => {
      if (!disposed && auth.peek()?.user.peek()?.id === id)
        settledAccount.value = { id, projectsLoaded }
    }
    const entries = computed<readonly HomeProjectEntry[]>(() => {
      if (!auth.value?.isLoggedIn.value) return []
      const thumbnails = cloud().thumbnails.value
      return cloud().projects.value.map((project) => ({
        id: `cloud:${project.id}`,
        source: 'remote',
        status: 'cloud-only',
        name: project.id,
        title: project.title ?? 'Untitled',
        remoteProjectId: project.id,
        canShareWithOrganization: Boolean(
          organization.value &&
            project.access?.scope === 'personal' &&
            project.access.can_manage_organization
        ),
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
            : project.access?.scope === 'organization'
              ? ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID
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
            const accountId = auth.peek()?.user.peek()?.id
            refreshCatalog.value += 1
            try {
              await storage.listProjects()
              finishProjectListing(accountId, true)
            } catch (cause) {
              finishProjectListing(accountId, false)
              return new Error('Could not refresh projects. Try again.', {
                cause,
              })
            }
          },
        },
        createProject: {
          isAvailable: ({ library }) =>
            library.id !== ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID,
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
          isAvailable: ({ library }) =>
            library.id !== ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID,
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
          isAvailable: ({ library }) =>
            library.id !== ORGANIZATION_CLOUD_PROJECT_LIBRARY_ID,
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
    const deletionEnabled = () =>
      Boolean(
        auth.value?.isLoggedIn.value &&
          !isOffline() &&
          settledAccount.value &&
          settledAccount.value.projectsLoaded &&
          settledAccount.value.id === auth.value.user.value?.id &&
          !cloud().projectsLoading.value
      )
    const deleteLibraryCommand = () =>
      createCloudLibraryDeleteCommand({
        enabled: deletionEnabled,
        libraries: () => remoteLibraries.value,
        projects: () => cloud().projects.value,
        deleteLibrary: async (id, revision) => {
          await deleteRemoteProjectLibrary(
            {
              enabled: true,
              token: auth.peek()?.token.peek(),
              baseUrl: runtime.peek()?.current.peek().apiBaseUrl,
            },
            id,
            revision
          )
          refreshCatalog.value += 1
          const currentRouter = router.peek()
          if (
            currentRouter?.location.peek().pathname ===
            `${PATHS.LIBRARY}/${encodeURIComponent(apiProjectLibraryId(id))}`
          )
            void currentRouter.navigate(PATHS.HOME)
        },
      })
    const CloudLibraryHomeContextMenu = ({
      library,
      menuTargetElement,
    }: ProjectLibraryHomeContextMenuProps) => {
      useSignals()
      const remote = remoteLibraries.value.find(
        (remote) => remote.id === getApiProjectLibraryId(library)
      )
      if (
        !deletionEnabled() ||
        !remote ||
        !canDeleteCloudLibrary(remote, cloud().projects.value)
      )
        return null
      const onDelete = () => {
        const commands = commandsInputs.commandSystemService.current.value
        if (commands)
          selectCommand(commands, {
            groupId: 'projects',
            name: DELETE_CLOUD_LIBRARY_COMMAND,
            argDefaultValues: { library: remote.id },
          })
      }
      return createElement(ContextMenu, {
        menuTargetElement,
        items: [
          createElement(ContextMenuItem, {
            key: 'delete-library',
            icon: 'trash',
            'data-testid': 'project-library-context-delete',
            onClick: onDelete,
            children: 'Delete library',
          }),
        ],
      })
    }
    const NewLibraryButton = ({ className }: HomeSidebarItemProps) =>
      createElement(CloudLibraryCreateButton, {
        className,
        onClick: () => {
          const commands = commandsInputs.commandSystemService.current.value
          if (commands)
            selectCommand(commands, {
              groupId: 'projects',
              name: CREATE_CLOUD_LIBRARY_COMMAND,
            })
        },
      })
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
            remoteLibraries.value = []
            organization.value = undefined
          }
          if (!loggedIn || !token) return
          const controller = new AbortController()
          const config = { enabled: true, token, baseUrl }
          void listRemoteProjectLibraries(config, controller.signal)
            .then((result) => {
              if (!controller.signal.aborted && !disposed)
                remoteLibraries.value = result
            })
            .catch((error: unknown) => {
              if (!controller.signal.aborted && !disposed)
                reportRejection(error)
            })
          void getCurrentOrganization(config, controller.signal)
            .then((result) => {
              if (!controller.signal.aborted && !disposed)
                organization.value = result
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
            .then(() => finishProjectListing(accountId, true))
            .catch((error: unknown) => {
              reportRejection(error)
              finishProjectListing(accountId, false)
            })
        })
        return () => {
          stopCatalog()
          stopProjects()
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      },
      items: [
        contribute(
          commandsFacet,
          () =>
            createOrganizationSharingCommand({
              enabled: () =>
                Boolean(auth.value?.isLoggedIn.value && !isOffline()),
              organization: () => organization.value,
              projects: () => entries.value,
              shareProject: (id) => cloud().shareProjectWithOrganization(id),
            }),
          { key: 'cloud-projects.share-with-organization' }
        ),
        contribute(projectExplorerProjectMenuItemsFacet, () => ({
          id: 'cloud-projects.share-with-organization',
          order: 20,
          label: 'Share with organization',
          dataTestId: 'project-sidebar-share-with-organization',
          isVisible: ({ projectPath }) =>
            entries.value.some(
              (project) =>
                project.projectPath === projectPath &&
                project.canShareWithOrganization
            ),
          onSelect: ({ projectPath }) => {
            const project = entries.value.find(
              (project) => project.projectPath === projectPath
            )
            const commands = commandsInputs.commandSystemService.current.value
            if (project && commands)
              selectCommand(commands, {
                groupId: 'projects',
                name: SHARE_PROJECT_WITH_ORGANIZATION_COMMAND,
                argDefaultValues: { project: project.id },
              })
          },
        })),
        contribute(commandsFacet, newLibraryCommand, {
          key: 'cloud-projects.create-library',
        }),
        contribute(commandsFacet, deleteLibraryCommand, {
          key: 'cloud-projects.delete-library',
        }),
        contribute(homeSidebarItemsFacet, () => ({
          id: 'cloud-projects.create-library',
          order: 15,
          isVisible: () => Boolean(auth.value?.isLoggedIn.value),
          Component: NewLibraryButton,
        })),
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
          libraries: contributedLibraries.value,
          homeContextMenu: CloudLibraryHomeContextMenu,
        })),
      ],
      dispose: () => {
        disposed = true
        window.removeEventListener('beforeunload', beforeUnload)
      },
    }
  },
}) satisfies Factory
