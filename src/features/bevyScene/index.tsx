import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { sceneItemsValueSpec } from '@src/contracts/scene'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { BevySurface } from '@src/features/bevyScene/BevySurface'
import {
  bevySceneSettings,
  rendererSetting,
} from '@src/features/bevyScene/settings'

/**
 * A second renderer: bevy-zoo, drawing in this process.
 *
 * `ARCHITECTURE.md` names this as the case the renderer seams were designed for,
 * and this is the first thing to actually sit in one. It is deliberately the
 * smallest such thing: a setting and a surface.
 *
 * It provides **no services**. That is the whole reason this can coexist with
 * `engineScene` without any arbitration: two items providing one singleton
 * service make `ctx.services.get` throw for every consumer, including through
 * `optional()`. So the camera driver, the picker and the projection stay the
 * engine's, and under this renderer the view gizmo and the `v 1`…`v 6` commands
 * are inert — bevy-zoo's own orbit camera has the mouse instead.
 *
 * Wiring a real `CameraDriver` is the next increment, and it is the one that
 * forces a slot arbiter: at that point the two renderers genuinely cannot both be
 * registered.
 */
export default defineRegistryItemFactory((ctx) => {
  const settings = () => ctx.services.get(settingsService)

  return {
    item: defineRuntimeRegistryItem({
      id: 'bevyScene',
      provides: [
        ...bevySceneSettings.map((setting) =>
          provide(settingsValueSpec, setting)
        ),

        /**
         * The surface, in the `fill` zone and under everything else in it.
         *
         * Presence is constant and `visible` does the switching, because a
         * registry item's `provides` is fixed when it is defined — only a
         * contribution's *value* may be a signal. `visible` omits the item from
         * the DOM entirely while false, so nothing is loaded and no canvas exists
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
