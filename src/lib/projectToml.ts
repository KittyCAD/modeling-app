import { serializeProjectConfiguration } from '@src/lang/wasm'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { readProjectSettingsFile } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { toProjectRelativePath, toWebSafePath } from '@src/lib/paths'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export async function getProjectTomlContents({
  projectPath,
  wasmInstance,
  defaultFilePath,
  defaultFileFallback,
  readExistingFile = true,
}: {
  projectPath: string
  wasmInstance: ModuleType
  defaultFilePath?: string | null
  defaultFileFallback?: string
  readExistingFile?: boolean
}): Promise<string | Error> {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)

  if (readExistingFile) {
    try {
      return await fsZds.readFile(projectTomlPath, { encoding: 'utf-8' })
    } catch {}
  }

  const projectSettings = await readProjectSettingsFile(
    projectPath,
    wasmInstance
  )
  const serialized = serializeProjectConfiguration(
    projectSettings,
    wasmInstance
  )
  if (isErr(serialized)) {
    return serialized
  }

  if (
    (!defaultFilePath && !defaultFileFallback) ||
    /^\s*default_file\s*=/m.test(serialized)
  ) {
    return serialized
  }

  const defaultFileRelativePath = defaultFilePath
    ? toProjectRelativePath(projectPath, defaultFilePath)
    : undefined
  const defaultFile = defaultFileRelativePath
    ? toWebSafePath(defaultFileRelativePath)
    : defaultFileFallback
  if (!defaultFile) {
    return serialized
  }

  return `default_file = ${JSON.stringify(defaultFile)}\n${
    serialized.trim() ? `\n${serialized}` : ''
  }`
}
