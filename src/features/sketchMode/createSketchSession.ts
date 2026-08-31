import { type ReadonlySignal, computed, effect, signal } from '@preact/signals'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type {
  KclFrontendService,
  SketchOutcome,
} from '@src/contracts/kclFrontend'
import type { CameraDriver } from '@src/contracts/scene'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type {
  OpenSketch,
  SketchSelectionId,
  SketchSessionService,
} from '@src/contracts/sketchSession'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'
import {
  bufferOrigin,
  requestExecution,
  suppressExecution,
} from '@src/lib/buffers/annotations'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import { kclErrorMessage } from '@src/lib/kcl/errors'
import { suffixForUnitName } from '@src/lib/kcl/units'
import { defaultLengthUnitOf } from '@src/lib/kclStdlib/program'
import { textDiff } from '@src/lib/buffers/textDiff'
import type { PlaneFrame, PlanePoint } from '@src/lib/scene/projection'
import type {
  ApiObjectId,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { objectAt, sketchIdAt, sketchRanges } from '@src/lib/sketch/sceneGraph'
import { sketchIdIn, sketchPlaneSource } from '@src/lib/sketch/sketchPlane'
import { constraintToolInfo, constraintsFor } from '@src/lib/sketch/constraints'
import { dimensionFor } from '@src/lib/sketch/dimensions'
import { planDrag } from '@src/lib/sketch/drag'
import { buildRectangle } from '@src/lib/sketch/rectangle'
import {
  type DraftAction,
  type DraftState,
  type HoldAfter,
  held,
  abandon,
  advanceDrag,
  beginDrag as beginDragState,
  endDrag as endDragState,
  moveTo as moveDraft,
  place as placeDraft,
  pointAt,
} from '@src/lib/sketch/draft'
import type { SketchToolId } from '@src/lib/sketch/tools'

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
  /** For turning to face the plane on the way in, if that is wanted. */
  camera: () => CameraDriver | undefined
  /** Whether opening a sketch should look straight at its plane. */
  faceOnEntry: () => boolean
  /**
   * The unit to write numbers in when the file declares none.
   *
   * The same value the executor is given, so a segment written here means what
   * the geometry around it means.
   */
  defaultUnit: () => NumericSuffix
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
): SketchSessionService & { dispose: () => void } {
  const {
    frontend,
    sketch,
    buffer,
    path,
    program,
    artifacts,
    projection,
    camera,
    faceOnEntry,
    defaultUnit,
  } = dependencies

  const open = signal<OpenSketch | null>(null)
  const busy = signal(false)
  const error = signal<string | null>(null)
  const tool = signal<SketchToolId | null>(null)
  const draft = signal<DraftState>({ kind: 'idle' })
  const selection = signal<readonly SketchSelectionId[]>([])

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

  /**
   * An id the frontend agrees is a sketch, or null.
   *
   * Both routes to an id are inferences about a graph built by a *different*
   * execution from the one that produced them, so neither is worth trusting
   * unchecked: an id that is out of range, or names something that is not a
   * sketch, would be reported by kcl-lib as "sketch not found" one call later
   * and with less to go on.
   */
  const verified = (
    graph: SceneGraph,
    sketchId: ApiObjectId | null
  ): ApiObjectId | null => {
    if (sketchId === null) return null
    return objectAt(graph, sketchId)?.kind.type === 'Sketch' ? sketchId : null
  }

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
   * Notice that every id the app is holding has just become meaningless.
   *
   * kcl-lib sets this when a solve renumbers the graph, and an id that survives
   * a renumbering names whatever now occupies that slot — so a selection kept
   * across one would silently point at the wrong geometry, and the next
   * constraint would be applied to it.
   *
   * The draft states are deliberately left alone: they are only ever alive for
   * the duration of one tool action, and the mutations that renumber are not the
   * ones a tool makes mid-draft.
   */
  const noteIds = (outcome: Pick<SketchOutcome, 'invalidatesIds'>) => {
    if (outcome.invalidatesIds) selection.value = []
  }

  /**
   * Put what the frontend answered with into the buffer.
   *
   * As one minimal edit, recovered from the whole file it hands back, so the
   * cursor stays where it was and the action is one thing to undo. Always marked
   * not to execute: a segment drawn is a real change to the file that
   * deliberately does not rebuild the model. The rebuild happens once, on the
   * way out.
   */
  const write = (outcome: Pick<SketchOutcome, 'text'>) => {
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
      annotations: [suppressExecution.of(true)],
    })
  }

  /**
   * Ask for the run that makes what was drawn real.
   *
   * Leaving a sketch returns a scene and no text — every segment went into the
   * file as it was drawn — so there is no edit here to trigger an execution the
   * way an ordinary change would. It has to be said out loud, which is what
   * `requestExecution` is for, and it is the only execution a whole sketching
   * session costs.
   */
  const requestRun = () => {
    buffer()?.dispatch({
      annotations: [bufferOrigin.of('semantic'), requestExecution.of(true)],
    })
  }

  /**
   * The unit to write numbers in.
   *
   * The file's own, from its `@settings` annotation, so a sketch drawn in a file
   * that works in inches is written in inches. When the file declares nothing it
   * is the project's — or the user's — default, because that is what the file's
   * unsuffixed numbers already mean: the same value is threaded into the executor
   * as `base_unit`, so writing anything else here would make the sketch disagree
   * with the geometry it was drawn on.
   */
  const units = (): NumericSuffix => {
    const ast = program()
    const declared = ast
      ? suffixForUnitName(defaultLengthUnitOf(ast as Program))
      : null

    return declared ?? defaultUnit()
  }

  /** Actions run one at a time, in order, for the reason `queue` exists. */
  const run = (actions: readonly DraftAction[]) => {
    if (actions.length === 0) return
    error.value = null

    queue = queue
      .catch(() => {})
      .then(async () => {
        for (const action of actions) await perform(action)
      })
      .catch((caught: unknown) => {
        error.value = kclErrorMessage(caught, 'That could not be drawn.')
      })
  }

  /** One draft action, against the frontend. */
  const perform = async (action: DraftAction) => {
    const api = frontend()
    const session = open.peek()
    if (!api || !session) return

    switch (action.kind) {
      case 'begin': {
        const outcome = await api.addSegment(session.sketchId, action.segment, {
          label: action.label,
          checkpoint: true,
        })
        noteIds(outcome)
        write(outcome)
        // Only a shape that is dragged open has something to take hold of. A
        // point or a finished circle is done, and the tool stays equipped for
        // the next one.
        settleDraft(outcome, action.hold)
        return
      }

      case 'chain': {
        const outcome = await api.chainSegment(
          session.sketchId,
          action.fromPointId,
          action.segment,
          { label: action.label, checkpoint: true }
        )
        noteIds(outcome)
        write(outcome)
        // A chain always takes hold of the new line's end: that is what makes
        // the next segment continue from it.
        settleDraft(outcome, { kind: 'end' })
        return
      }

      case 'drag': {
        /*
         * Planned here, against the graph the last solve produced.
         *
         * Not against the graph the drag started from: previews are solved and
         * drawn without being committed, so the positions to translate are
         * wherever the last preview left them. Planning from a stale graph would
         * re-apply the whole drag from the beginning on every pointer move.
         */
        const graph = api.sceneGraph.peek()
        if (!graph) return

        const plan = planDrag(graph, {
          id: action.objectId,
          from: action.from,
          to: action.to,
          units: units(),
        })
        // Nothing this object can be asked for — an owned line, or an id that no
        // longer names a segment. Silent because it is a normal outcome of
        // grabbing something that turns out not to be movable.
        if (plan.edits.length === 0) return

        const outcome = await api.editSegments(session.sketchId, plan.edits, {
          commit: action.commit,
          checkpoint: action.commit,
          anchors: plan.anchors,
          anchorSegmentIds: plan.anchorSegmentIds,
        })

        /*
         * Only an accepted solve advances the measuring point.
         *
         * A refused one leaves it where it was, so the next move asks for the
         * whole remaining distance rather than for one frame of it — otherwise
         * every refusal permanently offsets the pointer from the geometry.
         */
        noteIds(outcome)

        if (outcome.problem) {
          error.value = outcome.problem
        } else {
          draft.value = advanceDrag(draft.peek(), action.to)
        }

        if (action.commit) write(outcome)
        return
      }

      case 'move': {
        const outcome = await api.editSegments(
          session.sketchId,
          [{ id: action.pointId, ctor: pointAt(action.to, units()) }],
          { commit: action.commit, checkpoint: action.commit }
        )
        noteIds(outcome)

        /*
         * Only a commit reaches the file.
         *
         * A preview is thrown away on the next move, so writing its text would
         * churn the document once per pointer event — hundreds of undo entries
         * for one line, and the cursor jumping through all of them.
         */
        if (action.commit) write(outcome)
        return
      }

      case 'reshape': {
        const outcome = await api.editSegments(session.sketchId, action.edits, {
          commit: action.commit,
          checkpoint: action.commit,
        })
        noteIds(outcome)
        // Same as a point move: a preview is thrown away on the next one, so
        // writing its text would churn the document once per pointer event.
        if (action.commit) write(outcome)
        return
      }

      case 'rectangle': {
        /*
         * A dozen calls, in order, and only then a state.
         *
         * The constraints name the points the lines ended up with, so they
         * cannot be written until the lines have answered — which is why this is
         * one action the session runs rather than a list the tool emits.
         */
        const built = await buildRectangle(
          api,
          session.sketchId,
          action.origin,
          action.mode,
          units()
        )
        if (!built) {
          error.value = 'That rectangle could not be drawn.'
          return
        }

        noteIds(built.outcome)
        // One edit for the whole rectangle: every call answered with the whole
        // file, and the last one contains all twelve.
        write(built.outcome)

        /*
         * Abandoned while it was being written.
         *
         * A dozen round trips is long enough for somebody to press Escape or put
         * the tool down, and the discard that ran then had nothing to delete —
         * the rectangle did not exist yet. So it is taken away here instead,
         * rather than left in the sketch with a state pointing at it.
         *
         * The state is the test rather than a token captured before the build,
         * because this runs on the action queue: by the time it starts, an
         * abandon has already been and gone.
         */
        if (draft.peek().kind !== 'pending') {
          await api.deleteObjects(session.sketchId, {
            segmentIds: built.draft.segmentIds,
            constraintIds: built.draft.constraintIds,
          })
          return
        }

        draft.value = {
          kind: 'shaping',
          targets: built.draft.lineIds,
          points: [action.origin],
          segmentIds: built.draft.segmentIds,
        }
        return
      }

      case 'constrain': {
        /*
         * One at a time, checkpointing on the last.
         *
         * Several constraints can come from one press — five lines made
         * horizontal is five constraints — and they are one thing the user did,
         * so one thing to undo. Each is awaited because the frontend holds one
         * copy of the file.
         */
        let last: SketchOutcome | null = null

        for (const [index, constraint] of action.constraints.entries()) {
          last = await api.addConstraint(session.sketchId, constraint, {
            checkpoint: index === action.constraints.length - 1,
          })

          /*
           * Stop at the first refusal.
           *
           * kcl-lib reports a constraint it cannot satisfy in the outcome rather
           * than by rejecting, and carrying on would pile more constraints onto
           * a sketch that already cannot be solved.
           */
          if (last.problem) {
            error.value = last.problem
            break
          }
        }

        if (last) {
          noteIds(last)
          write(last)
        }
        return
      }

      case 'dimension': {
        const outcome = await api.editConstraintValue(
          session.sketchId,
          action.constraintId,
          action.expression,
          { checkpoint: true }
        )
        noteIds(outcome)
        if (outcome.problem) error.value = outcome.problem
        write(outcome)
        return
      }

      case 'discard': {
        const constraintIds = action.constraintIds ?? []
        if (action.segmentIds.length === 0 && constraintIds.length === 0) return

        const outcome = await api.deleteObjects(session.sketchId, {
          segmentIds: action.segmentIds,
          constraintIds,
        })
        noteIds(outcome)
        write(outcome)
        return
      }
    }
  }

  /**
   * Take hold of what a `begin` or `chain` just created.
   *
   * The point to drag is not known until the frontend answers, so the state is
   * settled here rather than by the transition — and if no line came back the
   * draft is dropped rather than pointed at something that may not exist.
   */
  const settleDraft = (outcome: SketchOutcome, hold: HoldAfter) => {
    draft.value = held(outcome.graph, outcome.newObjects, hold)
  }

  /** The most recent rubber-band request, waiting for the solver to be free. */
  let latestMove: DraftAction | null = null
  let previewing = false

  /**
   * Drain the pending move, then whatever arrived while it ran.
   *
   * One solve in flight at a time. Pacing by animation frame would still allow
   * two to overlap on a slow solve, and the frontend holds one copy of the
   * sketch — so the second to land would answer about a position the first had
   * already moved away from.
   */
  const drainMoves = async () => {
    if (previewing) return
    previewing = true

    try {
      while (latestMove) {
        const action = latestMove
        latestMove = null
        /*
         * Dropped if whatever was being moved has ended while this waited its
         * turn: editing a deleted point is an error, and an abandoned draft is a
         * normal thing.
         */
        const kind = draft.peek().kind
        if (kind !== 'drawing' && kind !== 'dragging' && kind !== 'shaping') {
          break
        }
        await perform(action)
      }
    } catch (caught) {
      error.value = kclErrorMessage(caught, 'That could not be drawn.')
    } finally {
      previewing = false
    }
  }

  /** Throw away whatever is being drawn, and stop drawing it. */
  const discardDraft = async () => {
    latestMove = null
    const step = abandon(draft.peek())
    draft.value = step.state
    run(step.actions)
  }

  /**
   * A sketch cannot outlive the file it is in.
   *
   * Closing the last KCL buffer leaves nothing to write to, and without this the
   * session stayed open over it: the toolbar still offered tools, a click still
   * asked the solver to add a segment, and the segment went into a copy of a file
   * nobody had open. Which is the worst kind of stale state — it accepts work and
   * then loses it.
   *
   * Forgotten rather than exited. `exit` writes the sketch back and asks for a
   * run, and there is no buffer to do either with; the file on disk is whatever
   * the last write left, which is the honest outcome of closing a file.
   */
  const forget = () => {
    camera()?.releaseCamera()
    latestMove = null
    draft.value = { kind: 'idle' }
    selection.value = []
    tool.value = null
    open.value = null
    busy.value = false
  }

  let stopWatchingBuffer: (() => void) | null = null
  queueMicrotask(() => {
    stopWatchingBuffer = effect(() => {
      // Reads the buffer through the same getter the rest of this uses, which
      // reads signals — so the effect follows it.
      const target = buffer()
      if (open.value !== null && target === null) forget()
    })
  })

  return {
    open: computed(() => open.value),
    busy: computed(() => busy.value),
    error: computed(() => error.value),

    dismissError() {
      error.value = null
    },
    canEnter,
    tool: computed(() => tool.value),
    draft: computed(() => draft.value),
    selection: computed(() => selection.value),

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

        const built = await api.setProgram(ast)
        if (built.kind === 'unavailable') {
          fail('KCL is still loading. Try again in a moment.')
          return
        }
        if (built.kind === 'failed') {
          /*
           * The program ran and the program was wrong. Saying so in KCL's own
           * words matters more here than anywhere: this used to say "that file
           * has to run first" to somebody who had just run it, which sends them
           * to look at the one thing that is working.
           */
          fail(`That sketch cannot be opened: ${built.reason}`)
          return
        }

        /*
         * The crossing between the two ways this app names a sketch: we know
         * where it is written, the frontend knows an object id.
         *
         * The artifact graph first, because it is the one place the link is
         * *recorded* rather than recomputed — a `sketchBlock` artifact carries
         * the frontend's own id. Matching by source range is the fallback, and
         * it is a fallback because it was wrong: our idea of a sketch's extent
         * is the whole declaration and the frontend's is the expression inside
         * it, so the offset we ask about most often — the start of the statement
         * — is the one that cannot match.
         */
        const sketchId =
          verified(built.graph, sketchIdIn(artifacts(), where)) ??
          verified(built.graph, sketchIdAt(built.graph, where.from))

        if (sketchId === null) {
          const present = sketchRanges(built.graph)
            .map((sketch) => `#${sketch.id} at ${sketch.range.join('–')}`)
            .join(', ')

          fail(
            `Could not match the sketch at ${where.from}–${where.to} to anything the last run produced${
              present ? ` (it has ${present})` : ' (it produced no sketches)'
            }. This is a bug rather than something you did.`
          )
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

        /*
         * And turn to face it.
         *
         * After the session is open rather than before, because this is the first
         * moment the plane is known — which is also why it is not something the
         * Start sketch operation could put in its plan. Both ways into a sketch
         * pass through here, so both get it, and neither had to be told.
         *
         * The camera is free to move afterwards. Orbiting inside a sketch is
         * allowed, so this is a starting position rather than a lock, and
         * `sketch.faceOn` is how somebody gets back to it.
         */
        /*
         * Take the camera for the duration.
         *
         * The overlay is drawn from wherever the camera is, so while it comes back
         * from the engine one report at a time the sketch lags the pointer — which
         * reads as the app being slow however fast the solve was. Claimed here
         * means an orbit moves the drawing immediately and the video catches up,
         * which is the trade the existing app makes on entering a sketch too.
         */
        camera()?.claimCamera()

        if (placed.plane && faceOnEntry()) camera()?.faceOn(placed.plane)
      } catch (caught) {
        fail(kclErrorMessage(caught, 'That sketch could not be opened.'))
      }
    },

    async exit() {
      const current = open.peek()
      const api = frontend()

      if (!current || busy.peek()) return

      busy.value = true
      // Anything half-drawn is abandoned rather than completed: leaving is not
      // a way of finishing the line you were in the middle of.
      void discardDraft()
      tool.value = null
      selection.value = []
      // Back to following the engine: outside a sketch there is nothing drawn
      // over the video that a round trip would hold up.
      camera()?.releaseCamera()

      // Behind whatever is still in flight, so the file the frontend writes back
      // is the one with every segment in it.
      await queue.catch(() => {})

      try {
        if (api) await api.exitSketch(current.sketchId)

        /*
         * The session closes whatever else happens.
         *
         * Failing to leave cleanly is bad; being stuck in a session that cannot
         * be left is worse, and every segment is already in the file either way.
         * So the state goes first and the failure is reported after.
         */
        open.value = null
        busy.value = false

        requestRun()
      } catch (caught) {
        open.value = null
        // Still ask for the run. The file holds the segments whether or not the
        // frontend tidied up after itself, and the model has to catch up to it.
        requestRun()
        fail(kclErrorMessage(caught, 'That sketch could not be closed.'))
      }
    },

    equip(next: SketchToolId | null) {
      if (!open.peek()) return
      if (next === tool.peek()) return

      // Putting a tool down abandons whatever it was drawing, which is the same
      // thing Escape does and for the same reason.
      void discardDraft()
      tool.value = next
    },

    finishChain() {
      void discardDraft()
    },

    beginDrag(objectId, at) {
      if (!open.peek()) return
      // A drag takes precedence over whatever a tool was part way through: you
      // cannot be rubber-banding a new line and moving an old corner at once.
      void discardDraft()
      draft.value = beginDragState(objectId, at)
    },

    endDrag(at: PlanePoint) {
      const step = endDragState(draft.peek(), at)
      draft.value = step.state
      latestMove = null
      run(step.actions)
    },

    cancelTool() {
      void discardDraft()
    },

    select(id, options = {}) {
      if (!open.peek()) return

      const current = selection.peek()

      if (!options.add) {
        selection.value = [id]
        return
      }

      // Shift-clicking something already picked takes it out, which is how a
      // selection is corrected without starting again.
      selection.value = current.includes(id)
        ? current.filter((each) => each !== id)
        : [...current, id]
    },

    clearSelection() {
      selection.value = []
    },

    applyConstraint(tool) {
      const api = frontend()
      const session = open.peek()
      const graph = api?.sceneGraph.peek()
      if (!api || !session || !graph) return

      const constraints = constraintsFor(tool, graph, selection.peek())
      if (constraints.length === 0) {
        /*
         * Refused rather than attempted. The tools accept several shapes of
         * selection and this is the one message a user can act on: what is
         * selected is not something this constraint can be applied to.
         */
        error.value = `That selection cannot be made ${constraintToolInfo(tool).title.toLowerCase()}.`
        return
      }

      run([{ kind: 'constrain', constraints }])
    },

    applyDimension() {
      const api = frontend()
      const session = open.peek()
      const graph = api?.sceneGraph.peek()
      if (!api || !session || !graph) return

      const dimension = dimensionFor(graph, selection.peek(), units())
      if (!dimension) {
        error.value =
          'Select two points, a point and a line, or two lines to dimension.'
        return
      }

      run([{ kind: 'constrain', constraints: [dimension.constraint] }])
    },

    setDimension(constraintId, expression) {
      const session = open.peek()
      if (!session) return

      run([{ kind: 'dimension', constraintId, expression }])
    },

    deleteSelection() {
      const api = frontend()
      const session = open.peek()
      const graph = api?.sceneGraph.peek()
      if (!api || !session || !graph) return

      /*
       * Sorted by what each id actually is, because the frontend takes two
       * lists. The origin is dropped: it is selectable and constrainable and is
       * not something that can be deleted.
       */
      const segmentIds: ApiObjectId[] = []
      const constraintIds: ApiObjectId[] = []

      for (const id of selection.peek()) {
        if (id === 'origin') continue
        const kind = objectAt(graph, id)?.kind.type
        if (kind === 'Segment') segmentIds.push(id)
        if (kind === 'Constraint') constraintIds.push(id)
      }

      if (segmentIds.length === 0 && constraintIds.length === 0) return

      selection.value = []
      run([{ kind: 'discard', segmentIds, constraintIds }])
    },

    place(at: PlanePoint) {
      const current = tool.peek()
      if (!current || !open.peek()) return

      const step = placeDraft(draft.peek(), at, {
        tool: current,
        units: units(),
      })
      draft.value = step.state
      run(step.actions)
    },

    moveTo(at: PlanePoint) {
      if (!open.peek()) return

      /*
       * Gated on there being something to move, not on there being a tool.
       *
       * This used to require an equipped tool, which is what made dragging a
       * point look broken: a drag equips nothing, so every move was dropped and
       * the geometry only jumped at the release. The draft state is the honest
       * question — `idle` means nothing is being moved — and `moveTo` in
       * `draft.ts` is where a tool is asked for by the one state that needs one.
       */
      const state = draft.peek()
      if (state.kind === 'idle') return

      const step = moveDraft(state, at, {
        tool: tool.peek(),
        units: units(),
      })
      draft.value = step.state

      /*
       * A move is superseded rather than queued.
       *
       * The pointer produces events far faster than a solve comes back, and
       * every one of them asks for the same thing at a newer position — so
       * keeping a queue would mean replaying a trail the user has already left
       * behind. Only the latest is worth having, and `latestMove` is where it
       * waits.
       */
      const preview = step.actions.find(
        (action) =>
          (action.kind === 'move' ||
            action.kind === 'drag' ||
            action.kind === 'reshape') &&
          !action.commit
      )
      if (preview) {
        latestMove = preview
        void drainMoves()
        return
      }

      run(step.actions)
    },

    dispose: () => stopWatchingBuffer?.(),
  }
}
