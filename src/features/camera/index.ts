import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { effect } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  cameraDriverService,
  sceneInteractionsValueSpec,
} from '@src/contracts/scene'
import {
  settingsSectionsValueSpec,
  settingsService,
  settingsValueSpec,
} from '@src/contracts/settings'
import { createGestureRecogniser } from '@src/features/camera/createGestureRecogniser'
import { cameraMouseGuards } from '@src/features/camera/mouseGuards'
import {
  cameraControlsSetting,
  cameraOrbitSetting,
  cameraProjectionSetting,
  cameraSettings,
} from '@src/features/camera/settings'

/**
 * The camera, independent of whatever is drawing.
 *
 * It owns three preferences and every pointer event that reaches the viewport,
 * and none of that is a property of the renderer. What the renderer owns is on
 * the other side of `cameraDriverService`: the pixel space, the cost of a
 * message, and whether the scene forgets.
 *
 * This used to sit under the engine scene, which was wrong — not because of the
 * directory but because the gesture recogniser had the engine's command
 * envelope, pixel space, and rate limit built into it. A second renderer would
 * have had to reimplement the guard table to get a camera.
 *
 * The driver is resolved optionally, and gestures are dropped while there is
 * none. A viewport with nothing rendering in it is not broken.
 */
export default defineRegistryItemFactory((ctx) => {
  const settings = () => ctx.services.get(settingsService)
  const driver = () => ctx.services.optional(cameraDriverService)

  /**
   * State the projection preference; the driver keeps it true.
   *
   * Deliberately not keyed on anything about the renderer's lifecycle. A
   * renderer that loses its scene is the only thing that knows it happened, so
   * restating is its job, not this effect's.
   */
  let stopStating = () => {}
  queueMicrotask(() => {
    stopStating = effect(() => {
      const projection = settings().value(cameraProjectionSetting).value
      driver()?.setProjection(projection)
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'camera',
      dispose: () => stopStating(),
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
         * Pointer handling, attached to whatever the scene is drawn on.
         *
         * The guard table and the orbit type are read per event rather than
         * captured, so changing either takes effect on the next gesture instead
         * of on the next connection.
         */
        provide(sceneInteractionsValueSpec, {
          id: 'camera',
          order: 100,
          attach: (element: HTMLElement) =>
            createGestureRecogniser(element, {
              driver,
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
}, 'camera')
