import { getProjectArchiveEntrypointPath } from '@src/lib/cloudProjects/runtime/archive'
import type { ProjectArchiveFile } from '@src/lib/cloudProjects/runtime/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/** Validate the exact entrypoint being uploaded, without acquiring a legacy execution manager. */
export function createPublicationArchiveValidator(
  wasm: Promise<Pick<ModuleType, 'is_kcl_empty_or_only_settings'>>
) {
  return async (files: ProjectArchiveFile[]): Promise<Error | undefined> => {
    const config = files.find(
      (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
    )
    if (config) {
      const metadata = readProjectMetadataFromToml(
        new TextDecoder().decode(config.data)
      )
      if (metadata instanceof Error) return metadata
    }
    const entrypoint = getProjectArchiveEntrypointPath(files)
    const source = files.find((file) => file.relativePath === entrypoint)
    if (!source)
      return new Error('The project needs a KCL entrypoint before publishing.')
    const instance = await wasm
    try {
      if (
        instance.is_kcl_empty_or_only_settings(
          new TextDecoder().decode(source.data)
        ) !== false
      )
        return new Error('The project KCL entrypoint is empty.')
    } catch (cause) {
      return new Error('Fix KCL errors before publishing.', { cause })
    }
  }
}
