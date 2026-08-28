import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals'
import { engineConnectionService } from '@src/contracts/engine'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import {
  type ExecutedProgram,
  type KclSceneService,
  kclSceneService,
} from '@src/contracts/kclScene'
import { type Executor, executorsValueSpec } from '@src/contracts/execution'
import { projectSessionService } from '@src/contracts/projectSession'
import { settingsService } from '@src/contracts/settings'
import {
  enableSsaoSetting,
  highlightEdgesSetting,
  showScaleGridSetting,
} from '@src/features/engineScene/settings'
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

  const contextOwner = () => {
    owner ??= createKclContextOwner(engine())
    return owner
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
       * Connecting makes geometry possible, so ask for a run.
       *
       * Requested through the buffer as an annotated transaction — the same path
       * the re-run command takes — rather than by calling the coordinator here.
       * The adapter is what knows how to build a request, and going around it
       * would mean two places constructing one.
       */
      if (!wasConnected && connected) {
        const buffer = sessions().current.peek()?.executingBuffer.peek()
        buffer?.dispatch({
          annotations: [bufferOrigin.of('command'), requestExecution.of(true)],
        })
      }

      wasConnected = connected
    })
  })

  const executor: Executor = {
    id: 'kcl.execution',
    order: 0,
    accepts: (request) =>
      request.languageId === 'kcl' &&
      engine().state.peek().status === 'connected',

    async run(request) {
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
        const resolved = settings()
        const delta = (await context.execute(
          JSON.stringify(ast),
          request.path ?? undefined,
          executorSettingsJson(defaultSettings, {
            highlightEdges: resolved.read(highlightEdgesSetting),
            enableSsao: resolved.read(enableSsaoSetting),
            showScaleGrid: resolved.read(showScaleGridSetting),
          })
        )) as KclSceneGraphDelta

        const outcome = delta?.exec_outcome ?? {}
        // Published as it arrives: this is the only place the graph exists, and
        // selection cannot name what was clicked without it.
        artifacts.value = artifactsFrom(outcome.artifactGraph)

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
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'kclExecution',
      dispose: () => {
        disposed = true
        stopWatching?.()
        owner?.reset()
      },
      providesServices: [provideService(kclSceneService, scene)],
      provides: [provide(executorsValueSpec, executor)],
    }),
  }
}, 'kclExecution')
