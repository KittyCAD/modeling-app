import toast from 'react-hot-toast'
import fsZds from '@src/lib/fs-zds'
import { CloudSaveStatus } from '@src/components/CloudSaveStatus'

import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'

import { defineRegistryItemFactory, provide } from '@kittycad/registry'

import { computed, effect } from '@preact/signals-core'

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
  type HomeProjectEntryContribution,
} from '@src/registry/contracts/homeProjects'

import { authService } from '@src/registry/contracts/auth'

import { routerService } from '@src/registry/contracts/router'

import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

import { getProjectInfo, readAppSettingsFile } from '@src/lib/desktop'

import { newKclFile } from '@src/lang/project'

import { collectProjectFilesForUpload } from '@src/lib/fileSystem/projectFiles'

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
  let disposed = false
  let stop = () => {}
  queueMicrotask(() => {
    if (disposed) return
    stop = effect(() => {
      const loggedIn = auth.value?.isLoggedIn.value
      const token = auth.value?.token.value
      const location = router.value?.location.value
      if (loggedIn && location?.pathname === '/home') {
        void cloud().listProjects().catch(reportRejection)
      }
      void token
    })
  })

  const entries = computed<readonly HomeProjectEntryContribution[]>(() => {
    if (!auth.value?.isLoggedIn.value) return []
    const thumbnails = cloud().thumbnails.value
    return cloud()
      .projects.value.filter((project) => !project.org_id)
      .map((project) => ({
        id: `cloud:${project.id}`,
        source: 'remote',
        status: 'cloud-only',
        name: project.id,
        title: project.title ?? 'Untitled',
        remoteProjectId: project.id,
        thumbnail: thumbnails.has(project.id)
          ? { type: 'remote', url: thumbnails.get(project.id)! }
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
      provide(appHeaderItemsValueSpec, {
        id: 'cloud-save-status',
        order: 20,
        Component: CloudSaveStatus,
      }),
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
          moveProjectFrom: {
            canMoveProject: ({ project }) =>
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
          moveProjectTo: {
            run: async ({ source, project }) => {
              const archive = await collectProjectFilesForUpload({
                fileOperations: operations(),
                projectRoot: source.localProjectPath,
              })
              const created = await cloud().createProject(
                getHomeProjectDisplayName(project),
                archive
              )
              const info = await projectInfo(created.id)
              // The source is removed only after the destination is acknowledged and readable.
              const included = new Set(archive.map((file) => file.relativePath))
              const containsExcludedFiles = async (
                directory: string
              ): Promise<boolean> => {
                for (const name of await operations().readDirectory(
                  directory
                )) {
                  const path = fsZds.join(directory, name)
                  if ((await operations().stat(path)).kind === 'directory') {
                    if (await containsExcludedFiles(path)) return true
                  } else if (
                    !included.has(
                      fsZds
                        .relative(source.localProjectPath, path)
                        .replaceAll('\\', '/')
                    )
                  )
                    return true
                }
                return false
              }
              if (await containsExcludedFiles(source.localProjectPath))
                toast(
                  'Cloud project saved. Local files were kept because the upload excludes some files.'
                )
              else await operations().remove(source.localProjectPath)
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
      window.removeEventListener('beforeunload', beforeUnload)
    },
  }
}, 'cloud-projects')
