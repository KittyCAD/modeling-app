import {
  createPlugin,
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals'
import type { CameraDriver } from '@src/contracts/scene'
import { cameraDriverService } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import type { SettingsService } from '@src/contracts/settings'
import { settingsService } from '@src/contracts/settings'
import bevySceneFeature from '@src/features/bevyScene'
import { rendererSetting } from '@src/features/bevyScene/settings'
import { describe, expect, it } from 'vitest'

/**
 * Stands in for `engineScene`'s camera slot.
 *
 * The real feature needs a socket, a theme and an execution coordinator to be
 * built at all; what matters here is only that a plugin with this id owns
 * `cameraDriverService` and starts enabled, which is exactly what it does.
 */
const ENGINE_CAMERA = 'engineScene.camera'

const engineDriver = { id: 'engine' } as unknown as CameraDriver
const engineProjection = { id: 'engine' } as unknown as SceneProjection

function harness(renderer: 'engine' | 'bevy', hydrated = true) {
  const choice = signal(renderer)
  const settings = {
    hydrated: signal(hydrated),
    value: (setting: unknown) =>
      setting === rendererSetting ? choice : signal(undefined),
    read: () => undefined,
  } as unknown as SettingsService

  const registry = new Registry()
  registry.configure([
    bevySceneFeature,
    createPlugin({
      id: ENGINE_CAMERA,
      title: 'Zoo engine camera',
      description: 'Stub.',
      enabledByDefault: true,
      items: [
        defineRegistryItem({
          id: 'engineScene.camera.driver',
          providesServices: [
            provideService(cameraDriverService, engineDriver),
            provideService(sceneProjectionService, engineProjection),
          ],
          provides: [],
        }),
      ],
    }),
    defineRegistryItem({
      id: 'test.stubs',
      providesServices: [provideService(settingsService, settings)],
      provides: [],
    }),
  ])

  /**
   * Read once, to flatten.
   *
   * The feature is a runtime factory, so it does not run — and the arbiter does
   * not exist — until something reads the graph. In the app the settings service
   * does that at startup while collecting setting definitions; here it has to be
   * asked for explicitly, or every assertion below races the factory.
   */
  registry.get(cameraDriverService)

  return { registry, choice }
}

/** The arbiter defers out of the flatten, so give the microtask a turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the renderer arbiter', () => {
  it('configures without resolving a service too early', () => {
    expect(() => harness('engine')).not.toThrow()
  })

  it('leaves the camera with the engine by default', async () => {
    const { registry } = harness('engine')
    await settle()

    expect(registry.get(cameraDriverService).id).toBe('engine')
  })

  it('hands the camera to bevy when it is chosen', async () => {
    const { registry } = harness('bevy')
    await settle()

    expect(registry.get(cameraDriverService).id).toBe('bevy')
  })

  /**
   * The whole reason the arbiter disables before enabling. Two providers of a
   * singleton service make `get` throw for every consumer, so a moment with both
   * slots populated would take out the gesture recogniser, the view commands and
   * the gizmo at once — and `optional()` would not soften it.
   */
  it('never lets both cameras provide the service', async () => {
    const { registry, choice } = harness('engine')
    await settle()
    expect(registry.get(cameraDriverService).id).toBe('engine')

    choice.value = 'bevy'
    await settle()
    expect(() => registry.get(cameraDriverService)).not.toThrow()
    expect(registry.get(cameraDriverService).id).toBe('bevy')

    choice.value = 'engine'
    await settle()
    expect(() => registry.get(cameraDriverService)).not.toThrow()
    expect(registry.get(cameraDriverService).id).toBe('engine')
  })

  /**
   * The read side moves with the write side.
   *
   * This is what makes the view gizmo follow: it asks the projection where the
   * camera is, and a projection belonging to a renderer that is not drawing never
   * moves — so the cube sits still while the model turns.
   */
  it('hands the projection over with the camera', async () => {
    const { registry, choice } = harness('engine')
    await settle()
    expect(registry.get(sceneProjectionService).id).toBe('engine')

    choice.value = 'bevy'
    await settle()
    expect(registry.get(cameraDriverService).id).toBe('bevy')
    expect(registry.get(sceneProjectionService).id).toBe('bevy')
  })

  /**
   * Before the settings file has been read every value is its default, and acting
   * on that would hand the camera over and immediately take it back.
   */
  it('waits for settings to hydrate before moving anything', async () => {
    const { registry } = harness('bevy', false)
    await settle()

    expect(registry.get(cameraDriverService).id).toBe('engine')
  })
})
