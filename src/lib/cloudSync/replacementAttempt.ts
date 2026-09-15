import { normalizeRelativePath } from '@src/lib/cloudSync/paths'
import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
import type {
  AcknowledgedSyncBase,
  ProjectArchiveFile,
  ProjectManifest,
  RemoteProject,
} from '@src/lib/cloudSync/types'

/**
 * One immutable, guarded whole-project replacement decision.
 *
 * The file bytes are copied when this value is created. Its manifest and
 * deletion intent therefore describe exactly the archive submitted with the
 * expected revision, even if the local filesystem changes before the request
 * completes.
 */
export type ProjectReplacementAttempt = Readonly<{
  projectPath: string
  project: RemoteProject
  files: ProjectArchiveFile[]
  manifest: ProjectManifest
  expectedRevision: string
  entrypointPath?: string
  deletedPaths: string[]
}>

export async function createProjectReplacementAttempt({
  projectPath,
  project,
  files,
  syncBase,
  entrypointPath,
}: {
  projectPath: string
  project: RemoteProject
  files: readonly ProjectArchiveFile[]
  syncBase: AcknowledgedSyncBase
  entrypointPath?: string
}): Promise<ProjectReplacementAttempt> {
  const snapshotFiles = files.map((file) => ({
    relativePath: normalizeRelativePath(file.relativePath),
    data: Uint8Array.from(file.data),
  }))
  const uploadedPaths = new Set(snapshotFiles.map((file) => file.relativePath))

  return {
    projectPath,
    project,
    files: snapshotFiles,
    manifest: await projectManifestFromFiles(snapshotFiles),
    expectedRevision: syncBase.revision,
    entrypointPath,
    deletedPaths: Object.keys(syncBase.manifest.files)
      .map(normalizeRelativePath)
      .filter((path) => Boolean(path) && !uploadedPaths.has(path))
      .sort(),
  }
}
