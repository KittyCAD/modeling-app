import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import {
  type ExtensionSettingsContribution,
  type ResolvedExtensionSettings,
  mergeExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'

export type SettingsRegistryService = {
  actor: SettingsActorType
  current: ReadonlySignal<SettingsType>
  get: () => SettingsType
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
