import { defineContract, defineValueSpec } from '@kittycad/registry'
import {
  type ExtensionSettingsContribution,
  type ResolvedExtensionSettings,
  mergeExtensionSettings,
} from '@src/lib/settings/extensionSettings'

/**
 * App-owned settings extension point.
 *
 * Today the settings actor remains the in-memory source of truth and this value
 * spec only contributes extra setting definitions into that model during
 * startup. A follow-up PR can invert that relationship by having core settings
 * contribute through this value spec too, then deriving the actor context from
 * the fully resolved value-spec output.
 */
export const settingsContract = defineContract({
  settingsValueSpec: defineValueSpec<
    ExtensionSettingsContribution,
    ResolvedExtensionSettings
  >({
    name: 'settings',
    defaultValue: {},
    combine: mergeExtensionSettings,
  }),
})

export const { settingsValueSpec } = settingsContract
