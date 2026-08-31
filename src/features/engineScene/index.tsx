import {
  createPlugin,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { engineConnectionService } from '@src/contracts/engine'
import { motionService } from '@src/contracts/motion'
import { streamParamsValueSpec } from '@src/contracts/engineScene'
import { commandsValueSpec } from '@src/contracts/commands'
import { defaultPlaneDriverService } from '@src/contracts/defaultPlanes'
import { kclSceneService } from '@src/contracts/kclScene'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
import { cameraDriverService, sceneItemsValueSpec } from '@src/contracts/scene'
import { sceneHudService } from '@src/contracts/sceneHud'
import { createSceneHudService } from '@src/features/engineScene/createSceneHudService'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { scenePickerService } from '@src/contracts/selection'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { themeService } from '@src/contracts/theme'
import { createEngineCameraDriver } from '@src/features/engineScene/createEngineCameraDriver'
import { createEngineCamera } from '@src/features/engineScene/createEngineCamera'
import { createEnginePlaneDriver } from '@src/features/engineScene/createEnginePlaneDriver'
import { createEngineProjection } from '@src/features/engineScene/createEngineProjection'
import { ViewGizmo } from '@src/features/engineScene/ViewGizmo'
import { createEngineScenePicker } from '@src/features/engineScene/createEngineScenePicker'
import {
  backgroundColorFor,
  HIGHLIGHT_COLOR,
  parseHexColor,
  SELECTION_COLOR,
  systemColorFor,
} from '@src/features/engineScene/engineColors'
import { SceneHud } from '@src/features/engineScene/SceneHud'
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
  /**
   * Where the engine's camera is, listened to once and shared.
   *
   * Two consumers with nothing else in common: the projection places things on
   * screen, and the driver needs somewhere to animate a view change *from*. Two
   * listeners would be two subscriptions to the same messages and two ideas of
   * the current camera.
   */
  const camera = createEngineCamera(engine)

  const cameraDriver = createEngineCameraDriver(engine, {
    camera,
    reducedMotion: () =>
      ctx.services.optional(motionService)?.reduced.value ?? false,
  })

  /**
   * What is under a point, for whoever is selecting.
   *
   * Beside the camera driver and for the same reason: *that* a click selects is
   * true of any renderer, and asking a websocket what a ray hit is not.
   */
  const picker = createEngineScenePicker(engine)

  /*
   * Pure signal state, so it can be built here: nothing about the outline's
   * fold state needs another service, which is what keeps it out of the lazy
   * dance the rest of this factory has to do.
   */
  const hud = createSceneHudService()

  /**
   * Where things are on screen, for whoever draws over the scene.
   *
   * The third of the same family. Its answer is peculiar to a *remote* renderer:
   * it follows the camera by listening to what the engine reports rather than by
   * reading a camera it owns, which is exactly the difference a local renderer
   * would erase.
   */
  const projection = createEngineProjection(engine, camera)

  /**
   * The default planes, as this engine has them.
   *
   * The fourth of the family, and the one that carries the most opinion: six
   * objects minted by every kcl run, paired front to back, addressed by uuid and
   * forgotten on reconnect. The feature that decides *when* a plane should show
   * knows none of that, which is what lets the arrangement be reworked.
   *
   * It reads the executor because on this engine that is where planes come from
   * — kcl-lib makes them as a side effect of running a file. Optional, because
   * an app with a scene and no executor is a legitimate thing to boot.
   */
  const planeDriver = createEnginePlaneDriver({
    ids: computed(
      () => ctx.services.optional(kclSceneService)?.defaultPlanes.value ?? null
    ),
    sceneEpoch: computed(() => engine().sceneEpoch.value),
    /*
     * Fired rather than sent: the answer is a confirmation nobody reads, and
     * awaiting six of them per run would put the planes behind a round trip they
     * do not need.
     */
    setHidden: (id, hidden) => {
      engine().fireCommand({ type: 'object_visible', object_id: id, hidden })
    },
  })

  let stopApplying = () => {}
  queueMicrotask(() => {
    planeDriver.start()
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

  /**
   * The camera driver, in a slot so another renderer can take it over.
   *
   * `cameraDriverService` is a singleton, and two items providing it makes
   * `services.get` throw for every consumer — through `optional()` too. So
   * exactly one renderer may hold it, and an arbiter decides which; see
   * `features/bevyScene`.
   *
   * Only the camera moves. The rest below stay contributed whichever renderer is
   * drawing: the engine still executes KCL, so the scene it holds is still real.
   * Picking and projection do assume the engine is what you are looking at, which
   * is why selection and sketching are unavailable under a local renderer.
   */
  const cameraPlugin = createPlugin({
    id: 'engineScene.camera',
    title: 'Zoo engine camera',
    description: 'Moves the streamed engine camera.',
    enabledByDefault: true,
    items: [
      defineRuntimeRegistryItem({
        id: 'engineScene.camera.driver',
        providesServices: [provideService(cameraDriverService, cameraDriver)],
      }),
    ],
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'engineScene',
      dispose: () => {
        stopApplying()
        planeDriver.dispose()
        cameraDriver.dispose()
        camera.dispose()
      },
      uses: [cameraPlugin],
      providesServices: [
        provideService(defaultPlaneDriverService, planeDriver),
        provideService(sceneHudService, hud),
        provideService(scenePickerService, picker),
        provideService(sceneProjectionService, projection),
      ],
      provides: [
        ...sceneSettings.map((setting) => provide(settingsValueSpec, setting)),

        /**
         * One start-side HUD, with its contents contributed through their own
         * value spec. The scene owns the placement; feature and body trees only
         * know that they are outline sections ordered inside it.
         */
        /**
         * Which way round the model is, in the corner it is always in.
         *
         * Reads the projection and runs the named-view commands, so it holds no
         * behaviour of its own: clicking a handle is the same act as pressing
         * `v r`, and both go through the one command.
         */
        provide(sceneItemsValueSpec, {
          id: 'scene.viewGizmo',
          zone: 'end',
          order: 0,
          render: () => <ViewGizmo camera={camera} />,
        }),

        provide(sceneItemsValueSpec, {
          id: 'scene.outlineHud',
          zone: 'start',
          order: -100,
          render: () => <SceneHud />,
        }),

        /*
         * Folding the outline away, from the keyboard.
         *
         * `Mod+5` continues the series the rails already use — 1 code, 2 info,
         * 3 Zookeeper, 4 history — because from the keyboard's point of view
         * this is the same act on the same kind of thing, whatever the outline's
         * implementation happens to be.
         *
         * Sections get their own commands from whoever contributes them; see
         * `SceneHudService`. Nothing here enumerates them.
         */
        provide(commandsValueSpec, {
          id: 'scene.outline.toggle',
          title: 'Toggle scene outline',
          category: 'View',
          icon: 'sidebarLeft',
          shortcut: '⌘5',
          active: computed(() => !hud.collapsed.value),
          run: () => hud.toggleCollapsed(),
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+5'],
          commandId: 'scene.outline.toggle',
        }),

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
