import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
} from '@src/lib/cloudSync'
import {
  canReadWriteDirectory,
  getProjectInfo,
  mkdirOrNOOP,
} from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

const PROJECT_FOLDER_PROGRESS_CHUNK_SIZE = 12

type ProjectDirectoryEntry = {
  name: string
  path: string
  modified: number
}

export function sortProjectDirectoryEntriesByModifiedDesc(
  entries: ProjectDirectoryEntry[]
) {
  return entries.toSorted(
    (a, b) => b.modified - a.modified || a.name.localeCompare(b.name)
  )
}

function normalizeProjectPathForCloudMetadata(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function shouldSendProjectFolderReadProgress(
  folders: readonly Project[] | undefined
) {
  return !folders?.length
}

export async function readProjectsFromProjectDirectory({
  projectDirectoryPath,
  wasmInstancePromise,
  previousProjects,
  signal,
  onProgress,
}: {
  projectDirectoryPath: string
  wasmInstancePromise: Promise<ModuleType>
  previousProjects?: Project[]
  signal?: AbortSignal
  onProgress?: (projects: Project[]) => void
}) {
  const projects: Project[] = []
  const canSendProgress = shouldSendProjectFolderReadProgress(previousProjects)

  const sendProgress = (folders: Project[]) => {
    if (signal?.aborted) {
      return
    }
    onProgress?.(folders)
  }

  await mkdirOrNOOP(projectDirectoryPath)
  const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
    ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
    : new Map()
  const entries: ProjectDirectoryEntry[] = []

  // Gotcha: readdir will list folders even without read/write access to the
  // parent directory path. Each candidate still needs to be stat/read checked.
  for (const entry of await fsZds.readdir(projectDirectoryPath)) {
    if (signal?.aborted) {
      return projects
    }
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDirectoryPath, entry)
    let stat: Awaited<ReturnType<typeof fsZds.stat>>
    try {
      stat = await fsZds.stat(projectPath)
    } catch {
      continue
    }
    if (!(stat.mode & fsZdsConstants.S_IFDIR)) {
      continue
    }

    entries.push({
      name: entry,
      path: projectPath,
      modified:
        getCloudSyncProjectModifiedTime(
          cloudProjectMetadataByPath.get(
            normalizeProjectPathForCloudMetadata(projectPath)
          ),
          stat.mtimeMs
        ) ?? stat.mtimeMs,
    })
  }

  const { value: canReadWriteProjectDirectory } =
    await canReadWriteDirectory(projectDirectoryPath)
  const wasmInstance = await wasmInstancePromise

  for (const entry of sortProjectDirectoryEntriesByModifiedDesc(entries)) {
    if (signal?.aborted) {
      return projects
    }

    const project = await getProjectInfo(entry.path, wasmInstance)
    const cloudMetadata = cloudProjectMetadataByPath.get(
      normalizeProjectPathForCloudMetadata(entry.path)
    )

    project.cloudProjectId ??= cloudMetadata?.remoteProjectId
    project.cloudConflict = cloudMetadata?.conflict
    if (project.metadata) {
      project.metadata.modified = getCloudSyncProjectModifiedTime(
        cloudMetadata,
        project.metadata.modified
      )
    }
    if (
      project.kcl_file_count === 0 &&
      project.readWriteAccess &&
      canReadWriteProjectDirectory
    ) {
      continue
    }

    projects.push(project)
    if (
      canSendProgress &&
      projects.length % PROJECT_FOLDER_PROGRESS_CHUNK_SIZE === 0
    ) {
      sendProgress([...projects])
    }
  }

  sendProgress(projects)
  return projects
}
