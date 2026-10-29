import fsZds from '@src/lib/fs-zds'
import { normalizePathForSync } from '@src/lib/fileSystem/cloud/paths'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  isPathInDirectoryProjectLibrary,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { Project } from '@src/lib/project'

export type ProjectLibraryOwnership = {
  libraryPath: string
  libraryType: ProjectLibrarySetting['type']
}

/** Return the local filesystem root that represents a project library. */
async function getProjectLibraryLocalPath(library: ProjectLibrarySetting) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return fsZds.resolve('/__zoo_cloud__')
  }

  return library.path.trim()
    ? normalizePathForSync(library.path.trim())
    : undefined
}

/** Find the most specific configured library that owns a project path. */
export async function getProjectLibraryOwnership(
  libraries: readonly ProjectLibrarySetting[],
  projectPath: string
): Promise<ProjectLibraryOwnership | undefined> {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const candidates: ProjectLibraryOwnership[] = []

  for (const library of libraries) {
    const libraryPath = await getProjectLibraryLocalPath(library)
    if (
      libraryPath &&
      libraryPath !== normalizedProjectPath &&
      isPathInDirectoryProjectLibrary(normalizedProjectPath, libraryPath)
    ) {
      candidates.push({
        libraryPath,
        libraryType: library.type,
      })
    }
  }

  return candidates
    .toSorted(
      (left, right) => right.libraryPath.length - left.libraryPath.length
    )
    .at(0)
}

/** Annotate a project with current library ownership, dropping stale ownership first. */
export async function projectWithLibraryOwnership(
  project: Project,
  libraries: readonly ProjectLibrarySetting[]
): Promise<Project> {
  const ownership = await getProjectLibraryOwnership(libraries, project.path)
  const {
    libraryPath: _libraryPath,
    libraryType: _libraryType,
    ...projectWithoutStaleOwnership
  } = project

  return {
    ...projectWithoutStaleOwnership,
    ...(ownership ?? {}),
  }
}
