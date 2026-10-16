import type { ZooFeatureTree } from '@kittycad/ui-components/web-components'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import type { ExtensionSettingDefinition } from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { Setting } from '@src/lib/settings/Setting'

/** The tree display also determines the surface of its containing Browser. */
export type FeatureTreeDisplay = 'hud' | 'standard'

function parseFeatureTreeDisplay(
  value: unknown
): FeatureTreeDisplay | undefined {
  return value === 'hud' || value === 'standard' ? value : undefined
}

export const featureTreeSettings = {
  modeling: {
    featureTreeDisplay: {
      createSetting: () =>
        new Setting<FeatureTreeDisplay>({
          defaultValue: 'hud',
          title: 'Feature tree style',
          description:
            'Choose HUD for minimal branch guides and a faintly frosted Scene browser, or Solid for standard rows and a stronger frosted surface.',
          hideOnLevel: 'project',
          hideWithoutFeature: SCENE_BROWSER_FEATURE,
          validate: (value) => parseFeatureTreeDisplay(value) !== undefined,
          commandConfig: {
            inputType: 'options',
            options: [
              { name: 'HUD', value: 'hud' },
              { name: 'Solid', value: 'standard' },
            ],
          },
        }),
      userToml: {
        sectionKey: 'modeling',
        tomlKey: 'feature_tree_display',
        fromToml: parseFeatureTreeDisplay,
        toToml: parseFeatureTreeDisplay,
      },
    } satisfies ExtensionSettingDefinition,
  },
}

export function getFeatureTreeAppearance(
  settings?: Pick<SettingsType, 'modeling'>
): ZooFeatureTree['appearance'] {
  const modeling = settings?.modeling as
    | Record<string, Setting<FeatureTreeDisplay>>
    | undefined
  return modeling?.featureTreeDisplay?.currentSignal.value === 'standard'
    ? 'default'
    : 'hud'
}
