import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { engineConnectionService } from '@src/contracts/engine'
import { streamParamsValueSpec } from '@src/contracts/engineScene'
import { cameraDriverService } from '@src/contracts/scene'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { themeService } from '@src/contracts/theme'
import {
  HIGHLIGHT_COLOR,
  SELECTION_COLOR,
  backgroundColorFor,
  parseHexColor,
  systemColorFor,
} from '@src/features/engineScene/engineColors'
import { createEngineCameraDriver } from '@src/features/engineScene/createEngineCameraDriver'
import {
  backfaceColorSetting,
  enableSsaoSetting,
  highlightEdgesSetting,
  sceneSettings,
  showScaleGridSetting,
} from '@src/features/engineScene/settings'

/**
 * What the engine is showing, as opposed to how it is reached.
 *
 * The connection feature owns a socket; this owns the scene on the other end of
 * it. Everything here is a preference the engine cannot guess — the background
 * has to match the app's theme, edges are drawn or not, a backface has a colour
 * — and the engine starts each scene at its own defaults, so all of it has to be
 * stated and then restated.
 *
 * The camera is not here at all. It is its own feature, because which gesture a
 * button means and how someone likes to orbit stay true when the renderer
 * changes; all this file contributes is the driver on the other side of
 * `cameraDriverService` — the command envelope, the pixel space, and the rate
 * limit, none of which survive that change.
 */
export default defineRegistryItemFactory((ctx) => {
  const engine = () => ctx.services.get(engineConnectionService)
  const settings = () => ctx.services.get(settingsService)
  const themes = () => ctx.services.get(themeService)

  /**
   * Restate the scene's appearance.
   *
   * Keyed on `sceneEpoch` as well as on the values, because a fresh connection
   * is a fresh scene: the engine has forgotten everything it was told, and
   * nothing else would notice.
   *
   * Deliberately narrow about what it reads — `connected`, not the whole
   * connection state, which changes on every ping. Reading the latter meant
   * re-sending every scene command every few seconds, forever.
   */
  /**
   * The camera driver for this renderer.
   *
   * What it contributes is the answer to "how does a gesture become camera
   * motion here". A different renderer answers differently, and the camera
   * feature never learns which one it got.
   */
  const cameraDriver = createEngineCameraDriver(engine)

  let stopApplying = () => {}
  queueMicrotask(() => {
    const connection = engine()
    const connected = computed(
      () => connection.state.value.status === 'connected'
    )

    stopApplying = effect(() => {
      const edges = settings().value(highlightEdgesSetting).value
      const backface = settings().value(backfaceColorSetting).value
      const theme = themes().resolved.value
      // Read so the effect re-runs on a new scene, even when nothing changed.
      void connection.sceneEpoch.value
      if (!connected.value) return

      connection.fireCommand({
        type: 'edge_lines_visible',
        hidden: !edges,
      })
      connection.fireCommand({
        type: 'set_background_color',
        color: backgroundColorFor(theme),
      })

      /**
       * One command for every system colour, not one per preference.
       *
       * The engine takes them together, so sending the theme's line colour and
       * the backface colour as two commands would have the second drop whatever
       * the first had set. The existing app sends both and lives with it.
       */
      connection.fireCommand({
        type: 'set_default_system_properties',
        // Overlay geometry contrasts with the background rather than matching
        // it, so it takes the *opposite* theme's colour.
        color: systemColorFor(theme),
        backface_color: parseHexColor(backface) ?? undefined,
        highlight_color: HIGHLIGHT_COLOR,
        selection_color: SELECTION_COLOR,
      })
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'engineScene',
      dispose: () => {
        stopApplying()
        cameraDriver.dispose()
      },
      providesServices: [provideService(cameraDriverService, cameraDriver)],
      provides: [
        ...sceneSettings.map((setting) => provide(settingsValueSpec, setting)),

        /**
         * Chosen when the socket opens, so they travel in the URL.
         *
         * The engine builds its render pipeline for the session; neither of
         * these can be changed by a command afterwards, which is why both
         * settings say they wait for the next connection.
         */
        provide(streamParamsValueSpec, () => ({
          // Omitted rather than set to a falsy value when off, matching what the
          // engine is known to accept.
          ...(settings().read(enableSsaoSetting)
            ? { post_effect: 'ssao' }
            : {}),
          show_grid: settings().read(showScaleGridSetting) ? 'true' : 'false',
        })),
      ],
    }),
  }
}, 'engineScene')
