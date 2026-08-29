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
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { selectionService } from '@src/contracts/selection'
import { SKETCHING_MODE } from '@src/features/sceneToolbar/modes'
import {
  autoEnterSketchMode,
  isTypingOutsideTheEditor,
} from '@src/features/sketchMode/autoEnterSketchMode'
import { createSketchSession } from '@src/features/sketchMode/createSketchSession'
import { sketchContextAt } from '@src/features/sketchMode/sketchContext'

/**
 * Sketching as a place, not a state.
 *
 * The existing app enters sketch mode by sending an event to a machine and then
 * has to keep that machine's idea of where you are in step with the file, the
 * camera, and the selection — which is where most of "the sketch mode is stuck"
 * comes from. Here it is derived: your selection is inside a `sketch { … }` block
 * or it is not, and the mode follows.
 *
 * That inversion is what this feature is. It owns no tools yet — sketch V2 edits
 * inside a block and the operation layer only appends — but it owns the answer to
 * "am I in a sketch", which is what the mode, its keys and a future Start Sketch
 * all need.
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
   * Deferred by a microtask: the effect's first run resolves services, and doing
   * that while the registry graph is still being flattened is not allowed.
   */
  let stopFollowing: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return

    const modes = ctx.services.optional(sceneModeService)
    if (!modes) return

    stopFollowing = autoEnterSketchMode({
      sketch,
      sketching: computed(() => modes.active.value?.id === SKETCHING_MODE),
      isTyping: isTypingOutsideTheEditor,
      enter: () => modes.enter(SKETCHING_MODE),
    })
  })

  /**
   * Editing one sketch, as opposed to being in the mode that shows its tools.
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
  })

  return {
    model: { sketch, session },
    item: defineRuntimeRegistryItem({
      id: 'sketchMode',
      providesServices: [provideService(sketchSessionService, session)],
      dispose: () => {
        disposed = true
        stopFollowing?.()
      },
      provides: [
        /**
         * Opening and leaving are both deliberate acts, so both are commands.
         *
         * Opening costs a real execution — it is what produces the object ids a
         * sketch is solved against — and leaving costs another, to get what was
         * drawn rendered. Neither should happen because a selection moved.
         */
        provide(commandsValueSpec, {
          id: 'sketch.enter',
          title: 'Edit sketch',
          category: 'Sketch',
          icon: 'sketch',
          description:
            'Open the sketch the cursor is in, and draw in it without rebuilding the model.',
          enabled: session.canEnter,
          run: () => void session.enter(),
        }),

        provide(commandsValueSpec, {
          id: 'sketch.exit',
          title: 'Finish sketch',
          category: 'Sketch',
          icon: 'checkmark',
          description:
            'Write the sketch back to the file and rebuild the model from it.',
          enabled: computed(() => session.open.value !== null),
          run: () => void session.exit(),
        }),

        /**
         * Opening has a button, because otherwise it has nothing.
         *
         * Start sketch writes the block and puts the cursor in it, which is
         * enough to reach Sketch mode — and Sketch mode then showed a strip of
         * tools that were all disabled, because a tool needs a *session* and
         * only a command nobody can see would open one. A mode whose every
         * button is greyed out and whose remedy is in the palette is not a
         * discoverable app.
         *
         * Its own run, ahead of the tools: open, then draw, then finish is the
         * order the buttons are used in.
         */
        provide(toolbarItemsValueSpec, {
          kind: 'command',
          id: 'sketch.begin',
          mode: SKETCHING_MODE,
          section: 'open',
          order: 0,
          commandId: 'sketch.enter',
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
          available: computed(() => sketch.value !== null),
          reason: 'Select something inside a sketch to edit it.',
        }),
      ],
    }),
  }
}, 'sketchMode')
