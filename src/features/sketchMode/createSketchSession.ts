import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type {
  KclFrontendService,
  SketchOutcome,
} from '@src/contracts/kclFrontend'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type {
  OpenSketch,
  SketchSessionService,
} from '@src/contracts/sketchSession'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'
import { suppressExecution } from '@src/lib/buffers/annotations'
import { textDiff } from '@src/lib/buffers/textDiff'
import type { PlaneFrame, PlanePoint } from '@src/lib/scene/projection'
import { sketchIdAt } from '@src/lib/sketch/sceneGraph'
import { sketchPlaneSource } from '@src/lib/sketch/sketchPlane'
import {
  type SketchToolId,
  type SketchToolState,
  cancelTool,
  equipTool,
  placePoint,
} from '@src/lib/sketch/tools'

export interface SketchSessionDependencies {
  frontend: () => KclFrontendService | undefined
  /** Where the user is: the sketch block the cursor or selection is inside. */
  sketch: ReadonlySignal<SketchBlockRange | null>
  /** The buffer being executed, which is the one a sketch is written into. */
  buffer: () => FileBackedTextBuffer | null
  /** Its project-relative path, for mirroring it into the frontend. */
  path: () => string | null
  /** The parsed program of the last run, needed for the object ids. */
  program: () => unknown
  /** The last run's artifacts, which usually already know where the plane is. */
  artifacts: () => ArtifactMap
  /** Whoever is rendering, for the one plane it alone can place. */
  projection: () => SceneProjection | undefined
}

/**
 * Editing one sketch, from opening it to writing it back.
 *
 * Three round trips to open, in a fixed order, and each one earns its place:
 *
 * 1. **Mirror** the buffer into the frontend, which keeps its own copy.
 * 2. **Set the program**, which builds a scene and is the only step that reaches
 *    the engine. It is the price of the object ids a sketch is solved against,
 *    and paying it here rather than on every run is why editing stays cheap.
 * 3. **Open** the sketch, after which mutations are solved without an engine.
 *
 * Then a fourth thing that costs nothing in the usual case: finding out where
 * the sketch's plane is, so it can be drawn over the scene.
 *
 * Every segment drawn goes into the file straight away, marked not to execute.
 * That is the arrangement the whole feature is for: the KCL is the model, it
 * updates as you draw, and nothing is rebuilt until you are done. Leaving is
 * what runs it, and until then the video is deliberately showing the last model
 * that was built.
 */
export function createSketchSession(
  dependencies: SketchSessionDependencies
): SketchSessionService {
  const { frontend, sketch, buffer, path, program, artifacts, projection } =
    dependencies

  const open = signal<OpenSketch | null>(null)
  const busy = signal(false)
  const error = signal<string | null>(null)
  const tool = signal<SketchToolState | null>(null)

  /**
   * Mutations run one at a time, in the order they were asked for.
   *
   * Clicks arrive faster than a solve comes back, and the frontend holds one
   * copy of the file: two overlapping `add_segment` calls would each answer with
   * text that does not contain the other's segment, and whichever landed second
   * would erase the first. Dropping the second click instead would lose a
   * segment somebody drew, which is worse than a moment's wait.
   */
  let queue: Promise<unknown> = Promise.resolve()

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

  /**
   * Where the open sketch is, in the world.
   *
   * Free when the artifact graph already evaluated the plane, which it does for
   * every sketch on a plane. A sketch on the face of a solid costs a round trip,
   * because where that face ended up is something only the geometry kernel
   * worked out.
   */
  const planeFor = async (
    sketchId: number
  ): Promise<{ plane: PlaneFrame | null; problem: string | null }> => {
    const source = sketchPlaneSource(artifacts(), sketchId)

    if (source.kind === 'frame') return { plane: source.frame, problem: null }
    if (source.kind === 'unavailable') {
      return { plane: null, problem: source.reason }
    }

    const renderer = projection()
    const frame = renderer ? await renderer.frameOf(source.entityId) : null

    return frame
      ? { plane: frame, problem: null }
      : {
          plane: null,
          problem: 'The scene could not say where that face is.',
        }
  }

  /**
   * Put what the frontend answered with into the buffer.
   *
   * As one minimal edit, recovered from the whole file it hands back, so the
   * cursor stays where it was and the action is one thing to undo. Marked not to
   * execute unless this is the last write of the session: a segment drawn is a
   * change to the file that deliberately does not rebuild the model.
   */
  const write = (outcome: SketchOutcome, options: { execute: boolean }) => {
    const target = buffer()
    if (!target || !outcome.text) return

    const before = target.text.peek()
    const changes = textDiff(before, outcome.text)
    if (changes.length === 0) return

    target.dispatch({
      changes: changes.map((change) => ({
        from: change.from,
        to: change.to,
        insert: change.insert,
      })),
      annotations: options.execute ? [] : [suppressExecution.of(true)],
    })
  }

  return {
    open: computed(() => open.value),
    busy: computed(() => busy.value),
    error: computed(() => error.value),
    canEnter,
    tool: computed(() => tool.value),

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
        const placed = await planeFor(sketchId)

        open.value = {
          sketchId,
          name: where.name,
          plane: placed.plane,
          planeProblem: placed.problem,
        }
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
      const api = frontend()

      if (!current || busy.peek()) return

      busy.value = true
      // Anything half-drawn is abandoned rather than completed: leaving is not
      // a way of finishing the line you were in the middle of.
      tool.value = null

      // Behind whatever is still in flight, so the file the frontend writes back
      // is the one with every segment in it.
      await queue.catch(() => {})

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

        /*
         * The one write of the session that runs. Leaving a sketch is exactly
         * when the engine should be told what was drawn — until this happens it
         * has never seen any of it.
         */
        if (outcome) write(outcome, { execute: true })
      } catch (caught) {
        open.value = null
        fail(
          caught instanceof Error
            ? caught.message
            : 'That sketch could not be written back.'
        )
      }
    },

    equip(next: SketchToolId | null) {
      if (!open.peek()) return
      tool.value = next === null ? null : equipTool(next)
    },

    cancelTool() {
      const current = tool.peek()
      tool.value = current ? cancelTool(current) : null
    },

    place(at: PlanePoint) {
      const current = tool.peek()
      const session = open.peek()
      const api = frontend()
      if (!current || !session || !api) return

      const step = placePoint(current, at)
      tool.value = step.state
      if (step.actions.length === 0) return

      error.value = null

      queue = queue
        .catch(() => {})
        .then(async () => {
          // Read again: the session can have been left while this waited its
          // turn, and drawing into a closed sketch would reopen it by accident.
          if (open.peek()?.sketchId !== session.sketchId) return

          for (const action of step.actions) {
            const outcome = await api.addSegment(
              session.sketchId,
              action.segment
            )
            write(outcome, { execute: false })
          }
        })
        .catch((caught: unknown) => {
          error.value =
            caught instanceof Error
              ? caught.message
              : 'That could not be drawn.'
        })
    },
  }
}
