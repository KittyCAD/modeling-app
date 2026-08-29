import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { commandsValueSpec } from '@src/contracts/commands'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { kclSceneService } from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import {
  sceneModeGatesValueSpec,
  sceneModeService,
  toolbarItemsValueSpec,
} from '@src/contracts/sceneModes'
import { cameraDriverService } from '@src/contracts/scene'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import {
  settingsSectionsValueSpec,
  settingsService,
  settingsValueSpec,
} from '@src/contracts/settings'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { selectionService } from '@src/contracts/selection'
import { SKETCHING_MODE } from '@src/features/sceneToolbar/modes'
import { bindSketchModeToSession } from '@src/features/sketchMode/bindSketchModeToSession'
import { createSketchSession } from '@src/features/sketchMode/createSketchSession'
import {
  faceOnWhenEnteringSketchSetting,
  sketchingSettings,
} from '@src/features/sketchMode/settings'
import { sketchContextAt } from '@src/features/sketchMode/sketchContext'

/**
 * Sketching as a place, not a state.
 *
 * The existing app enters sketch mode by sending an event to a machine and then
 * has to keep that machine's idea of where you are in step with the file, the
 * camera, and the selection — which is where most of "the sketch mode is stuck"
 * comes from. Here the file is the authority: your cursor is inside a
 * `sketch { … }` block or it is not, and the program says which.
 *
 * What that fact decides is *availability*, not the mode. Sketch mode is an open
 * sketch — entering it opens one and leaving it writes one back — because a mode
 * that could be entered without a session showed a strip of tools that none of
 * them worked. Being in a sketch is what makes the mode reachable; entering is
 * still something the user says.
 */
