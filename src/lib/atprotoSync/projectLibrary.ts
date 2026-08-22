import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import {
  ATPROTO_PROJECT_LIBRARY_PATH_PREFIX,
  ATPROTO_PROJECT_LIBRARY_TYPE,
  getDefaultAtprotoProjectLibrarySetting,
} from '@src/lib/atprotoSync'
import {
  createAtprotoRemoteProject,
  deleteAtprotoRemoteProject,
  downloadAtprotoRemoteProjectArchive,
  getAtprotoRemoteProject,
  listAtprotoRemoteProjects,
  parseAtprotoUri,
  updateAtprotoRemoteProject,
} from '@src/lib/atprotoSync/api'
import {
  collectProjectFilesForAtprotoUpload,
  removeAtprotoMetadataFromArchiveFiles,
  uploadAtprotoLocalProject,
  writeAtprotoSyncBaseMetadata,
} from '@src/lib/atprotoSync/localSync'
import {
  type AtprotoOAuthConnector,
  type AtprotoOAuthIdentity,
  isAtprotoOAuthIdentity,
  isAtprotoSyncIdentity,
} from '@src/lib/atprotoSync/oauth'
import {
  getProjectArchiveEntrypointPath,
  parseProjectArchive,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectArchiveFile,
  RemoteProjectSummary,
} from '@src/lib/cloudSync/types'
import {
  PROJECT_FOLDER,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import {
  type ProjectLibrary,
  type ProjectLibraryInitialProject,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { createProjectInLocalDirectory } from '@src/lib/projectLibraries/operations'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import { DirectoryProjectLibrarySettingsDetails } from '@src/lib/projectLibraries/settings/ProjectLibrariesSettingInput'
import {
  getProjectDirectoryNameFromTitle,
  sanitizeProjectName,
} from '@src/lib/projectName'
import {
  getAtprotoProjectIdFromProjectTomlContents,
  setAtprotoProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { reportRejection } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import {
  type ProjectLibraryCreateProjectInput,
  type ProjectLibraryDeleteProjectInput,
  type ProjectLibraryOpenProjectInput,
  type ProjectLibraryRenameProjectInput,
  type ProjectLibraryTypeOperations,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

type AtprotoMaterializedProject = {
  project: Project
  remoteProjectId: string
}

type AtprotoProjectLibraryContext = {
  connector: AtprotoOAuthConnector
  getIdentity: () => AtprotoOAuthIdentity | undefined
  getWasmPromise: () => Promise<ModuleType> | ModuleType
  refresh: (library?: ProjectLibrary) => void
}

const encoder = new TextEncoder()

function encodeProjectToml(contents: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(contents)
}

function concreteBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function getAtprotoIdentityFromSettings(value: unknown) {
  const candidate = (
    value as
      | {
          auth?: {
            atproto?: {
              current?: unknown
            }
          }
        }
      | undefined
  )?.auth?.atproto?.current

  return isAtprotoOAuthIdentity(candidate) ? candidate : undefined
}

function getAtprotoLibraryRemoteSource(library: ProjectLibrary) {
  const source = library.source?.trim()
  if (source) {
    return source
  }

  return library.path.startsWith(ATPROTO_PROJECT_LIBRARY_PATH_PREFIX)
    ? library.path.slice(ATPROTO_PROJECT_LIBRARY_PATH_PREFIX.length).trim()
    : undefined
}

function materializationDirectoryName(library: ProjectLibrary) {
  const source = getAtprotoLibraryRemoteSource(library)
  return getProjectDirectoryNameFromTitle(source ?? library.title, 'account')
}

async function getDefaultAtprotoProjectLibraryMaterializationDirectoryPath(
  library: ProjectLibrary
) {
  const documentsPath = await fsZds.getPath('documents')
  return fsZds.join(
    documentsPath,
    PROJECT_FOLDER,
    'ATProto',
    materializationDirectoryName(library)
  )
}

export async function getAtprotoProjectLibraryMaterializationDirectoryPath(
  library: ProjectLibrary
) {
  if (!library.path.startsWith(ATPROTO_PROJECT_LIBRARY_PATH_PREFIX)) {
    return library.path
  }

  return getDefaultAtprotoProjectLibraryMaterializationDirectoryPath(library)
}

function projectNameForRemoteProject(remoteProject: RemoteProjectSummary) {
  const fallback = sanitizeProjectName(
    remoteProjectRecordKey(remoteProject.id),
    'atproto-project'
  )
  const title =
    humanProjectTitle(remoteProject.title) ??
    humanProjectTitle(remoteProject.name)
  return title ? getProjectDirectoryNameFromTitle(title, fallback) : fallback
}

function remoteProjectRecordKey(projectId: string) {
  try {
    return parseAtprotoUri(projectId).rkey
  } catch {
    return projectId
  }
}

function humanProjectTitle(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const title = value.trim()
  return title && !title.startsWith('at://') ? title : undefined
}

function remoteProjectDisplayTitle(remoteProject: RemoteProjectSummary) {
  return (
    humanProjectTitle(remoteProject.title) ??
    humanProjectTitle(remoteProject.name) ??
    projectNameForRemoteProject(remoteProject)
  )
}

function localProjectDisplayTitle(
  project: Project,
  remoteProject?: RemoteProjectSummary
) {
  return (
    humanProjectTitle(project.title) ??
    (remoteProject ? remoteProjectDisplayTitle(remoteProject) : undefined)
  )
}

async function readAtprotoProjectId(projectPath: string) {
  try {
    return getAtprotoProjectIdFromProjectTomlContents(
      await fsZds.readFile(
        fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME),
        {
          encoding: 'utf-8',
        }
      )
    )
  } catch {
    return undefined
  }
}

async function writeAtprotoProjectId(
  projectPath: string,
  remoteProjectId: string
) {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  const currentProjectToml = await fsZds
    .readFile(projectTomlPath, { encoding: 'utf-8' })
    .catch(() => '')
  await fsZds.writeFile(
    projectTomlPath,
    encodeProjectToml(
      setAtprotoProjectIdInProjectTomlContents(
        currentProjectToml,
        remoteProjectId
      )
    )
  )
}

function projectFilesToInitialProject(
  files: ProjectArchiveFile[],
  fallbackEntrypoint = 'main.kcl'
): ProjectLibraryInitialProject {
  return {
    files: files.map((file) => ({
      requestedFileName: file.relativePath,
      requestedData: concreteBytes(file.data),
    })),
    entrypointFilePath:
      getProjectArchiveEntrypointPath(files, fallbackEntrypoint) ??
      fallbackEntrypoint,
  }
}

async function readMaterializedProjects({
  library,
  wasmInstancePromise,
  signal,
}: {
  library: ProjectLibrary
  wasmInstancePromise: Promise<ModuleType> | ModuleType
  signal?: AbortSignal
}) {
  const directory =
    await getAtprotoProjectLibraryMaterializationDirectoryPath(library)
  await fsZds.mkdir(directory, { recursive: true })
  const names = await fsZds.readdir(directory)
  const projects: AtprotoMaterializedProject[] = []

  for (const name of names) {
    if (signal?.aborted || name.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(directory, name)
    const remoteProjectId = await readAtprotoProjectId(projectPath)
    if (!remoteProjectId) {
      continue
    }

    projects.push({
      remoteProjectId,
      project: await getProjectInfo(projectPath, await wasmInstancePromise),
    })
  }

  return projects
}

async function materializeRemoteProject({
  library,
  remoteProjectId,
  context,
}: {
  library: ProjectLibrary
  remoteProjectId: string
  context: AtprotoProjectLibraryContext
}) {
  const identity = context.getIdentity()
  if (!identity || !context.connector.createProjectApiConfig) {
    return undefined
  }

  const wasmInstancePromise = context.getWasmPromise()
  const existingProject = (
    await readMaterializedProjects({
      library,
      wasmInstancePromise,
    })
  ).find((candidate) => candidate.remoteProjectId === remoteProjectId)?.project
  if (existingProject) {
    return existingProject
  }

  const config = await context.connector.createProjectApiConfig(identity)
  const remoteProject = await getAtprotoRemoteProject(config, remoteProjectId)
  const files = await parseProjectArchive(
    await downloadAtprotoRemoteProjectArchive(config, remoteProjectId)
  )
  const project = await createProjectInLocalDirectory({
    projectDirectoryPath:
      await getAtprotoProjectLibraryMaterializationDirectoryPath(library),
    requestedProjectName: projectNameForRemoteProject(remoteProject),
    requestedProjectTitle: remoteProjectDisplayTitle(remoteProject),
    wasmInstancePromise,
    initialProject: projectFilesToInitialProject(files),
  })

  await writeAtprotoProjectId(project.path, remoteProject.id)
  await writeAtprotoSyncBaseMetadata({
    projectRoot: project.path,
    remoteProject,
    files,
  })
  context.refresh(library)
  return getProjectInfo(project.path, await wasmInstancePromise)
}

function homeEntryFromLocalProject({
  library,
  project,
  remoteProject,
  remoteProjectId,
}: {
  library: ProjectLibrary
  project: Project
  remoteProject?: RemoteProjectSummary
  remoteProjectId: string
}): HomeProjectEntryContribution {
  return {
    source: 'local',
    status: remoteProject ? 'synced' : 'local',
    libraryId: library.id,
    name: project.name,
    title: localProjectDisplayTitle(project, remoteProject),
    localProjectPath: project.path,
    localProjectName: project.name,
    remoteProjectId,
    deleteRemoteOnDelete: true,
    modified: project.metadata?.modified ?? undefined,
    defaultFile: project.default_file,
    kclFileCount: project.kcl_file_count,
    directoryCount: project.directory_count,
    readWriteAccess: project.readWriteAccess,
    thumbnail: {
      type: 'local',
      path: fsZds.join(project.path, PROJECT_IMAGE_NAME),
    },
  }
}

function homeEntryFromRemoteProject({
  library,
  remoteProject,
}: {
  library: ProjectLibrary
  remoteProject: RemoteProjectSummary
}): HomeProjectEntryContribution {
  const title = remoteProjectDisplayTitle(remoteProject)
  return {
    source: 'remote',
    status: 'cloud-only',
    libraryId: library.id,
    name: title,
    title,
    remoteProjectId: remoteProject.id,
    deleteRemoteOnDelete: true,
    modified: remoteProject.updated_at
      ? Date.parse(remoteProject.updated_at)
      : undefined,
    readWriteAccess: true,
  }
}

async function readAtprotoHomeEntries({
  library,
  context,
  signal,
}: {
  library: ProjectLibrary
  context: AtprotoProjectLibraryContext
  signal?: AbortSignal
}) {
  const identity = context.getIdentity()
  if (!identity || !context.connector.createProjectApiConfig) {
    return []
  }

  const config = await context.connector.createProjectApiConfig(identity)
  const [remoteProjects, localProjects] = await Promise.all([
    listAtprotoRemoteProjects(config),
    readMaterializedProjects({
      library,
      wasmInstancePromise: context.getWasmPromise(),
      signal,
    }),
  ])
  const remoteProjectsById = new Map(
    remoteProjects.map((remoteProject) => [remoteProject.id, remoteProject])
  )
  const localRemoteProjectIds = new Set(
    localProjects.map((localProject) => localProject.remoteProjectId)
  )

  return [
    ...localProjects.map((localProject) =>
      homeEntryFromLocalProject({
        library,
        project: localProject.project,
        remoteProject: remoteProjectsById.get(localProject.remoteProjectId),
        remoteProjectId: localProject.remoteProjectId,
      })
    ),
    ...remoteProjects
      .filter((remoteProject) => !localRemoteProjectIds.has(remoteProject.id))
      .map((remoteProject) =>
        homeEntryFromRemoteProject({
          library,
          remoteProject,
        })
      ),
  ]
}

async function renameRemoteOnlyProject({
  library,
  projectId,
  requestedName,
  context,
}: {
  library: ProjectLibrary
  projectId: string
  requestedName: string
  context: AtprotoProjectLibraryContext
}) {
  const identity = context.getIdentity()
  if (!identity || !context.connector.createProjectApiConfig) {
    return
  }

  const config = await context.connector.createProjectApiConfig(identity)
  const remoteProject = await getAtprotoRemoteProject(config, projectId)
  const files = withUpdatedProjectTomlInArchiveFiles(
    removeAtprotoMetadataFromArchiveFiles(
      await parseProjectArchive(
        await downloadAtprotoRemoteProjectArchive(config, projectId)
      )
    ),
    (projectToml) =>
      setProjectTitleInProjectTomlContents(projectToml, requestedName)
  )

  await updateAtprotoRemoteProject({
    config,
    projectPath: projectNameForRemoteProject({
      ...remoteProject,
      title: requestedName,
    }),
    project: remoteProject,
    files,
    expectedRevision:
      typeof remoteProject.revision === 'string'
        ? remoteProject.revision
        : undefined,
  })
  context.refresh(library)
}

function createAtprotoProjectLibraryOperations(
  context: AtprotoProjectLibraryContext
): ProjectLibraryTypeOperations {
  return {
    createProject: {
      run: async ({
        library,
        requestedProjectName,
        requestedProjectTitle,
        initialKclFile,
        initialProject,
      }: ProjectLibraryCreateProjectInput) => {
        const identity = context.getIdentity()
        if (!identity || !context.connector.createProjectApiConfig) {
          return undefined
        }

        const project = await createProjectInLocalDirectory({
          projectDirectoryPath:
            await getAtprotoProjectLibraryMaterializationDirectoryPath(library),
          requestedProjectName,
          requestedProjectTitle,
          wasmInstancePromise: context.getWasmPromise(),
          initialKclFile,
          initialProject,
        })
        const config = await context.connector.createProjectApiConfig(identity)
        const uploadFiles = await collectProjectFilesForAtprotoUpload(
          project.path
        )
        const remoteProject = await createAtprotoRemoteProject(
          config,
          project.path,
          uploadFiles
        )

        await writeAtprotoProjectId(project.path, remoteProject.id)
        await writeAtprotoSyncBaseMetadata({
          projectRoot: project.path,
          remoteProject,
          files: uploadFiles,
        })
        context.refresh(library)
        return project
      },
    },
    openProject: {
      run: async ({ library, project }: ProjectLibraryOpenProjectInput) => {
        if (project.readWriteAccess && project.defaultFile) {
          return { defaultFile: project.defaultFile }
        }

        const remoteProjectId = project.remoteProjectId
        if (!remoteProjectId) {
          return undefined
        }

        const materializedProject = await materializeRemoteProject({
          library,
          remoteProjectId,
          context,
        })
        return materializedProject?.default_file
          ? { defaultFile: materializedProject.default_file }
          : undefined
      },
    },
    renameProject: {
      run: async ({
        library,
        project,
        requestedName,
      }: ProjectLibraryRenameProjectInput) => {
        const title = requestedName.trim()
        if (!title) {
          return
        }

        if (project.localProjectPath && project.readWriteAccess) {
          const projectTomlPath = fsZds.join(
            project.localProjectPath,
            PROJECT_SETTINGS_FILE_NAME
          )
          const currentProjectToml = await fsZds
            .readFile(projectTomlPath, { encoding: 'utf-8' })
            .catch(() => '')
          await fsZds.writeFile(
            projectTomlPath,
            encodeProjectToml(
              setProjectTitleInProjectTomlContents(currentProjectToml, title)
            )
          )

          if (project.remoteProjectId) {
            const identity = context.getIdentity()
            if (identity && context.connector.createProjectApiConfig) {
              await uploadAtprotoLocalProject({
                connector: context.connector,
                identity,
                projectRoot: project.localProjectPath,
              })
            }
          }

          context.refresh(library)
          return
        }

        if (project.remoteProjectId) {
          await renameRemoteOnlyProject({
            library,
            projectId: project.remoteProjectId,
            requestedName: title,
            context,
          })
        }
      },
    },
    deleteProject: {
      run: async ({ library, project }: ProjectLibraryDeleteProjectInput) => {
        const identity = context.getIdentity()
        const config =
          identity && context.connector.createProjectApiConfig
            ? await context.connector.createProjectApiConfig(identity)
            : undefined

        if (project.localProjectPath && project.readWriteAccess) {
          await fsZds.rm(project.localProjectPath, { recursive: true })
        }

        if (config && project.remoteProjectId) {
          await deleteAtprotoRemoteProject(config, project.remoteProjectId)
        }

        context.refresh(library)
      },
    },
  }
}

export function createAtprotoProjectLibraryType({
  connector,
}: {
  connector: AtprotoOAuthConnector
}) {
  return defineRegistryItemFactory((ctx) => {
    const settings = ctx.services.signal(settingsService)
    const entries = signal<HomeProjectEntryContribution[]>([])
    let disposed = false
    let refreshGeneration = 0
    let activeAbortController: AbortController | undefined
    let disposeEffect: (() => void) | undefined

    const getWasmPromise = () =>
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const getIdentity = () => {
      const identity = getAtprotoIdentityFromSettings(settings.value?.get())
      return identity && isAtprotoSyncIdentity(identity) ? identity : undefined
    }
    const getLibraries = () => {
      const currentSettings = settings.value?.current.value
      return currentSettings
        ? projectLibrariesFromSettings(
            currentSettings.app.libraries.current
          ).filter((library) => library.type === ATPROTO_PROJECT_LIBRARY_TYPE)
        : []
    }
    const refresh = (library?: ProjectLibrary) => {
      refreshGeneration += 1
      if (library) {
        invalidateProjectLibraryRealizations({ libraryId: library.id })
      }
      void loadEntries(refreshGeneration).catch(reportRejection)
    }
    const context: AtprotoProjectLibraryContext = {
      connector,
      getIdentity,
      getWasmPromise,
      refresh,
    }
    const operations = createAtprotoProjectLibraryOperations(context)

    const loadEntries = async (generation: number) => {
      activeAbortController?.abort()
      const abortController = new AbortController()
      activeAbortController = abortController

      const nextEntries = (
        await Promise.all(
          getLibraries().map((library) =>
            readAtprotoHomeEntries({
              library,
              context,
              signal: abortController.signal,
            })
          )
        )
      ).flat()

      if (
        disposed ||
        abortController.signal.aborted ||
        generation !== refreshGeneration
      ) {
        return
      }

      entries.value = nextEntries
    }

    queueMicrotask(() => {
      if (disposed) {
        return
      }

      disposeEffect = effect(() => {
        settings.value?.current.value
        getIdentity()
        refresh()
      })
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'atproto-project-library-type',
        provides: [
          provide(
            projectLibraryTypesValueSpec,
            {
              type: ATPROTO_PROJECT_LIBRARY_TYPE,
              title: 'ATProto',
              icon: 'atSign',
              order: 30,
              newLibrarySetting: getDefaultAtprotoProjectLibrarySetting(),
              chooseDirectoryOnAdd: true,
              settingsDetails: DirectoryProjectLibrarySettingsDetails,
              operations,
            },
            { key: 'atproto-project-library-type' }
          ),
          provide(homeProjectEntriesValueSpec, entries, {
            key: 'atproto-project-library-home-entries',
          }),
        ],
        dispose: () => {
          disposed = true
          activeAbortController?.abort()
          disposeEffect?.()
        },
      }),
    }
  }, 'atproto-project-library-type')
}
