import {
  createPlugin,
  defineRegistryItem,
  provide,
  type RegistryItem,
  type RegistryItemDefinition,
} from '@kittycad/registry'
import {
  type PluginActivationContribution,
  pluginActivationsValueSpec,
} from '@src/contracts/plugins'
import {
  booleanSetting,
  type SettingDefinition,
  settingsValueSpec,
} from '@src/contracts/settings'

interface AppPluginSpec {
  id: string
  title: string
  description: string
  items: readonly RegistryItem[]
  enabledByDefault?: boolean
  activation?: Partial<
    Omit<PluginActivationContribution, 'pluginId' | 'setting'>
  > & {
    settingDefinition?: SettingDefinition<boolean>
    setting?: Partial<
      Pick<
        PluginActivationContribution['setting'],
        'title' | 'description' | 'platforms' | 'toml'
      >
    >
  }
}

/**
 * App-level plugin wrapper.
 *
 * The generic registry owns slot toggling. This adapter contributes its stable
 * controller to the Settings cascade, which owns persistence and platform
 * visibility for this application.
 */
export function createAppPlugin({
  enabledByDefault = false,
  activation,
  ...plugin
}: AppPluginSpec): RegistryItemDefinition {
  const setting =
    activation?.settingDefinition ??
    booleanSetting({
      id: `plugins.${plugin.id}`,
      section: 'plugins',
      title: activation?.setting?.title ?? plugin.title,
      description: activation?.setting?.description ?? plugin.description,
      order: 0,
      defaultValue: enabledByDefault,
      levels: ['user'],
      platforms: activation?.setting?.platforms,
      toml: activation?.setting?.toml ?? ['settings', 'plugins', plugin.id],
    })

  return defineRegistryItem({
    id: `${plugin.id}.appPlugin`,
    uses: [createPlugin({ ...plugin, enabledByDefault })],
    provides: [
      provide(settingsValueSpec, setting),
      provide(pluginActivationsValueSpec, {
        pluginId: plugin.id,
        setting,
        forceEnabledOn: activation?.forceEnabledOn,
      }),
    ],
  })
}
