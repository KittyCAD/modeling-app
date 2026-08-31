import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  ApiObjectId,
  SceneGraph,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type {
  KclContextHandle,
  KclWasmContext,
} from '@src/contracts/kclContext'
import type {
  KclFrontendService,
  SetProgramResult,
  SketchOutcome,
} from '@src/contracts/kclFrontend'
import type { ExecOutcome } from '@rust/kcl-lib/bindings/ExecOutcome'
import { kclErrorMessage } from '@src/lib/kcl/errors'
import { blockingIssues, issueMessage } from '@src/lib/sketch/solveIssues'

/**
 * The version every call is stamped with.
 *
 * A guard against answering with a scene built from text the caller has already
 * moved on from. kcl-lib takes it and the existing app passes zero with a note to
 * come back to it; there is no second version to distinguish yet, and inventing
 * one here would mean inventing what it means.
 */
const VERSION = 0

/** One project, one file, until imports are a thing this can open. */
const PROJECT = 0
const FILE = 0

export interface KclFrontendDependencies {
  /** The shared WASM context. Absent until something has executed. */
  context: () => Promise<KclContextHandle> | null
  /** Settings JSON, built the same way the executor builds it. */
  settings: (defaults: unknown) => string
}

/** What every mutation answers with, before it is given a shape. */
interface RawOutcome {
  sourceDelta?: { text?: string }
  sceneGraphDelta?: {
    new_graph?: SceneGraph
    new_objects?: ApiObjectId[]
    invalidates_ids?: boolean
    exec_outcome?: ExecOutcome
  }
  checkpointId?: number | null
}

/**
 * KCL's sketch frontend.
 *
 * A thin, honest wrapper: it holds the open project, turns arguments into the
 * JSON strings wasm-bindgen wants, and turns what comes back into one shape. The
 * thinking is all on the other side of the boundary — solving a sketch, deciding
 * what the KCL should say — and none of it is reimplemented here.
 *
 * The frontend keeps its *own* copy of the project, which is the one thing to
 * hold in mind: `sync` is what stops that copy and the buffer disagreeing, and
 * while a sketch is open the session must be the only thing writing either.
 */
