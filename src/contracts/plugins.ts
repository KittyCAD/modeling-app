import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { RuntimeTarget } from '@src/contracts/runtime'
import type { SettingDefinition } from '@src/contracts/settings'

/** Persisted activation policy for one slot-backed registry plugin. */
export interface PluginActivationContribution {
  pluginId: string
  setting: SettingDefinition<boolean>
  /** Platforms where the plugin is infrastructure rather than optional. */
  forceEnabledOn?: readonly RuntimeTarget[]
}

export const pluginsContract = defineContract({
  pluginActivationsValueSpec: appendValueSpec<PluginActivationContribution>(
    'plugins.activations'
  ),
})

export const { pluginActivationsValueSpec } = pluginsContract
