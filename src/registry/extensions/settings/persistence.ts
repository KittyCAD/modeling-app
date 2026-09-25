import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { ResolvedExtensionSettings } from '@src/lib/settings/extensionSettings'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { ProjectLibrarySettingDefaultPolicy } from '@src/registry/contracts/projectLibraries'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'

/**
 * Load settings with the owning capability's contributions applied.
 *
 * Shared by route initialization and by opening a project, which both need it
 * and neither of which should own it.
 *
 * Note this *writes*: `loadAndValidateSettings` recreates missing files, so
 * calling it with a `projectPath` that is not really a project root creates a
 * `project.toml` there and makes that folder look like one. Resolve the project
 * root first.
 */
export interface SettingsPersistenceDependencies {
  fileOperations: FileOperationsRegistryService
  wasmInstancePromise: Promise<ModuleType>
  defaultProjectLibraries: readonly ProjectLibrarySetting[]
  projectLibrarySettingDefaultPolicies: readonly ProjectLibrarySettingDefaultPolicy[]
  extensionSettings: ResolvedExtensionSettings
}

export function createSettingsPersistence(
  dependencies: SettingsPersistenceDependencies
): SettingsRegistryService['loadOrCreate'] {
  return async (projectPath) => {
    const wasmInstance = await dependencies.wasmInstancePromise
    return loadAndValidateSettings(dependencies.fileOperations, wasmInstance, {
      defaultProjectLibraries: dependencies.defaultProjectLibraries,
      projectLibrarySettingDefaultPolicies:
        dependencies.projectLibrarySettingDefaultPolicies,
      extensionSettings: dependencies.extensionSettings,
      projectPath,
    })
  }
}
