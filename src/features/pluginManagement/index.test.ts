import {
  appendValueSpec,
  defineRegistryItem,
  pluginsValueSpec,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { createAppPlugin } from '@src/app/createAppPlugin'
import { type RuntimeTarget, runtimeService } from '@src/contracts/runtime'
import { type SettingsService, settingsService } from '@src/contracts/settings'
import pluginManagement from '@src/features/pluginManagement'
import { describe, expect, it } from 'vitest'

const activeItemsValueSpec = appendValueSpec<string>('test.activePluginItems')

function harness(target: RuntimeTarget, hydrated = true) {
  const enabled = signal(false)
  const hydration = signal(hydrated)
  const openSection = signal<string | null>(null)
  const settings = {
    sections: computed(() => []),
    hydrated: computed(() => hydration.value),
    error: computed(() => null),
    levels: [],
    value: () => computed(() => enabled.value),
    read: () => enabled.value,
    overrideAt: () => computed(() => undefined),
    inheritedAt: () => computed(() => enabled.value),
    set: (_setting, _level, value) => {
      enabled.value = Boolean(value)
    },
    clear: () => {
      enabled.value = false
    },
    supportsLevel: () => true,
    openSection: computed(() => openSection.value),
    open: (sectionId = 'plugins') => {
      openSection.value = sectionId
    },
    close: () => {
      openSection.value = null
    },
  } as SettingsService

  const services = defineRegistryItem({
    providesServices: [
      provideService(settingsService, settings),
      provideService(runtimeService, {
        info: computed(() => ({
          target,
          isDesktop: target === 'desktop',
          isWeb: target === 'web',
          isTest: true,
          version: 'test',
        })),
      }),
    ],
  })
  const plugin = createAppPlugin({
    id: 'optionalTest',
    title: 'Optional test',
    description: 'Test plugin.',
    items: [
      defineRegistryItem({
        provides: [provide(activeItemsValueSpec, 'active')],
      }),
    ],
    activation: { forceEnabledOn: ['web'] },
  })
  const registry = new Registry()
  registry.configure([services, plugin, pluginManagement])
  return { enabled, hydration, registry }
}

describe('plugin management', () => {
  it('synchronizes a persisted setting with the plugin slot', async () => {
    const { enabled, registry } = harness('desktop')
    expect(registry.get(activeItemsValueSpec)).toEqual([])
    await Promise.resolve()

    enabled.value = true
    expect(registry.get(activeItemsValueSpec)).toEqual(['active'])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(registry.get(plugin.service).active.value).toBe(true)
    registry.configure([])
  })

  it('forces platform infrastructure on before settings hydrate', async () => {
    const { registry } = harness('web', false)
    registry.get(pluginsValueSpec)
    await Promise.resolve()

    expect(registry.get(activeItemsValueSpec)).toEqual(['active'])
    registry.configure([])
  })
})
