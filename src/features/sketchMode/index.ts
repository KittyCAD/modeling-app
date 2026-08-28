import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { kclSceneService } from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import {
  sceneModeGatesValueSpec,
  sceneModeService,
} from '@src/contracts/sceneModes'
import { selectionService } from '@src/contracts/selection'
import { SKETCHING_MODE } from '@src/features/sceneToolbar/modes'
import {
  autoEnterSketchMode,
  isTypingOutsideTheEditor,
} from '@src/features/sketchMode/autoEnterSketchMode'
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

  return {
    model: { sketch },
    item: defineRuntimeRegistryItem({
      id: 'sketchMode',
      dispose: () => {
        disposed = true
        stopFollowing?.()
      },
      provides: [
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