export function createKclFrontend(
  dependencies: KclFrontendDependencies
): KclFrontendService {
  const { context, settings } = dependencies

  const sceneGraph = signal<SceneGraph | null>(null)
  const opened = signal<string | null>(null)

  /** The context and its settings, or null when nothing has executed yet. */
  const ready = async (): Promise<{
    wasm: KclWasmContext
    settings: string
  } | null> => {
    const pending = context()
    if (!pending) return null

    const handle = await pending
    return { wasm: handle.context, settings: settings(handle.defaultSettings) }
  }

  /**
   * Give an answer one shape.
   *
   * wasm-bindgen hands back a plain object, so this is the one place that reads
   * it. Missing fields are treated as absent rather than trusted: an outcome
   * without a graph is a call that failed to produce one, and pretending
   * otherwise would put `undefined` where a scene belongs.
   */
  const outcomeOf = (raw: unknown, fallbackText: string): SketchOutcome => {
    const answer = (raw ?? {}) as RawOutcome
    const graph = answer.sceneGraphDelta?.new_graph ?? null

    if (graph) sceneGraph.value = graph

    return {
      text: answer.sourceDelta?.text ?? fallbackText,
      graph: graph ?? (sceneGraph.peek() as SceneGraph),
      newObjects: answer.sceneGraphDelta?.new_objects ?? [],
      invalidatesIds: answer.sceneGraphDelta?.invalidates_ids ?? false,
      checkpointId: answer.checkpointId ?? null,
      problem: issueMessage(
        blockingIssues(answer.sceneGraphDelta?.exec_outcome)
      ),
    }
  }

  return {
    sceneGraph: computed(() => sceneGraph.value),
    ready: computed(() => opened.value !== null) as ReadonlySignal<boolean>,

    async sync(path, text) {
      const available = await ready()
      if (!available) return

      /*
       * Opened once, updated after. `open_project` replaces the frontend's whole
       * idea of the project, so calling it per keystroke would throw away the
       * sketch state that makes editing cheap.
       */
      if (opened.peek() !== path) {
        await available.wasm.open_project(
          PROJECT,
          JSON.stringify([{ id: FILE, path, text }]),
          FILE
        )
        opened.value = path
        return
      }

      await available.wasm.update_file(PROJECT, FILE, text)
    },

    async setProgram(programAst): Promise<SetProgramResult> {
      const available = await ready()
      if (!available) return { kind: 'unavailable' }

      /*
       * `SetProgramOutcome` is a tagged union and *both* of its arms come back as
       * a resolved promise: kcl-lib deliberately does not reject when the program
       * fails, because it wants to hand over the partial state it managed to
       * build. So a failure has to be read out of the answer rather than caught.
       */
      const raw = (await available.wasm.hack_set_program(
        JSON.stringify(programAst),
        available.settings
      )) as { type?: string; sceneGraph?: SceneGraph; error?: unknown } | null

      if (raw?.type === 'Success' && raw.sceneGraph) {
        sceneGraph.value = raw.sceneGraph
        return { kind: 'built', graph: raw.sceneGraph }
      }

      return {
        kind: 'failed',
        reason: kclErrorMessage(
          raw?.error ?? raw,
          'The program could not be executed.'
        ),
      }
    },

    async editSketch(sketchId) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      const raw = await available.wasm.edit_sketch(
        JSON.stringify(PROJECT),
        JSON.stringify(FILE),
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        available.settings
      )

      /*
       * Entering answers with a scene but no text, because opening a sketch
       * changes nothing about the file. The caller keeps what it has.
       */
      return outcomeOf(raw, '')
    },

    async exitSketch(sketchId) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      /*
       * A bare `SceneGraph`, not an outcome — the one call here whose answer is
       * shaped unlike its siblings', because leaving a sketch changes no text.
       * Each segment was written into the file when it was drawn, so there is
       * nothing left to write back and the caller's remaining job is to get the
       * file executed.
       */
      const raw = (await available.wasm.exit_sketch(
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        available.settings
      )) as SceneGraph | null

      if (raw?.objects) sceneGraph.value = raw
      return raw ?? null
    },

    async addSegment(sketchId, segment: SegmentCtor, options = {}) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      const raw = await available.wasm.add_segment(
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        JSON.stringify(segment),
        options.label,
        available.settings,
        // A checkpoint per finished action, not per call: a tool that draws
        // several segments checkpoints on its last one.
        options.checkpoint ?? true
      )

      return outcomeOf(raw, '')
    },

    async editSegments(sketchId, segments, options = {}) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      const commit = options.commit ?? true

      const raw = await available.wasm.edit_segments(
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        JSON.stringify(segments),
        available.settings,
        // kcl-lib refuses a checkpoint on a preview, so a caller that asks for
        // both is asking for an error rather than for something subtle.
        commit ? (options.checkpoint ?? false) : false,
        // `null` is "anchor every edited segment", which is kcl-lib's default
        // and what a plain edit wants. A drag says which ones instead.
        JSON.stringify(options.anchorSegmentIds ?? null),
        JSON.stringify(options.anchors ?? []),
        commit,
        // No label edits yet: dimension labels are not drawn, so nothing can
        // move one.
        JSON.stringify([])
      )

      return outcomeOf(raw, '')
    },

    async chainSegment(sketchId, previousEndPointId, segment, options = {}) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      const raw = await available.wasm.chain_segment(
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        JSON.stringify(previousEndPointId),
        JSON.stringify(segment),
        options.label,
        available.settings,
        options.checkpoint ?? false
      )

      return outcomeOf(raw, '')
    },

    async deleteObjects(sketchId, objects) {
      const available = await ready()
      if (!available) throw new Error('KCL is not loaded yet.')

      const raw = await available.wasm.delete_objects(
        JSON.stringify(VERSION),
        JSON.stringify(sketchId),
        JSON.stringify(objects.constraintIds ?? []),
        JSON.stringify(objects.segmentIds ?? []),
        available.settings,
        // Abandoning a draft is not a step anybody wants to undo back into.
        false
      )

      return outcomeOf(raw, '')
    },
  }
}
