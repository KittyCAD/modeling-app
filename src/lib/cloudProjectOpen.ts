import {
  CloudApiError,
  downloadPublicRemoteProjectArchive,
  downloadRemoteProjectArchive,
  getPublicRemoteProject,
  getRemoteProject,
} from '@src/lib/cloudSync/cloudApi'
import {
  getProjectArchiveEntrypointPath,
  parseProjectArchive,
} from '@src/lib/cloudSync/projectArchive'
import type {
  CloudSyncConfig,
  ProjectArchiveFile,
} from '@src/lib/cloudSync/types'
import type { Project } from '@src/lib/project'
import { webSafePathSplit } from '@src/lib/pathUtils'

export interface CloudProjectSource {
  source: NonNullable<Project['cloudSource']>
  title: string
  entrypoint?: string
  revision?: string
}

/** Read access is resolved before any local materialization or sync enrollment. */
export async function resolveCloudProjectSource(
  config: CloudSyncConfig,
  projectId: string
): Promise<CloudProjectSource> {
  try {
    const project = await getRemoteProject(
      config,
      encodeURIComponent(projectId)
    )
    return {
      source: {
        id: projectId,
        canEdit: project.access?.can_edit === true,
        kind: 'private',
      },
      title: project.title || 'Untitled',
      entrypoint:
        typeof project.entrypoint_path === 'string'
          ? project.entrypoint_path
          : undefined,
      revision: project.revision?.toString(),
    }
  } catch (error) {
    if (
      !(error instanceof CloudApiError) ||
      ![403, 404].includes(error.status)
    ) {
      return Promise.reject(error)
    }
  }
  const project = await getPublicRemoteProject(config, projectId)
  return {
    source: { id: projectId, canEdit: false, kind: 'public' },
    title: project.title,
    revision: project.published_at,
  }
}

export async function downloadCloudProjectView(
  config: CloudSyncConfig,
  source: CloudProjectSource,
  assertCurrent: () => void
): Promise<{ files: ProjectArchiveFile[]; entrypoint: string }> {
  const id = source.source.id
  const archive =
    source.source.kind === 'public'
      ? await downloadPublicRemoteProjectArchive(config, id)
      : await downloadRemoteProjectArchive(config, encodeURIComponent(id))
  assertCurrent()
  // A save or publication during download must not mix metadata and content.
  const latestRevision =
    source.source.kind === 'public'
      ? (await getPublicRemoteProject(config, id)).published_at
      : (
          await getRemoteProject(config, encodeURIComponent(id))
        ).revision?.toString()
  assertCurrent()
  if (source.revision !== latestRevision) {
    return Promise.reject(
      new Error('The project changed while opening. Try opening it again.')
    )
  }
  const files = await parseProjectArchive(archive)
  assertCurrent()
  const entrypoint = getProjectArchiveEntrypointPath(files, source.entrypoint)
  if (!entrypoint)
    return Promise.reject(new Error('This project has no KCL entrypoint.'))
  return { files, entrypoint }
}

/** File links are relative to their project, never arbitrary filesystem paths. */
export function isValidProjectFilePath(path: string) {
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[a-zA-Z]:/.test(path) &&
    !webSafePathSplit(path).some(
      (part) => part === '..' || part === '.' || part === ''
    )
  )
}
