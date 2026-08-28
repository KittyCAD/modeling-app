import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { engineConnectionService } from '@src/contracts/engine'
import { sceneInteractionsValueSpec } from '@src/contracts/engineScene'
import {
  settingsSectionsValueSpec,
  settingsService,
  settingsValueSpec,
} from '@src/contracts/settings'
import { createCameraInteraction } from '@src/features/engineScene/camera/createCameraInteraction'
import { cameraMouseGuards } from '@src/features/engineScene/camera/mouseGuards'
import {
  cameraControlsSetting,
  cameraOrbitSetting,
  cameraProjectionSetting,
  cameraSettings,
} from '@src/features/engineScene/camera/settings'

/**
 * The camera, as a sub-feature of the scene.
 *
 * It owns three preferences and every pointer event that reaches the viewport,
 * and nothing else in the app needs either. Separating it from the scene is not
 * tidiness: the scene's job is finished once the engine knows how to draw, while
 * this one is a live translation of input, and the two have no shared state.
 *
 * There is no local camera here at all. The engine holds the scene and the
 * viewport is a video of it, so a drag is a message and the answer is a frame.
 */
export default defineRegistryItemFactory((ctx) => {
  const engine = () => ctx.services.get(engineConnectionService)
  const settings = () => ctx.services.get(settingsService)

  /**
   * Keep the engine's projection in step.
   *
   * Restated on a new scene, like everything else the engine forgets. Perspective
   * needs a field of view; 45 degrees is what the existing app uses.
   */
  let stopApplying = () => {}
  queueMicrotask(() => {
    const connection = engine()
    const connected = computed(
      () => connection.state.value.status === 'connected'
    )

    stopApplying = effect(() => {
      const projection = settings().value(cameraProjectionSetting).value
      void connection.sceneEpoch.value
      if (!connected.value) return

      connection.fireCommand(
        projection === 'orthographic'
          ? { type: 'default_camera_set_orthographic' }
          : {
              type: 'default_camera_set_perspective',
              parameters: { fov_y: 45 },
            }
      )
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'engineScene.camera',
      dispose: () => stopApplying(),
      provides: [
        ...cameraSettings.map((setting) => provide(settingsValueSpec, setting)),

        provide(settingsSectionsValueSpec, {
          id: 'camera',
          title: 'Camera',
          description: 'How the 3D view moves, and how it is drawn.',
          icon: 'cube',
          order: 5,
        }),

        /**
         * Pointer handling, attached to whatever element the stream is drawn on.
         *
         * The guard table and the orbit type are read per event rather than
         * captured, so changing either takes effect on the next gesture instead
         * of on the next connection.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'camera',
          order: 100,
          attach: (element) =>
            createCameraInteraction(element, {
              connection: engine(),
              guard: () => {
                const system = settings().read(cameraControlsSetting)
                const guards = cameraMouseGuards(
                  typeof navigator === 'undefined' ? '' : navigator.platform
                )
                return guards[system] ?? guards.zoo
              },
              orbit: () => settings().read(cameraOrbitSetting),
            }),
        }),

        provide(commandsValueSpec, {
          id: 'camera.toggleProjection',
          title: 'Switch camera projection',
          category: 'Model',
          icon: 'cube',
          run: () => {
            const current = settings().read(cameraProjectionSetting)
            settings().set(
              cameraProjectionSetting,
              'user',
              current === 'orthographic' ? 'perspective' : 'orthographic'
            )
          },
        }),
      ],
    }),
  }
}, 'engineScene.camera')
