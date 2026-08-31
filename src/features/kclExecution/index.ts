import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals'
import type { OperationsByModule } from '@rust/kcl-lib/bindings/OperationsByModule'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { engineConnectionService } from '@src/contracts/engine'
import { type Executor, executorsValueSpec } from '@src/contracts/execution'
import type {
  KclContextHandle,
  KclContextService,
} from '@src/contracts/kclContext'
import { kclContextService } from '@src/contracts/kclContext'
import {
  type ExecutedProgram,
  type KclSceneService,
  kclSceneService,
} from '@src/contracts/kclScene'
import { projectSessionService } from '@src/contracts/projectSession'
import { settingsService } from '@src/contracts/settings'
import {
  enableSsaoSetting,
  highlightEdgesSetting,
  showScaleGridSetting,
} from '@src/features/engineScene/settings'
import { defaultLengthUnitSetting } from '@src/features/units/settings'
import type { KclCompilationIssue } from '@src/features/kclAnalysis/diagnostics'
import { createKclContextOwner } from '@src/features/kclExecution/createKclContext'
import {
  diagnosticsFromFailure,
  diagnosticsFromOutcome,
  type KclSceneGraphDelta,
  summarize,
} from '@src/features/kclExecution/execOutcome'
import { executorSettingsJson } from '@src/features/kclExecution/executorSettings'
import { bufferOrigin, requestExecution } from '@src/lib/buffers/annotations'
import {
  type ArtifactMap,
  artifactsFrom,
  sourceRangeFor,
} from '@src/lib/kcl/artifacts'

/**
 * Executes KCL against the engine.
 *
 * Ordered ahead of the offline analysis executor and accepts only while the
 * engine is connected, so the two compose without either knowing about the
 * other: signed out or disconnected you get diagnostics, connected you get
 * geometry. That is the whole point of executors being contributions with an
 * order.
 *
 * Everything asynchronous still belongs to the coordinator. This submits a
 * versioned capture and returns diagnostics; supersession, cancellation, and
 * stale-result rejection happen above it.
 */
