import {
  createPlugin,
  defineExtension,
  provide,
  type ExtensionDefinition,
  type ExtensionNode,
} from '@kittycad/extensions'
import { settingsSignal } from '@src/signals'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'

type ZdsPluginDefault = 'core' | 'off'

type ZdsPluginSpec = {
  id: string
  title: string
  description: string
  extensions: readonly ExtensionNode[]
  defaultSetting?: ZdsPluginDefault
}

/**
 * Wrap the generic plugin helper with ZDS-specific settings integration.
 *
 * Each plugin automatically contributes a TS-only boolean setting at
 * `plugins.<plugin-id>` so app settings can persist whether the plugin should
 * be enabled. For now the settings actor remains the source of truth and the
 * app syncs that setting back into the plugin toggle service after load.
 */
export function createZdsPlugin({
  defaultSetting = 'core',
  ...spec
}: ZdsPluginSpec): ExtensionDefinition {
  const enabledByDefault = defaultSetting === 'core'

  return defineExtension({
    id: `${spec.id}.zds-plugin`,
    uses: [
      createPlugin({
        ...spec,
        enabledByDefault,
      }),
    ],
    provides: [
      provide(settingsSignal, {
        plugins: {
          [spec.id]: defineBooleanExtensionSetting({
            defaultValue: enabledByDefault,
            description: `Whether the ${spec.title} plugin is enabled.`,
            hideOnLevel: 'project',
            userToml: {
              sectionKey: 'plugins',
              tomlKey: spec.id,
            },
          }),
        },
      }),
    ],
  })
}
