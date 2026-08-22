import {
  type AtprotoProjectApiConfig,
  createAtprotoRemoteProject,
  deleteAtprotoRemoteProject,
  downloadAtprotoRemoteProjectArchive,
  getAtprotoRemoteProject,
  listAtprotoRemoteProjects,
  updateAtprotoRemoteProject,
} from '@src/lib/atprotoSync/api'
import { AtprotoXrpcError } from '@src/lib/atprotoSync/xrpcClient'
import {
  withProjectTitleInArchiveFiles,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import type {
  CloudSyncProjectBinding,
  CloudSyncRemoteProjectApi,
  ProjectArchiveFile,
} from '@src/lib/cloudSync/types'
import {
  getAtprotoProjectIdFromProjectTomlContents,
  removeAtprotoProjectIdFromProjectTomlContents,
  setAtprotoProjectIdInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'

const ATPROTO_PROJECT_LIBRARY_TYPE = 'atproto'

function stripAtprotoProjectIdFromArchiveFiles(files: ProjectArchiveFile[]) {
  return withUpdatedProjectTomlInArchiveFiles(files, (projectToml) =>
    removeAtprotoProjectIdFromProjectTomlContents(projectToml)
  )
}

export function createAtprotoCloudSyncRemoteApi(
  atprotoConfig: AtprotoProjectApiConfig
): CloudSyncRemoteProjectApi {
  return {
    listRemoteProjects: () => listAtprotoRemoteProjects(atprotoConfig),
    getRemoteProject: (_config, projectId) =>
      getAtprotoRemoteProject(atprotoConfig, projectId),
    deleteRemoteProject: (_config, projectId) =>
      deleteAtprotoRemoteProject(atprotoConfig, projectId),
    downloadRemoteProjectArchive: (_config, projectId) =>
      downloadAtprotoRemoteProjectArchive(atprotoConfig, projectId),
    createRemoteProject: (_config, projectPath, files) =>
      createAtprotoRemoteProject(
        atprotoConfig,
        projectPath,
        stripAtprotoProjectIdFromArchiveFiles(files)
      ),
    updateRemoteProject: ({
      projectPath,
      project,
      files,
      expectedRevision,
      entrypointPath,
    }) =>
      updateAtprotoRemoteProject({
        config: atprotoConfig,
        projectPath,
        project,
        files: stripAtprotoProjectIdFromArchiveFiles(files),
        expectedRevision,
        entrypointPath,
      }),
    isNotFoundError: (error) =>
      error instanceof AtprotoXrpcError && error.status === 404,
    isRemoteUploadForbiddenError: (error) =>
      error instanceof AtprotoXrpcError && error.status === 403,
    retryAfterMs: (error) =>
      error instanceof AtprotoXrpcError ? error.retryAfterMs : undefined,
  }
}

export const atprotoCloudSyncProjectBinding: CloudSyncProjectBinding = {
  id: 'atproto',
  libraryTypes: [ATPROTO_PROJECT_LIBRARY_TYPE],
  readProjectTomlBinding: (projectToml) => {
    const projectId = getAtprotoProjectIdFromProjectTomlContents(projectToml)
    return projectId
      ? {
          kind: 'current-environment',
          projectId,
        }
      : { kind: 'unbound' }
  },
  setProjectIdInProjectTomlContents: (projectToml, projectId) =>
    setAtprotoProjectIdInProjectTomlContents(projectToml, projectId),
  removeProjectIdFromProjectTomlContents: (projectToml) =>
    removeAtprotoProjectIdFromProjectTomlContents(projectToml),
  withRemoteProjectMetadataInArchiveFiles: (files, title, projectId) =>
    withUpdatedProjectTomlInArchiveFiles(
      withProjectTitleInArchiveFiles(files, title),
      (projectToml) =>
        setAtprotoProjectIdInProjectTomlContents(projectToml, projectId)
    ),
}
