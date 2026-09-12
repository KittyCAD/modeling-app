import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { DFM_REVIEW_FEATURE_FLAG } from '@src/lib/constants'
import { modesValueSpec } from '@src/registry/contracts/modes'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import dfmReview, {
  DFM_REVIEW_MODE_ID,
  DFM_REVIEW_PLUGIN_ID,
} from '@src/registry/plugins/dfmReview'
import { afterEach, describe, expect, it } from 'vitest'

describe('DFM Review plugin', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
  })

  it('registers its engine-backed mode only while the plugin is enabled', async () => {
    registry = new Registry()
    registry.configure([dfmReview])

    const [plugin] = registry.get(pluginsValueSpec)
    const toggle = registry.get(plugin.service)
    expect(plugin).toMatchObject({
      id: DFM_REVIEW_PLUGIN_ID,
      title: 'DFM Review',
    })
    expect(toggle.active.value).toBe(false)
    expect(registry.get(modesValueSpec)).toEqual([])
    expect(
      registry
        .get(settingsValueSpec)
        .plugins[DFM_REVIEW_PLUGIN_ID].createSetting()
    ).toMatchObject({
      default: false,
      hideWithoutFeature: DFM_REVIEW_FEATURE_FLAG,
    })
    expect(registry.get(zdsPluginActivationSettingsValueSpec)).toEqual([
      expect.objectContaining({
        pluginId: DFM_REVIEW_PLUGIN_ID,
        featurePolicy: {
          feature: DFM_REVIEW_FEATURE_FLAG,
          defaultEnabled: true,
          disableWithoutFeature: true,
        },
      }),
    ])

    await toggle.enable()

    const [mode] = registry.get(modesValueSpec)
    expect(mode).toMatchObject({
      id: DFM_REVIEW_MODE_ID,
      label: 'DFM Review',
    })
    expect(mode.Scene).toBeUndefined()
    expect(mode.keymapScope).toBeUndefined()
    expect(mode.toolbar).toHaveLength(16)

    await toggle.disable()

    expect(registry.get(modesValueSpec)).toEqual([])
  })
})