export default defineRegistryItemFactory((ctx) => {
  const engine = () => ctx.services.get(engineConnectionService)
  const sessions = () => ctx.services.get(projectSessionService)
  const settings = () => ctx.services.get(settingsService)
  let owner: ReturnType<typeof createKclContextOwner> | null = null

  /**
   * What the last run built.
   *
   * Replaced wholesale rather than merged: the graph describes one execution of
   * one program, and half of the previous scene mixed into the current one would
   * name entities the engine no longer has.
   */
  const artifacts = signal<ArtifactMap>(new Map())
  const program = signal<ExecutedProgram | null>(null)
  const operations = signal<OperationsByModule>({ map: {} })
  /** Whether a context exists, for anything that must not create one. */
  const contextReady = signal(false)

  const contextOwner = () => {
    owner ??= createKclContextOwner(engine())
    return owner
  }

  /**
   * The context, lent out.
   *
   * One object in kcl-lib carries both `execute` and the sketch frontend, and
   * they share the program and the cached execution state — so sketching borrows
   * this one rather than making its own. Ownership stays here, where the
   * connection's lifetime already is.
   */
  const contextAccess: KclContextService = {
    available: computed(() => contextReady.value),
    get: async () => {
      const handle = await contextOwner().get()
      contextReady.value = true
      return handle as unknown as KclContextHandle
    },
  }

  /**
   * Tie the context's life to the connection's.
   *
   * The context holds a scene on the engine, so it cannot outlive the session
   * that owns that scene. Deferred by a microtask because reading a service
   * during graph construction is not allowed.
   */
  let stopWatching: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return
    let wasConnected = false
    stopWatching = effect(() => {
      const connected = engine().state.value.status === 'connected'

      if (wasConnected && !connected) owner?.reset()

      /**
       * A new connection is a new scene, so bust the cache and then run.
       *
       * kcl-lib caches the program it last drew in a *global* — a `lazy_static`,
       * not something the context owns — so building a fresh context does not
       * clear it. Reconnecting therefore left the Rust side certain that the
       * geometry was already on an engine that had never seen it, `run_with_caching`
       * found the program unchanged, sent nothing, and the scene stayed empty.
       *
       * The existing app's comment on the same call says it plainly: "Bust the
       * cache always! A new connection has been made. The engine has no previous
       * state." It is the one use that library documents as legitimate.
       *
       * Then ask for the run, through the buffer as an annotated transaction —
       * the same path the re-run command takes — because the adapter is what
       * knows how to build a request and two places building one would drift.
       * Ordering is the reset promise's job: the executor waits behind it, so the
       * empty program cannot land on top of the real one.
       */
      if (!wasConnected && connected) {
        void resetScene()

        const buffer = sessions().current.peek()?.executingBuffer.peek()
        buffer?.dispatch({
          annotations: [bufferOrigin.of('command'), requestExecution.of(true)],
        })
      }

      wasConnected = connected
    })
  })

  /**
   * Nothing to execute means nothing to hold.
   *
   * Everything published here describes the *last* run — the program, the
   * artifact graph, the operation list the outline is built from — and none of it
   * was ever cleared. Closing the last KCL buffer therefore left a feature tree
   * standing for a file that was no longer open, and a scene showing geometry
   * with nothing behind it. Neither can be acted on: clicking a row addresses
   * source ranges in text nobody has.
   *
   * The engine goes too. The app already connects when a project opens with
   * something to run, so the symmetry is the point — a session held open for a
   * scene nobody is looking at is a stream nobody is watching, and it costs real
   * resources at the other end. Reconnecting is not free, which is exactly why
   * closing one file of several now hands the executing role on rather than
   * dropping it: this state is reached deliberately, by closing the last one.
   */
  let stopWatchingExecutable: (() => void) | null = null
  queueMicrotask(() => {
    if (disposed) return

    let hadSomething = false
    stopWatchingExecutable = effect(() => {
      const buffer = sessions().current.value?.executingBuffer.value ?? null
      const hasSomething = buffer !== null

      // A transition, not a state: the gap between a project opening and its
      // default file arriving is "nothing to execute" and must not tear down the
      // connection that was just made for it.
      const lost = hadSomething && !hasSomething
      hadSomething = hasSomething
      if (!lost) return

      program.value = null
      artifacts.value = new Map()
      operations.value = { map: {} }

      engine().disconnect()
    })
  })

  /**
   * The scene preferences the executor is given.
   *
   * Read at the moment of the call rather than captured, so a preference changed
   * between two runs reaches the second one.
   */
  const sceneSettingsNow = () => {
    const resolved = settings()
    return {
      highlightEdges: resolved.read(highlightEdgesSetting),
      enableSsao: resolved.read(enableSsaoSetting),
      showScaleGrid: resolved.read(showScaleGridSetting),
      baseUnit: resolved.read(defaultLengthUnitSetting),
    }
  }

  /**
   * A reset in flight, which every execution waits behind.
   *
   * The reset runs an empty program to clear the scene, and it goes straight to
   * the context rather than through the coordinator — so without this it could
   * land *after* the file it was making room for had drawn, and wipe it. One
   * promise the executor awaits is enough to order them, and it needs no queue of
   * its own.
   */
  let resetting: Promise<void> = Promise.resolve()

  /**
   * Clear the engine's scene and kcl-lib's idea of it.
   *
   * Reads `owner` rather than `contextOwner()`, and the difference is the whole
   * condition: there is stale cache state to bust only if a context existed
   * before. On the first connection of a session there is none — the global cache
   * is empty, nothing has been drawn — so this is a no-op rather than a round
   * trip nobody needs. On a *re*connection the owner is still there, holding a
   * cache that describes a scene the new engine has never seen.
   */
  const resetScene = () => {
    const current = owner
    if (!current) return resetting

    resetting = resetting
      .catch(() => {})
      .then(async () => {
        try {
          const { context, defaultSettings } = await current.get()
          await context.bustCacheAndResetScene(
            executorSettingsJson(defaultSettings, sceneSettingsNow())
          )
        } catch (caught) {
          // A scene that went away before it could be cleared is already clear.
          console.warn('kclExecution: could not reset the scene', caught)
        }
      })

    return resetting
  }

  const executor: Executor = {
    id: 'kcl.execution',
    order: 0,
    accepts: (request) =>
      request.languageId === 'kcl' &&
      engine().state.peek().status === 'connected',

    async run(request) {
      // Behind any scene reset, so the empty program it runs cannot land on top
      // of this one.
      await resetting
      const { context, wasm, defaultSettings } = await contextOwner().get()
      if (request.signal.aborted) {
        return { requestId: request.requestId, diagnostics: [] }
      }

      // Parse first, so a syntax error is reported without touching the engine.
      let ast: unknown
      try {
        const [parsed, issues] = wasm.parse_wasm(request.contents) as [
          unknown,
          KclCompilationIssue[],
        ]
        const fatal = (issues ?? []).filter(
          (issue) => issue.severity !== 'Warning'
        )
        if (fatal.length > 0) {
          // Executing a program that does not parse would replace a precise
          // message with a vaguer one from further down.
          return {
            requestId: request.requestId,
            diagnostics: diagnosticsFromOutcome(
              { issues },
              request.contents.length
            ),
          }
        }
        ast = parsed

        /*
         * Published as soon as it parses, before execution.
         *
         * A program that parses but fails to execute is still the right answer to
         * "which sketch is my cursor in" — the file is what it is, whatever the
         * engine made of it.
         */
        program.value = { source: request.contents, ast: parsed as Program }
      } catch (thrown) {
        return {
          requestId: request.requestId,
          diagnostics: diagnosticsFromFailure(thrown, request.contents.length),
        }
      }

      if (request.signal.aborted) {
        return { requestId: request.requestId, diagnostics: [] }
      }

      try {
        // Read per run, not per context: the settings that reach the executor
        // are whatever they are at the moment the program is executed.
        const delta = (await context.execute(
          JSON.stringify(ast),
          request.path ?? undefined,
          executorSettingsJson(defaultSettings, sceneSettingsNow())
        )) as KclSceneGraphDelta

        const outcome = delta?.exec_outcome ?? {}
        // Published as it arrives: this is the only place the graph exists, and
        // selection cannot name what was clicked without it.
        artifacts.value = artifactsFrom(outcome.artifactGraph)
        operations.value = outcome.operations ?? { map: {} }

        return {
          requestId: request.requestId,
          diagnostics: diagnosticsFromOutcome(outcome, request.contents.length),
          outcome: summarize(outcome),
        }
      } catch (thrown) {
        /*
         * A KCL error is a result, not a run failure: the user wants it in the
         * gutter, not an execution marked broken.
         *
         * The artifacts are left alone rather than cleared. A failed run has
         * usually built most of the scene, the engine is still showing it, and
         * clearing them would make everything on screen unselectable because of
         * a typo further down the file.
         */
        return {
          requestId: request.requestId,
          diagnostics: diagnosticsFromFailure(thrown, request.contents.length),
        }
      }
    },
  }

  const scene: KclSceneService = {
    artifacts: computed(() => artifacts.value),
    artifactFor: (entityId) => artifacts.value.get(entityId),
    sourceRangeFor: (entityId) => sourceRangeFor(artifacts.value, entityId),
    program: computed(() => program.value),
    operations: computed(() => operations.value),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'kclExecution',
      dispose: () => {
        disposed = true
        stopWatching?.()
        stopWatchingExecutable?.()
        owner?.reset()
        contextReady.value = false
      },
      providesServices: [
        provideService(kclSceneService, scene),
        provideService(kclContextService, contextAccess),
      ],
      provides: [provide(executorsValueSpec, executor)],
    }),
  }
}, 'kclExecution')
