import { sceneRenderingService } from '@src/registry/contracts/sceneRendering'
import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { rayTracingService } from '@src/registry/contracts/rayTracing'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../rayTracingDebug/RayTracingDebugPanel', () => ({
  RayTracingDebugPanel: () => null,
}))
import rayTracing from '.'
import debug from '../rayTracingDebug'

function fixture() {
  const registry = new Registry()
  registry.configure([rayTracing, debug])
  function toggle(id: string) {
    const plugin = registry.get(pluginsValueSpec).find((p) => p.id === id)
    if (!plugin) throw new Error('Missing plugin')
    return registry.get(plugin.service)
  }
  return {
    registry,
    rt: toggle('ray-tracing'),
    debug: toggle('ray-tracing-debug'),
  }
}

describe('ray tracing plugin composition', () => {
  it('contributes a persisted modeling activation setting and defaults both plugins off', () => {
    const { registry, rt, debug } = fixture()
    expect(rt.active.value).toBe(false)
    expect(debug.active.value).toBe(false)
    expect(registry.optional(rayTracingService)).toBeUndefined()
    expect(registry.optional(sceneRenderingService)).toBeUndefined()
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toEqual([])
    const setting = registry.get(settingsValueSpec).modeling.rayTracing
    expect(setting.createSetting().default).toBe(false)
    expect(setting.userToml).toMatchObject({
      sectionKey: 'modeling',
      tomlKey: 'ray_tracing',
    })
    expect(registry.get(zdsPluginActivationSettingsValueSpec)).toContainEqual({
      pluginId: 'ray-tracing',
      category: 'modeling',
      settingName: 'rayTracing',
      featurePolicy: undefined,
    })
    registry[Symbol.dispose]()
  })

  it('keeps tracing and experimental options alive when only the debug panel is disabled', async () => {
    const { registry, rt, debug } = fixture()
    await rt.enable()
    const service = registry.get(rayTracingService)
    expect(service.options.value.fadeDuration).toBe(800)
    expect(registry.optional(sceneRenderingService)).toBeDefined()
    service.update({ thresholdPercent: 25, denoiseFadeDuration: 500 })
    await debug.enable()
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toMatchObject([
      { id: 'ray-tracing-debug.panel', zone: 'right' },
    ])
    await debug.disable()
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toEqual([])
    expect(registry.get(rayTracingService)).toBe(service)
    expect(service.options.value.thresholdPercent).toBe(25)
    await rt.disable()
    expect(registry.optional(rayTracingService)).toBeUndefined()
    expect(registry.optional(sceneRenderingService)).toBeUndefined()
    await rt.enable()
    expect(registry.get(rayTracingService)).not.toBe(service)
    registry[Symbol.dispose]()
  })
})
