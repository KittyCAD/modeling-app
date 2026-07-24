import {
  type RegistryItem,
  type RegistryItemDefinition,
  appendValueSpec,
  createPlugin,
  defineRegistryItem,
  provide,
} from '@kittycad/registry'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type {
  HideOnPlatformValue,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import { settingsValueSpec } from '@src/registry/contracts/settings'

type ZdsPluginDefault = 'core' | 'off'
type ZdsPluginActivationSettingCategory = 'modeling' | 'plugins'

export type ZdsPluginActivationSetting = {
  pluginId: string
  category: ZdsPluginActivationSettingCategory
  settingName: string
}

export const zdsPluginActivationSettingsValueSpec =
  appendValueSpec<ZdsPluginActivationSetting>('zds-plugin-activation-settings')

type ZdsPluginActivationSettingSpec = {
  category: ZdsPluginActivationSettingCategory
  settingName: string
  title?: string
  description?: string
  commandConfig?: { inputType: 'boolean' }
  hideOnLevel?: SettingsLevel
  /**
   * Hide the activation toggle on a platform. Used to make a plugin
   * non-optional there (e.g. cloud sync on web, where it is the storage layer).
   * Enforcement that the value cannot be turned off is handled separately in
   * the app runtime; this only removes the settings control.
   */
  hideOnPlatform?: HideOnPlatformValue
  userToml?: { sectionKey: string; tomlKey: string }
  projectToml?: { sectionKey: string; tomlKey: string }
}

type ZdsPluginSpec = {
  id: string
  title: string
  description: string
  items: readonly RegistryItem[]
  defaultSetting?: ZdsPluginDefault
  activationSetting?: ZdsPluginActivationSettingSpec
}

/**
 * Wrap the generic plugin helper with ZDS-specific settings integration.
 *
 * Each plugin automatically contributes a TS-only boolean setting at
 * `plugins.<plugin-id>` unless a custom activation setting is supplied. The
 * settings actor remains the source of truth and the app syncs that setting
 * back into the plugin toggle service after load.
 */
export function createZdsPlugin({
  defaultSetting = 'core',
  ...spec
}: ZdsPluginSpec): RegistryItemDefinition {
  const enabledByDefault = defaultSetting === 'core'
  const activationSetting: ZdsPluginActivationSettingSpec =
    spec.activationSetting ?? {
      category: 'plugins',
      settingName: spec.id,
      description: `Whether the ${spec.title} plugin is enabled.`,
      hideOnLevel: 'project',
      userToml: {
        sectionKey: 'plugins',
        tomlKey: spec.id,
      },
    }

  return defineRegistryItem({
    id: `${spec.id}.zds-plugin`,
    uses: [
      createPlugin({
        ...spec,
        enabledByDefault,
      }),
    ],
    provides: [
      provide(settingsValueSpec, {
        [activationSetting.category]: {
          [activationSetting.settingName]: defineBooleanExtensionSetting({
            defaultValue: enabledByDefault,
            title: activationSetting.title,
            description: activationSetting.description,
            commandConfig: activationSetting.commandConfig,
            hideOnLevel: activationSetting.hideOnLevel,
            hideOnPlatform: activationSetting.hideOnPlatform,
            userToml: activationSetting.userToml,
            projectToml: activationSetting.projectToml,
          }),
        },
      }),
      provide(zdsPluginActivationSettingsValueSpec, {
        pluginId: spec.id,
        category: activationSetting.category,
        settingName: activationSetting.settingName,
      }),
    ],
  })
}
