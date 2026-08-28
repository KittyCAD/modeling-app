import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { engineConnectionService } from '@src/contracts/engine'
import { streamParamsValueSpec } from '@src/contracts/engineScene'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { themeService } from '@src/contracts/theme'
import {
  HIGHLIGHT_COLOR,
  SELECTION_COLOR,
  backgroundColorFor,
  parseHexColor,
  systemColorFor,
} from '@src/features/engineScene/engineColors'
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
 * Camera behaviour is a sub-feature rather than more code in this file: it owns
 * three settings and all of the pointer handling, and none of that needs to be
 * near the background colour.
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
      dispose: () => stopApplying(),
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
