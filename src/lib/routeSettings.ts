import type { App } from '@src/lib/app'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'

/**
 * Load and validate settings with the registry's contributions applied.
 *
 * Shared by route initialization and by opening a project, which both need it
 * and neither of which should own it.
 *
 * Note this *writes*: `loadAndValidateSettings` recreates missing files, so
 * calling it with a `projectPath` that is not really a project root creates a
 * `project.toml` there and makes that folder look like one. Resolve the project
 * root first.
 */
export function loadRouteSettings(
  app: App,
  wasmInstance: Awaited<App['wasmPromise']>,
  projectPath?: string
) {
  return loadAndValidateSettings(wasmInstance, {
    defaultProjectLibraries: app.registry.get(
      projectLibrarySettingDefaultsValueSpec
    ),
    projectLibrarySettingDefaultPolicies: app.registry.get(
      projectLibrarySettingDefaultPoliciesValueSpec
    ),
    extensionSettings: app.registry.get(settingsValueSpec),
    projectPath,
  })
}
