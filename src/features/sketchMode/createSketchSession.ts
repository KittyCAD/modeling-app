import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { KclFrontendService } from '@src/contracts/kclFrontend'
import type {
  OpenSketch,
  SketchSessionService,
} from '@src/contracts/sketchSession'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'
import { textDiff } from '@src/lib/buffers/textDiff'
import { sketchIdAt } from '@src/lib/sketch/sceneGraph'

export interface SketchSessionDependencies {
  frontend: () => KclFrontendService | undefined
  /** Where the user is: the sketch block the cursor or selection is inside. */
  sketch: ReadonlySignal<SketchBlockRange | null>
  /** The buffer being executed, which is the one a sketch is written into. */
  buffer: () => FileBackedTextBuffer | null
  /** Its project-relative path, for mirroring it into the frontend. */
  path: () => string | null
  /** The parsed program of the last run, needed for the object ids. */
  program: () => unknown | null
}

/**
 * Editing one sketch, from opening it to writing it back.
 *
 * Three round trips, in a fixed order, and each one earns its place:
 *
 * 1. **Mirror** the buffer into the frontend, which keeps its own copy.
 * 2. **Set the program**, which builds a scene and is the only step that reaches
 *    the engine. It is the price of the object ids a sketch is solved against,
 *    and paying it here rather than on every run is why editing stays cheap.
 * 3. **Open** the sketch, after which mutations are solved without an engine.
 *
 * Leaving reverses it: the frontend answers with the whole file, that lands in
 * the buffer as one minimal edit, and the buffer's own execution path renders
 * the result. That run is the point — until it happens the engine has never seen
 * what was drawn.
 */
export function createSketchSession(
  dependencies: SketchSessionDependencies
): SketchSessionService {
  const { frontend, sketch, buffer, path, program } = dependencies

  const open = signal<OpenSketch | null>(null)
  const busy = signal(false)
  const error = signal<string | null>(null)

  const canEnter = computed(
    () =>
      open.value === null &&
      !busy.value &&
      sketch.value !== null &&
      program() !== null &&
      buffer() !== null
  )

  const fail = (message: string) => {
    error.value = message
    busy.value = false
  }

  return {
    open: computed(() => open.value),
    busy: computed(() => busy.value),
    error: computed(() => error.value),
    canEnter: canEnter as ReadonlySignal<boolean>,

    async enter() {
      if (open.peek() || busy.peek()) return

      const where = sketch.peek()
      const target = buffer()
      const file = path()
      const ast = program()
      const api = frontend()

      if (!where || !target || !file || !ast || !api) {
        fail('Put the cursor in a sketch, and run the file first.')
        return
      }

      busy.value = true
      error.value = null

      try {
        await api.sync(file, target.text.peek())

        const graph = await api.setProgram(ast)
        if (!graph) {
          fail('That file has to run before its sketches can be edited.')
          return
        }

        /*
         * The crossing between the two ways this app names a sketch: we know
         * where it is written, the frontend knows an object id.
         */
        const sketchId = sketchIdAt(graph, where.from)
        if (sketchId === null) {
          fail('The last run does not have a sketch there.')
          return
        }

        await api.editSketch(sketchId)
        open.value = { sketchId, name: where.name }
        busy.value = false
      } catch (caught) {
        fail(
          caught instanceof Error
            ? caught.message
            : 'That sketch could not be opened.'
        )
      }
    },

    async exit() {
      const current = open.peek()
      const target = buffer()
      const api = frontend()

      if (!current || busy.peek()) return

      busy.value = true

      try {
        const outcome = api ? await api.exitSketch(current.sketchId) : null

        /*
         * The session closes whatever the write does.
         *
         * Being unable to write the text back is bad; being stuck in a session
         * that cannot be left is worse, and the text is still recoverable from
         * the frontend. So the state goes first and the failure is reported.
         */
        open.value = null
        busy.value = false

        if (!outcome || !target) return

        const before = target.text.peek()
        const changes = textDiff(before, outcome.text)
        if (changes.length === 0) return

        /*
         * One transaction: one undo entry for the whole sketch, and one run.
         * The buffer's ordinary execution path does the rest — leaving a sketch
         * is exactly when the engine should be told what was drawn.
         */
        target.dispatch({
          changes: changes.map((change) => ({
            from: change.from,
            to: change.to,
            insert: change.insert,
          })),
        })
      } catch (caught) {
        open.value = null
        fail(
          caught instanceof Error
            ? caught.message
            : 'That sketch could not be written back.'
        )
      }
    },
  }
}
