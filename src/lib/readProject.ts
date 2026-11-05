import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { getProjectContents, isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/projectData'
import type { ProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/**
 * Read a local project snapshot without the legacy settings/default-file initialization.
 * The optional root project.toml supplies the title and initial file; missing or empty
 * titles fall back to the directory name. Read and parse failures propagate.
 * Library ownership is supplied by the caller and write access is observed at open time.
 */
export async function readProject(
  fileOperations: Pick<
    FileOperationsRegistryService,
    'stat' | 'readDirectory' | 'readFile' | 'canReadWrite'
  >,
  projectPath: string,
  options: { signal?: AbortSignal; library?: ProjectLibraryOwnership } = {}
): Promise<Project> {
  const { signal, library } = options
  const contents = await getProjectContents(fileOperations, projectPath, signal)
  let toml: string | undefined
  try {
    toml = new TextDecoder().decode(
      await fileOperations.readFile(
        fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
      )
    )
  } catch (error) {
    if (!isPathNotFoundError(error)) return Promise.reject(error)
  }
  signal?.throwIfAborted()
  const metadata = toml === undefined ? {} : readProjectMetadataFromToml(toml)
  if (isErr(metadata)) return Promise.reject(metadata)
  const readWriteAccess = await fileOperations.canReadWrite(projectPath)
  signal?.throwIfAborted()
  return {
    contents,
    metadata: {
      title: metadata.title ?? contents.name,
      ...(metadata.defaultFile ? { defaultFile: metadata.defaultFile } : {}),
      library,
      readWriteAccess,
    },
  }
}
