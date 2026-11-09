import type { ReadonlySignal } from '@preact/signals-core'
import {
  type ExtensionSettingsContribution,
  mergeExtensionSettings,
  type ResolvedExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { contract, Facet, service } from 'plankton'
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
export const settingsContract = contract({
  settingsService: service<SettingsRegistryService>('settings.service'),
  settingsFacet: new Facet<
    ExtensionSettingsContribution,
    ResolvedExtensionSettings
  >('settings', (inputs) =>
    inputs.length ? mergeExtensionSettings(inputs) : {}
  ),
})

export const { settingsService, settingsFacet } = settingsContract
