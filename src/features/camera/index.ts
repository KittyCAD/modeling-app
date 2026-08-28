import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import {
  type StandardView,
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
/**
 * The six axis views and the isometric, with the keystroke that asks for each.
 *
 * Numbered as the existing app numbers them, which is neither alphabetical nor
 * axis order: it is the order a machinist reads a drawing in.
 */
const standardViews: readonly {
  view: StandardView
  title: string
  keystroke: string
}[] = [
  { view: 'top', title: 'Top view', keystroke: '1' },
  { view: 'right', title: 'Right view', keystroke: '2' },
  { view: 'front', title: 'Front view', keystroke: '3' },
  { view: 'back', title: 'Back view', keystroke: '4' },
  { view: 'bottom', title: 'Bottom view', keystroke: '5' },
  { view: 'left', title: 'Left view', keystroke: '6' },
  { view: 'isometric', title: 'Reset view', keystroke: 'r' },
]

export default defineRegistryItemFactory((ctx) => {
  const settings = () => ctx.services.get(settingsService)
  const driver = () => ctx.services.optional(cameraDriverService)

  /**
   * Whether there is anything to point.
   *
   * A viewport with no renderer is not broken, and neither is a view command
   * with nothing to show: it is unavailable, and the palette says so.
   */
  const hasRenderer = computed(() => driver()?.ready.value ?? false)

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

        /**
         * The named views.
         *
         * Commands first and keystrokes second: a view is a thing you can ask
         * for from the palette, and `v 1` is one way of asking. The sequence is
         * the existing app's — `v` then a digit, `v f` to fit, `v r` to reset —
         * because it is muscle memory worth keeping.
         *
         * All of them are dropped while no renderer is attached rather than
         * being hidden, so the palette can say what exists and why it is not
         * available.
         */
        ...standardViews.map(({ view, title }) =>
          provide(commandsValueSpec, {
            id: `camera.view.${view}`,
            title,
            category: 'View',
            icon: 'cube' as const,
            enabled: hasRenderer,
            run: () => driver()?.standardView(view),
          })
        ),
        ...standardViews.map(({ view, keystroke }) =>
          provide(keybindingsValueSpec, {
            keystrokes: ['v', keystroke],
            commandId: `camera.view.${view}`,
          })
        ),

        provide(commandsValueSpec, {
          id: 'camera.zoomToFit',
          title: 'Zoom to fit',
          category: 'View',
          icon: 'cube',
          enabled: hasRenderer,
          run: () => driver()?.zoomToFit(),
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['v', 'f'],
          commandId: 'camera.zoomToFit',
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
