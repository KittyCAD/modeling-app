import type { Feature } from '@kittycad/lib'
import {
  appendValueSpec,
  createPlugin,
  defineRegistryItem,
  provide,
  type RegistryItem,
  type RegistryItemDefinition,
} from '@kittycad/registry'
import {
  defineBooleanExtensionSetting,
  type ExtensionSettingDefinition,
} from '@src/lib/settings/extensionSettings'
import type {
  HideOnPlatformValue,
  SettingsLevel,
} from '@src/lib/settings/settingsTypes'
import { settingsValueSpec } from '@src/registry/contracts/settings'

type ZdsPluginDefault = 'core' | 'off'
type ZdsPluginActivationSettingCategory = 'modeling' | 'plugins' | 'auth'

export type ZdsPluginFeatureActivationPolicy = {
  /**
   * Feature flag that controls whether this plugin may become active.
   */
  feature: Feature
  /**
   * When true, feature-flagged users get the plugin enabled by default. Existing
   * user preferences are preserved unless `forceEnabledOnPlatform` matches.
   */
  defaultEnabled?: boolean
  /**
   * On this platform, keep the plugin enabled whenever the feature is available.
   * This is useful when a plugin is infrastructure rather than an optional tool.
   */
  forceEnabledOnPlatform?: HideOnPlatformValue
  /**
   * Prevent runtime activation when the feature is missing, even if persisted
   * settings say the plugin should be active.
   */
  disableWithoutFeature?: boolean
}

export type ZdsPluginActivationSetting = {
  pluginId: string
  category: ZdsPluginActivationSettingCategory
  settingName: string
  /**
   * Derive activation from a non-boolean setting value.
   *
   * Boolean settings get activation for free. Object or string settings can use
   * this pure predicate to drive plugin activation from account/session state.
   */
  isActive?: (value: unknown) => boolean
  featurePolicy?: ZdsPluginFeatureActivationPolicy
}

export const zdsPluginActivationSettingsValueSpec =
  appendValueSpec<ZdsPluginActivationSetting>('zds-plugin-activation-settings')

export function resolveZdsPluginActivation(
  activationSetting: Pick<ZdsPluginActivationSetting, 'isActive'> | undefined,
  value: unknown
): boolean | undefined {
  if (activationSetting?.isActive) {
    return activationSetting.isActive(value)
  }

  return typeof value === 'boolean' ? value : undefined
}

type ZdsPluginActivationSettingSpec = {
  category: ZdsPluginActivationSettingCategory
  settingName: string
  settingDefinition?: ExtensionSettingDefinition
  contributeSetting?: boolean
  isActive?: (value: unknown) => boolean
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
  /**
   * Hide the activation toggle unless the user has this feature flag. Lets a
   * feature-gated plugin (e.g. cloud sync) drop out of the settings panel,
   * command bar, and plugins list through the same settings config rather than
   * a bespoke check per surface.
   */
  hideWithoutFeature?: Feature
  featurePolicy?: ZdsPluginFeatureActivationPolicy
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
  const shouldContributeActivationSetting =
    activationSetting.contributeSetting !== false
  const activationSettingDefinition =
    activationSetting.settingDefinition ??
    defineBooleanExtensionSetting({
      defaultValue: enabledByDefault,
      title: activationSetting.title,
      description: activationSetting.description,
      commandConfig: activationSetting.commandConfig,
      hideOnLevel: activationSetting.hideOnLevel,
      hideOnPlatform: activationSetting.hideOnPlatform,
      hideWithoutFeature: activationSetting.hideWithoutFeature,
      userToml: activationSetting.userToml,
      projectToml: activationSetting.projectToml,
    })

  return defineRegistryItem({
    id: `${spec.id}.zds-plugin`,
    uses: [
      createPlugin({
        ...spec,
        enabledByDefault,
      }),
    ],
    provides: [
      ...(shouldContributeActivationSetting
        ? [
            provide(settingsValueSpec, {
              [activationSetting.category]: {
                [activationSetting.settingName]: activationSettingDefinition,
              },
            }),
          ]
        : []),
      provide(zdsPluginActivationSettingsValueSpec, {
        pluginId: spec.id,
        category: activationSetting.category,
        settingName: activationSetting.settingName,
        isActive: activationSetting.isActive,
        featurePolicy: activationSetting.featurePolicy,
      }),
    ],
  })
}