export default defineRegistryItemFactory((ctx) => {
  /** The open project, which owns the buffers a sketch is written into. */
  const currentSession = () =>
    ctx.services.optional(projectSessionService)?.current.value ?? null

  /**
   * Where the user is, in the program the last run read.
   *
   * Everything is resolved optionally. A build with no engine, no selection or
   * nothing executed yet simply is not in a sketch — which is the correct answer
   * rather than a missing one.
   */
  const sketch = computed(() => {
    const scene = ctx.services.optional(kclSceneService)
    if (!scene) return null

    const selection = ctx.services.optional(selectionService)
    const ranges: SourceRange[] = (selection?.entities.value ?? [])
      .map((entity) => entity.sourceRange)
      .filter((range): range is SourceRange => range !== null)

    /*
     * The cursor's facts, gathered here and judged there: which of them
     * disqualify a cursor is a rule worth testing, so it lives in
     * `sketchContextAt`.
     */
    const session = ctx.services.optional(projectSessionService)?.current.value
    const executing = session?.executingBuffer.value ?? null
    const active = session?.activeBuffer.value ?? null

    const cursor = active
      ? {
          offset: active.state.value.selection.main.head,
          executing: active.id === executing?.id,
        }
      : null

    return sketchContextAt(scene.program.value, ranges, cursor)
  })

  /**
   * Editing one sketch, which is what being in Sketch mode means.
   *
   * Built here because this is where "which sketch is the user in" already
   * lives, and the session needs exactly that answer to know what to open.
   */
  const session = createSketchSession({
    frontend: () => ctx.services.optional(kclFrontendService),
    sketch,
    buffer: () => currentSession()?.executingBuffer.value ?? null,
    path: () => {
      const open = currentSession()
      const buffer = open?.executingBuffer.value
      return open && buffer ? open.relativePathFor(buffer) : null
    },
    program: () =>
      ctx.services.optional(kclSceneService)?.program.value?.ast ?? null,
    artifacts: () =>
      ctx.services.optional(kclSceneService)?.artifacts.value ?? new Map(),
    projection: () => ctx.services.optional(sceneProjectionService),
    camera: () => ctx.services.optional(cameraDriverService),
    faceOnEntry: () =>
      ctx.services
        .optional(settingsService)
        ?.read(faceOnWhenEnteringSketchSetting) ?? true,
  })

  /**
   * Deferred by a microtask: the effect's first run resolves services, and doing
   * that while the registry graph is still being flattened is not allowed.
   */
  let stopBinding: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return

    const modes = ctx.services.optional(sceneModeService)
    if (!modes) return

    stopBinding = bindSketchModeToSession({
      sketching: computed(() => modes.active.value?.id === SKETCHING_MODE),
      open: computed(() => session.open.value !== null),
      enter: () => session.enter(),
      exit: () => session.exit(),
      leaveMode: () => modes.reset(),
    })
  })

  return {
    model: { sketch, session },
    item: defineRuntimeRegistryItem({
      id: 'sketchMode',
      providesServices: [provideService(sketchSessionService, session)],
      dispose: () => {
        disposed = true
        stopBinding?.()
      },
      provides: [
        ...sketchingSettings.map((setting) =>
          provide(settingsValueSpec, setting)
        ),

        provide(settingsSectionsValueSpec, {
          id: 'sketching',
          title: 'Sketching',
          description: 'How drawing in a sketch behaves.',
          icon: 'sketch',
          order: 6,
        }),

        /**
         * Look straight at the plane, on demand.
         *
         * A command as well as an automatic behaviour, because the automatic one
         * only fires when the sketch opens and the camera is free to move
         * afterwards — orbiting inside a sketch is allowed, so getting back to
         * face-on has to be something you can ask for.
         *
         * It takes the plane from the sketch that is open rather than an
         * argument. Every command in this app is argument-free and reads its
         * target from where the user is; the plane is the capability's argument,
         * not the command's.
         */
        provide(commandsValueSpec, {
          id: 'sketch.faceOn',
          title: 'Look at the sketch plane',
          category: 'Sketch',
          icon: 'plane',
          description:
            'Turn the camera to look straight down the sketch plane’s normal.',
          enabled: computed(() => session.open.value?.plane != null),
          run: () => {
            const plane = session.open.value?.plane
            if (plane) ctx.services.optional(cameraDriverService)?.faceOn(plane)
          },
        }),

        provide(toolbarItemsValueSpec, {
          kind: 'command',
          id: 'sketch.faceOn',
          mode: SKETCHING_MODE,
          section: 'view',
          order: 50,
          commandId: 'sketch.faceOn',
        }),

        /**
         * Opening and leaving are both deliberate acts, so both are commands.
         *
         * Opening costs a real execution — it is what produces the object ids a
         * sketch is solved against — and leaving costs another, to get what was
         * drawn rendered. Neither should happen because a selection moved.
         *
         * Both move the *mode* and let the binding open and close the sketch.
         * There is deliberately no path that does one without the other: two
         * ways in would be two things to keep in step, which is the arrangement
         * this replaced.
         */
        provide(commandsValueSpec, {
          id: 'sketch.enter',
          title: 'Edit sketch',
          category: 'Sketch',
          icon: 'sketch',
          description:
            'Open the sketch the cursor is in, and draw in it without rebuilding the model.',
          enabled: session.canEnter,
          run: () =>
            ctx.services.optional(sceneModeService)?.enter(SKETCHING_MODE),
        }),

        provide(commandsValueSpec, {
          id: 'sketch.exit',
          title: 'Finish sketch',
          category: 'Sketch',
          icon: 'checkmark',
          description:
            'Write the sketch back to the file and rebuild the model from it.',
          enabled: computed(() => session.open.value !== null),
          run: () => ctx.services.optional(sceneModeService)?.reset(),
        }),

        provide(toolbarItemsValueSpec, {
          kind: 'command',
          id: 'sketch.finish',
          mode: SKETCHING_MODE,
          section: 'session',
          order: 100,
          commandId: 'sketch.exit',
        }),

        /**
         * Sketching is reachable only from inside a sketch.
         *
         * Contributed as a gate rather than declared on the mode, because the
         * mode is a fact about the scene and this is a fact about the KCL file.
         * The toolbar feature ships the mode and never learns what a sketch is.
         */
        provide(sceneModeGatesValueSpec, {
          id: 'sketchMode.inSketch',
          mode: SKETCHING_MODE,
          /*
           * Or already editing one. A session suppresses execution while it is
           * open, so the last run's program goes stale under it — and the
           * condition that let you in must not become the condition that says
           * you were never allowed.
           */
          available: computed(
            () => sketch.value !== null || session.open.value !== null
          ),
          reason: 'Put the cursor inside a sketch to edit it.',
        }),
      ],
    }),
  }
}, 'sketchMode')
