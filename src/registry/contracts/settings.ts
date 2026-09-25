import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import {
  type ExtensionSettingsContribution,
  type ResolvedExtensionSettings,
  mergeExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { DeepPartial } from '@src/lib/types'
import type { SettingsActorType } from '@src/machines/settingsMachine'

export interface LoadedPersistedSettings {
  settings: {
    app: {
      libraries?: {
        current?: readonly ProjectLibrarySetting[]
      }
    }
  }
  configuration: DeepPartial<Configuration>
}

export type SettingsRegistryService = {
  actor: SettingsActorType
  current: ReadonlySignal<SettingsType>
  get: () => SettingsType
  /**
   * Read persisted app or project settings, recreating missing settings files.
   * Callers must resolve the project root before providing `projectPath`.
   */
  loadOrCreate: (projectPath?: string) => Promise<LoadedPersistedSettings>
  send: SettingsActorType['send']
  useSettings: () => SettingsType
}

/**
 * App-owned settings extension point.
 *
 * Today the settings actor remains the in-memory source of truth. The service
 * exposes that actor's current settings to registry extensions, while the value
 * spec contributes extra setting definitions into the actor model during
 * startup.
 */
export const settingsContract = defineContract({
  settingsService: defineService<SettingsRegistryService>('settings.service'),
  settingsValueSpec: defineValueSpec<
    ExtensionSettingsContribution,
    ResolvedExtensionSettings
  >({
    name: 'settings',
    defaultValue: {},
    combine: mergeExtensionSettings,
  }),
})

export const { settingsService, settingsValueSpec } = settingsContract
