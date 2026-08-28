import { effect } from '@preact/signals'
import type { AuthService } from '@src/contracts/auth'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectLibrariesService } from '@src/contracts/projectLibraries'
import type { RuntimeService } from '@src/contracts/runtime'
import type {
  SettingDefinition,
  SettingsService,
} from '@src/contracts/settings'
import { CLOUD_LIBRARY_TYPE } from '@src/lib/projectLibraries'

interface CloudLibraryActivationPolicyOptions {
  libraries: Pick<ProjectLibrariesService, 'libraries' | 'type' | 'addLibrary'>
  fileSystem: Pick<FileSystem, 'defaultRoot' | 'defaultCloudRoot'>
  runtime: Pick<RuntimeService, 'info'>
  auth: Pick<AuthService, 'status'>
  settings: Pick<SettingsService, 'set'>
  activationSetting: SettingDefinition<boolean>
}

/**
 * Materialize Personal Cloud once for each plugin activation.
 *
 * After that initial materialization, absence means removal. Desktop persists
 * that intent by turning the plugin off; web rematerializes because its
 * authenticated Cloud library is mandatory and cannot be removed in the UI.
 */
export function installCloudLibraryActivationPolicy({
  libraries,
  fileSystem,
  runtime,
  auth,
  settings,
  activationSetting,
}: CloudLibraryActivationPolicyOptions): () => void {
  let hasMaterializedCloud = false

  return effect(() => {
    const hasCloud = libraries.libraries.value.some(
      (library) => library.type === CLOUD_LIBRARY_TYPE
    )
    if (hasCloud) {
      hasMaterializedCloud = true
      return
    }

    if (hasMaterializedCloud && runtime.info.value.isDesktop) {
      settings.set(activationSetting, 'user', false)
      return
    }

    const cloud = libraries.type(CLOUD_LIBRARY_TYPE)
    const setting = cloud?.newLibrarySetting?.({
      defaultRoot: fileSystem.defaultRoot.value,
      defaultCloudRoot: fileSystem.defaultCloudRoot.value,
      authStatus: auth.status.value,
      isAuthenticated: auth.status.value === 'signedIn',
      ...runtime.info.value,
    })
    if (!setting?.path) {
      return
    }
    hasMaterializedCloud = Boolean(libraries.addLibrary(setting))
  })
}
