import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { trackSelectionModifiers } from '@src/lib/selectionModifiers'
import { getResolvedTheme } from '@src/lib/theme'
import { bindMachinePicking } from '@src/lib/kcl/machine/picking'
import type { KeymapTree, KeymapScope } from '@src/registry/contracts/keymap'
import {
  createToolbarCommands,
  TOOLBAR_COMMAND_IDS,
} from '@src/registry/extensions/commands/toolbarCommands'
import { createAppCommands } from '@src/registry/extensions/commands/appCommands'
import {
  computed,
  effect,
  signal,
  type ReadonlySignal,
} from '@preact/signals-core'
import { createActor, waitFor, type SnapshotFrom } from 'xstate'
import { KclManager, KclManagerEvents } from '@src/lang/KclManager'
import type { ProjectSystemDeps } from '@src/lib/projectSession/project'
import { createTextFileIO } from '@src/lib/projectSession/textFileIO'
import { createModelingDocumentAdapter } from '@src/lib/kcl/machine/document'
import type { ModelingViewRuntime } from '@src/lib/kcl/registry/contract'
import type { ModelingInteractionSession } from '@src/lib/kcl/interactions'
import { hasMachineInput, type KclSceneResource } from '@src/lib/kcl/scene/open'
import { modelingMachine } from '@src/machines/modelingMachine'
import { bindModelingMachine } from '@src/machines/modelingMachineBinding'
import { modelingCommandsForMachineApi } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { modelingStdLibCommandSummary } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import { createMachineCommands } from '@src/lib/registerMachineCommands'
import type { ContextualCommandsService } from '@src/lib/commands/contextual'
import {
  buildToolbarConfig,
  modelingMachineStateToToolbarModeName,
  toolbarModeNameToKeymapScope,
  isSketchToolbarTransitioning,
} from '@src/lib/toolbar'
import { bindEngineConnectionSubscriptions } from '@src/lib/kcl/scene/modelingMachineSubscriptions'
import RustContext from '@src/lib/rustContext'
import {
  refreshSketchSolveScale,
  cleanupSketchSolveGroup,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { MODE_MODELING_COMMAND_SCOPE } from '@src/registry/contracts/commands'
import type { CommandSystemService } from '@src/registry/contracts/commands'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { MachineManager } from '@src/lib/MachineManager'
import type {
  UserFeaturesService,
  UserFeaturesSettleService,
} from '@src/machines/userFeaturesMachine'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { isErr, reportRejection } from '@src/lib/trap'

interface Dependencies {
  kclExecutionSettings: SceneExecutionSettings
  commands: CommandSystemService
  contextualCommands: ContextualCommandsService
  keymapTree: ReadonlySignal<KeymapTree>
  keymapScopes: ReadonlySignal<readonly KeymapScope[]>
  fileOperations: FileOperationsRegistryService
  userFeatures: UserFeaturesService & UserFeaturesSettleService
  machineManager: MachineManager
  project: ProjectSystemDeps['project']
  projectPath: ProjectSystemDeps['projectPath']
}

/** Own the machine for one completed model. Re-execution replaces this owner after pending native work drains. */
export async function openMachineModelingOwner(
  context: ModelingViewRuntime,
  scene: KclSceneResource,
  deps: Dependencies,
  invalidate: () => Promise<void>
) {
  if (!hasMachineInput(scene))
    return new Error('The scene has no modeling machine inputs')
  const wasm = await context.wasm
  const ast = scene.runtime.ast.peek()
  const snapshot = scene.runtime.sources.peek()
  const source = snapshot?.files.get(snapshot.src)
  const documentSnapshot = context.executor.editor.state.doc
  if (
    !ast ||
    !snapshot ||
    !source ||
    context.executor.editor.signal.aborted ||
    documentSnapshot.toString() !== new TextDecoder().decode(source) ||
    context.session.resource.peek() !== scene
  )
    return new Error('The executed model changed before its machine opened')
  const lease = scene.runtime.borrowModel(invalidate)
  if (isErr(lease)) return lease
  const rollback: Array<() => void> = [lease.release]
  let published = false
  try {
    const manager = scene.machineInput.manager
    const commands = deps.commands
    const commandsActor = commands.actor
    const rust = new RustContext(
      context.wasm,
      manager,
      context.settings.actor,
      0,
      undefined,
      scene.runtime.nativeContextHost
    )
    rollback.push(() => rust.destroy())
    const document = createModelingDocumentAdapter(
      context.executor.editor,
      lease.source,
      () => {
        void invalidate().catch(reportRejection)
      }
    )
    rollback.push(document.dispose)
    const model = new KclManager(
      snapshot.src,
      context.executor.editor.contents.peek(),
      {
        project: deps.project,
        projectPath: deps.projectPath,
        fileOperations: deps.fileOperations,
        // The document/save service observes source changes; project snapshots observe imports.
        // This manager must not install another filesystem watcher or persistence owner.
        textFileIO: createTextFileIO(deps.fileOperations, {
          watch: () => {},
          unwatch: () => {},
        }),
        wasmInstancePromise: context.wasm,
        settings: context.settings.actor,
        kclExecutionSettings: deps.kclExecutionSettings,
        commandBar: commandsActor,
        engineCommandManager: manager,
        rustContext: rust,
        userFeatures: deps.userFeatures,
      },
      0,
      { document, sceneInfra: scene.sceneInfra, publishState: lease.publish }
    )
    rollback.push(() => {
      model.close()
      model.sceneEntitiesManager.dispose()
    })
    const stopModifiers = trackSelectionModifiers(model)
    rollback.push(stopModifiers)
    model.adoptExecution(
      context.executor.editor.contents.peek(),
      ast,
      scene.runtime.state.peek()
    )
    model.fileSettings = scene.runtime.fileSettings.peek()
    scene.sceneInfra.baseUnit =
      scene.runtime.fileSettings.peek().defaultLengthUnit ??
      scene.preferences.defaultUnit.peek()
    await rust.adoptExecutedProject(
      scene.runtime.state.peek().defaultPlanes,
      scene.runtime.state.peek().engineSceneGeneration
    )
    if (
      context.executor.editor.signal.aborted ||
      context.executor.editor.state.doc !== documentSnapshot ||
      context.session.resource.peek() !== scene
    )
      return new Error('The document changed while its machine was opening')
    const actor = createActor(modelingMachine, {
      input: {
        kclManager: model,
        engineCommandManager: manager,
        rustContext: rust,
        machineManager: deps.machineManager,
        commandBarActor: commandsActor,
        wasmInstance: wasm,
        store: {
          cameraProjection:
            context.settings.current.peek().modeling.cameraProjection,
          defaultUnit: context.settings.current.peek().modeling.defaultUnit,
        },
      },
    })
    const state = signal(actor.getSnapshot())
    const child = signal<SnapshotFrom<typeof sketchSolveMachine> | undefined>(
      undefined
    )
    const commandState = signal(commandsActor.getSnapshot())
    const commandSubscription = commandsActor.subscribe((snapshot) => {
      commandState.value = snapshot
    })
    rollback.push(() => commandSubscription.unsubscribe())
    let closed = false
    const picking = bindMachinePicking({
      scene,
      model,
      actor,
      state,
      child,
      commandState,
      readOnly: context.executor.editor.readOnly,
      wasm,
      isClosed: () => closed,
    })
    rollback.push(picking.release, picking.stopInput)
    const unbind = bindModelingMachine(actor, model)
    rollback.push(unbind, () => actor.stop())
    let stopChild: (() => void) | undefined
    let childRef: unknown
    const subscription = actor.subscribe({
      next: (next) => {
        state.value = next
        const ref = next.children.sketchSolveMachine
        if (ref !== childRef) {
          stopChild?.()
          childRef = ref
          child.value = ref?.getSnapshot() as
            | SnapshotFrom<typeof sketchSolveMachine>
            | undefined
          const sub = ref?.subscribe((snapshot) => {
            child.value = snapshot as SnapshotFrom<typeof sketchSolveMachine>
          })
          stopChild = () => sub?.unsubscribe()
        }
      },
      error: (error) =>
        context.interactions.reportError(
          isErr(error) ? error : new Error(String(error))
        ),
    })
    rollback.push(
      () => subscription.unsubscribe(),
      () => stopChild?.()
    )
    const stopTheme = scene.sceneInfra.themeChange.add(() => {
      model.sceneEntitiesManager.updateSegmentBaseColor(
        getResolvedTheme(scene.sceneInfra.theme)
      )
      const current = child.peek()?.context
      if (current) refreshSketchSolveScale(current)
      scene.sceneInfra.resumeRendering()
    })
    rollback.push(stopTheme)
    const done = (event: Event) =>
      lease.completed((event as CustomEvent).detail)
    model.addEventListener(KclManagerEvents.ExecutionDone, done)
    actor.start()
    const stopEngine = bindEngineConnectionSubscriptions({
      context: actor.getSnapshot().context,
      send: (event) => actor.send(event),
      getState: () => actor.getSnapshot(),
      acceptsPick: () => !scene.selection.internalPicking.peek(),
    })
    const commonCommands = [
      ...createToolbarCommands(
        () => model,
        () => deps.userFeatures
      ),
      ...createAppCommands(() => model),
    ]
    const commandDefinitions = computed(() => {
      void model.kclProgramVersionSignal.value
      return [
        ...commonCommands,
        ...createMachineCommands({
          machineId: 'modeling',
          actor,
          state: state.value,
          send: (event) => actor.send(event),
          commandBarConfig: modelingCommandsForMachineApi(
            context.settings.current.value.app.machineApi.currentSignal.value
          ),
          getDefaultDescription: modelingStdLibCommandSummary,
          scopes: [MODE_MODELING_COMMAND_SCOPE],
          forceDisable:
            context.executor.editor.readOnly.value ||
            context.executor.output.value.running ||
            model.isExecutingSignal.value ||
            !scene.isConnected(),
          showExperimentalCommands: deps.userFeatures.has(
            EXPERIMENTAL_POINT_AND_CLICK_FLAG,
            false
          ),
        }),
      ]
    })
    const commandScope = computed(
      () =>
        toolbarModeNameToKeymapScope[
          modelingMachineStateToToolbarModeName(state.value)
        ]
    )
    const commandSource = deps.contextualCommands.register({
      commands: commandDefinitions,
      scopes: computed(() => [commandScope.value]),
    })
    const stopCommands = () => {
      commandSource.dispose()
      if (
        commandsActor.getSnapshot().context.selectedCommand?.machineActor ===
        actor
      )
        commands.send({ type: 'Close' })
    }
    picking.attach()
    rollback.push(() => stopEngine?.(), stopCommands)
    const interaction: ModelingInteractionSession = {
      id: 'kcl.sketch',
      viewActive: computed(() => state.value.matches('sketchSolveMode')),
      selection: computed(() =>
        state.value.matches('sketchSolveMode') ? picking.sketch : undefined
      ),
      toolbar: signal([]),
      prompt: signal(''),
      defaultPlanes: computed(() => state.value.context.defaultPlaneVisibility),
      error: signal(undefined),
      escape: async () => {
        if (!closed) actor.send({ type: 'Cancel' })
      },
      dispose: async () => {
        if (!closed) actor.send({ type: 'Exit sketch' })
      },
    }
    const stopInteraction = effect(() => {
      const current = state.value
      context.interactions.observe(
        current.matches('idle') ? undefined : interaction,
        isSketchToolbarTransitioning(current) || model.isExecutingSignal.value
      )
    })
    rollback.push(stopInteraction)
    let closing: Promise<void> | undefined
    const dispose = async () => {
      if (closed) return
      closed = true
      picking.stopInput()
      stopInteraction()
      commandSubscription.unsubscribe()
      stopCommands()
      stopEngine?.()
      stopChild?.()
      stopTheme()
      stopModifiers()
      // Stop document publication first. The legacy exit flow may finish native
      // draft cleanup, but cannot overwrite a newer canonical source snapshot.
      document.suspend()
      scene.sceneInfra.resetMouseListeners()
      try {
        await waitFor(
          actor,
          (snapshot) =>
            snapshot.status !== 'active' ||
            snapshot.matches('idle') ||
            snapshot.matches('Sketch no face') ||
            snapshot.matches('sketchSolveMode') ||
            (snapshot.matches('Sketch') &&
              Object.values(snapshot.children).every(
                (child) => child?.getSnapshot().status !== 'active'
              ))
        )
        const snapshot = actor.getSnapshot()
        if (snapshot.matches('sketchSolveMode') || snapshot.matches('Sketch')) {
          actor.send({
            type: snapshot.matches('sketchSolveMode')
              ? 'Exit sketch'
              : 'Cancel',
          })
          await waitFor(
            actor,
            (snapshot) =>
              snapshot.status !== 'active' || snapshot.matches('idle')
          )
        } else if (actor.getSnapshot().matches('Sketch no face'))
          actor.send({ type: 'Cancel' })
      } catch (failure) {
        reportRejection(failure)
      }
      subscription.unsubscribe()
      unbind()
      actor.stop()
      model.close()
      document.dispose()
      cleanupSketchSolveGroup(scene.sceneInfra)
      model.sceneEntitiesManager.dispose()
      scene.sceneInfra.resetMouseListeners()
      scene.sceneInfra.setSend(() => {})
      manager.modelingSend = () => {}
      try {
        await scene.runtime.nativeContextHost.run(async () => {})
      } finally {
        rust.destroy()
        lease.release()
        picking.release()
        context.interactions.observe(undefined)
      }
    }
    published = true
    return {
      scene,
      model,
      pickingArgument: picking.argument,
      selection: picking.selection,
      keymapTree: deps.keymapTree,
      keymapScopes: deps.keymapScopes,
      rust,
      actor,
      state,
      child,
      commands,
      commandSource,
      commandDefinitions,
      toolbarConfig: buildToolbarConfig(commands, {
        showExperimentalFeatures: deps.userFeatures.has(
          EXPERIMENTAL_POINT_AND_CLICK_FLAG,
          false
        ),
      }),
      dispose: () => (closing ??= dispose()),
    }
  } catch (cause) {
    return isErr(cause)
      ? cause
      : new Error('Unable to start the modeling machine', { cause })
  } finally {
    if (!published)
      for (const release of rollback.reverse()) {
        try {
          release()
        } catch (error) {
          reportRejection(error)
        }
      }
  }
}
export type MachineModelingOwner = Exclude<
  Awaited<ReturnType<typeof openMachineModelingOwner>>,
  Error
>

/** Reconnection and executor replacement retire the old actor before publishing a new view-local owner. */
export function createMachineModelingHost(
  getContext: () => ModelingViewRuntime,
  deps: Dependencies
) {
  const owner = signal<MachineModelingOwner | undefined>(undefined)
  const error = signal<Error | undefined>(undefined)
  let disposed = false,
    generation = 0
  let retiring = Promise.resolve()
  let opening: Promise<MachineModelingOwner | Error> | undefined
  const close = async () => {
    generation++
    const current = owner.peek()
    owner.value = undefined
    const pending = opening
    opening = undefined
    retiring = retiring
      .then(async () => {
        await current?.dispose()
        const started = await pending
        if (started && !isErr(started)) await started.dispose()
      })
      .then(() => undefined)
      .catch(reportRejection)
    await retiring
  }
  const stop = effect(() => {
    const context = getContext()
    const scene = context.session.resource.value
    const target = scene?.selection.model.value
    const readOnly = context.executor.editor.readOnly.value
    if (disposed || !scene || !target || readOnly) {
      void close().catch(reportRejection)
      return
    }
    if (owner.peek()?.scene === scene) return
    const ticket = ++generation
    const pending = retiring.then(() =>
      openMachineModelingOwner(context, scene, deps, close)
    )
    opening = pending
    void pending
      .then(async (next) => {
        if (opening === pending) opening = undefined
        if (isErr(next)) {
          if (ticket === generation) error.value = next
          return
        }
        if (disposed || ticket !== generation) {
          await next.dispose()
          return
        }
        owner.value = next
        error.value = undefined
      })
      .catch((cause) => {
        if (ticket === generation)
          error.value = isErr(cause) ? cause : new Error(String(cause))
      })
  })
  return {
    owner: owner as ReadonlySignal<MachineModelingOwner | undefined>,
    error,
    enter: async (id: string) => {
      if (id !== 'kcl.sketch.start') {
        // TODO: Add a machine adapter when another contributed interaction is activated.
        getContext().interactions.reportError(
          new Error(`No machine adapter for interaction: ${id}`)
        )
        return
      }
      owner.peek()?.commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'toolbar',
          name: TOOLBAR_COMMAND_IDS.modeling.sketch,
        },
      })
    },
    closeDialog: () => {
      const current = owner.peek()
      if (
        current &&
        current.commands.actor.getSnapshot().context.selectedCommand
          ?.machineActor === current.actor
      )
        current.commands.send({ type: 'Close' })
    },
    dispose: () => {
      if (disposed) return retiring
      disposed = true
      stop()
      return close()
    },
  }
}
export type MachineModelingHost = ReturnType<typeof createMachineModelingHost>
