import {
  createPlugin,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  pluginsValueSpec,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { cameraDriverService, sceneItemsValueSpec } from '@src/contracts/scene'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { BevySurface } from '@src/features/bevyScene/BevySurface'
import { createBevyCameraDriver } from '@src/features/bevyScene/createBevyCameraDriver'
import { createBevyProjection } from '@src/features/bevyScene/createBevyProjection'
import { whenBevyStarted } from '@src/features/bevyScene/loadBevy'
import {
  bevySceneSettings,
  rendererSetting,
} from '@src/features/bevyScene/settings'

/** The engine's camera plugin, declared in `features/engineScene`. */
const ENGINE_CAMERA = 'engineScene.camera'
const BEVY_CAMERA = 'bevyScene.camera'

/**
 * A second renderer: bevy-zoo, drawing in this process.
 *
 * `ARCHITECTURE.md` names this as the case the renderer seams were designed for.
 * The camera is the seam that carries the most: which button and modifier mean
 * orbit, how a drag captures the pointer, the three preferences and the seven
 * guard tables are all upstream in `features/camera`, and all this contributes is
 * a driver — the part that is genuinely peculiar to a renderer in this process.
 *
 * Picking and projection are still the engine's, so selection and sketching are
 * unavailable while this renderer is drawing rather than wrong.
 */
export default defineRegistryItemFactory((ctx) => {
  const settings = () => ctx.services.get(settingsService)

  /**
   * Built now, connected later.
   *
   * The module cannot start until a canvas exists, which is when the surface
   * mounts, but the driver has to be providable from the moment the feature is
   * registered. It holds a promise and drops camera movements until it resolves.
   */
  const driver = createBevyCameraDriver({ module: whenBevyStarted() })

  /**
   * Where that camera is, for whatever draws over the scene.
   *
   * The read side of the same seam. Without it the view gizmo follows the
   * *engine's* camera, which never moves while this renderer is drawing, so it
   * sits still and looks broken.
   */
  const projection = createBevyProjection()

  const cameraPlugin = createPlugin({
    id: BEVY_CAMERA,
    title: 'bevy-zoo camera',
    description: 'Moves the local Bevy camera, and says where it is.',
    // The engine's camera is the one installed at startup, and the default
    // renderer is the engine. Enabling both would make every consumer of
    // `cameraDriverService` throw.
    enabledByDefault: false,
    items: [
      defineRuntimeRegistryItem({
        id: 'bevyScene.camera.driver',
        providesServices: [
          provideService(cameraDriverService, driver),
          provideService(sceneProjectionService, projection),
        ],
      }),
    ],
  })

  /**
   * Hand the camera to exactly one renderer.
   *
   * Deferred out of the flatten with `queueMicrotask`, because services cannot be
   * read while the graph is being flattened. Modelled on
   * `features/pluginManagement`, which does the same job for the boolean plugin
   * settings; this cannot reuse it because that keys off a
   * `SettingDefinition<boolean>` and the renderer is a choice of several.
   */
  let stopArbitrating = () => {}
  queueMicrotask(() => {
    const plugins = computed(() => ctx.valueSpecs.get(pluginsValueSpec))

    const controllerFor = (id: string) => {
      const plugin = plugins.value.find((candidate) => candidate.id === id)
      return plugin ? ctx.services.optional(plugin.service) : undefined
    }

    const hand = (wanted: string) => {
      const winner = controllerFor(wanted)
      const loser = controllerFor(
        wanted === BEVY_CAMERA ? ENGINE_CAMERA : BEVY_CAMERA
      )
      if (!winner) return

      // Disable first, always. Any moment with both slots populated is a moment
      // where `cameraDriverService` resolves to two implementations and every
      // consumer — the gesture recogniser, the view commands, the gizmo — throws
      // `ServiceConflictError`.
      if (loser?.active.value) loser.disable()
      if (!winner.active.value) winner.enable()
    }

    stopArbitrating = effect(() => {
      const store = settings()
      // Until the file has been read, the default is the engine's, and acting on
      // it would hand the camera over and immediately take it back.
      if (!store.hydrated.value) return

      const wanted =
        store.value(rendererSetting).value === 'bevy'
          ? BEVY_CAMERA
          : ENGINE_CAMERA

      // Swapped outside this effect deliberately. Reconfiguring a slot is
      // forbidden while the graph is being flattened, and reading the plugin list
      // in here is what starts a flatten.
      queueMicrotask(() => hand(wanted))
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'bevyScene',
      dispose: () => {
        stopArbitrating()
        driver.dispose()
      },
      // The arbiter lives here, outside both slots it mutates, so it survives
      // whichever one it just turned off.
      uses: [cameraPlugin],
      provides: [
        ...bevySceneSettings.map((setting) =>
          provide(settingsValueSpec, setting)
        ),

        /**
         * The surface, in the `fill` zone and under everything else in it.
         *
         * Presence is constant and `visible` does the switching, because a
         * registry item's `provides` is fixed when it is defined — only a
         * contribution's value may be a signal. `visible` omits the item from the
         * DOM entirely while false, so no canvas exists and no wasm is fetched
         * until somebody chooses this renderer.
         */
        provide(sceneItemsValueSpec, {
          id: 'bevyScene.surface',
          zone: 'fill',
          order: -1000,
          visible: computed(
            () => settings().value(rendererSetting).value === 'bevy'
          ),
          render: () => <BevySurface />,
        }),
      ],
    }),
  }
}, 'bevyScene')
