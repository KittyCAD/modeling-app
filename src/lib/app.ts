import {
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
  Registry,
  type RegistryItem,
  Slot,
} from '@kittycad/registry'
import { effect, type Signal, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import { KclManager, ZDSProject } from '@src/lang/KclManager'
import { createAuthCommands } from '@src/lib/commandBarConfigs/authCommandConfig'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { setKclRuntimeFlagsOnWasm } from '@src/lib/kclRuntimeFlags'
import { layoutService } from '@src/lib/layout/registry/contract'
import type { LayoutService } from '@src/lib/layout/types'
import type { MachineManager } from '@src/lib/MachineManager'
import type { Project } from '@src/lib/project'
import RustContext from '@src/lib/rustContext'
import type { SaveSettingsPayload } from '@src/lib/settings/settingsTypes'
import {
  getAllCurrentSettings,
  jsAppSettings,
} from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { onActiveWasmInstance } from '@src/lib/wasmLifecycle'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import {
  buildZookeeperHistoryExtension,
  type PreparedZookeeperPatchFileReplay,
} from '@src/lib/zookeeper/editorPlugin'
import type { MlEphantManagerActor } from '@src/lib/zookeeper/mlEphantManagerMachine'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/machines/billingMachine'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import {
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import {
  UserFeaturesTransition,
  userFeaturesContextHas,
} from '@src/machines/userFeaturesMachine'
import {
  type AuthRegistryService,
  authService,
} from '@src/registry/contracts/auth'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import {
  type CommandSystemService,
  commandSystemService,
  provideCommand,
} from '@src/registry/contracts/commands'
import { engineCommandManagerService } from '@src/registry/contracts/engineCommandManager'
import { engineSceneRuntimeExtensionsSlot } from '@src/registry/contracts/engineScene'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { keymapService } from '@src/registry/contracts/keymap'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import {
  type UserFeaturesRegistryService,
  userFeaturesService,
} from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import {
  appRegistryOverridesSlot,
  appRegistryServicesSlot,
  coreRegistryItems,
} from '@src/registry/registry'
import { useSelector } from '@xstate/react'
import type {
  ActorRefFrom,
  ContextFrom,
  SnapshotFrom,
  Subscription,
} from 'xstate'
import { createActor } from 'xstate'

const appCommandsSlot = new Slot()

type AppRegistryOptions = {
  registryOverrides?: readonly RegistryItem[]
}

function zookeeperReplayChangesProjectFileSet(
  replayFiles: readonly PreparedZookeeperPatchFileReplay[]
) {
  return replayFiles.some(
    (replayFile) =>
      replayFile.previousContent === null || replayFile.nextContent === null
  )
}

function getZookeeperReplayFallbackFilePath(
  project: ZDSProject,
  deletedPaths: Set<string>
) {
  const defaultFile = project.projectIORefSignal.value.default_file
  const candidates = [
    defaultFile,
    ...project.files.map((file) => file.path),
  ].filter((path, index, paths) => paths.indexOf(path) === index)

  return candidates.find((path) => path && !deletedPaths.has(path))
}

// We set some of our singletons on the window for debugging and E2E tests
declare global {
  interface Window {
    app: App
    engineCommandManager: ConnectionManager
    rustContext: RustContext
    engineDebugger: Debugger
    /** Dev helper: on each click, logs two `makeMouseHelpers` lines (see buildSingletons). */
    enableMousePositionLogs?: () => void
    enableFillet?: () => void
    zoomToFit?: () => void
    /** Dev flag read by fillet debugging paths */
    _enableFillet?: boolean
  }
}

export type AppAuthSystem = AuthRegistryService

export type AppCommandSystem = CommandSystemService

export type AppSettingsSystem = SettingsRegistryService

export type AppBillingSystem = {
  actor: ActorRefFrom<typeof billingMachine>
  send: ActorRefFrom<typeof billingMachine>['send']
  useContext: () => ContextFrom<typeof billingMachine>
}

export type AppUserFeaturesSystem = UserFeaturesRegistryService

export type AppLayoutSystem = LayoutService

export type AppRegistrySystem = Registry

export type AppDebug = {
  mlEphantManagerActor?: MlEphantManagerActor
}

/** All of the subsystems needed to run the ZDS app */
export interface AppSubsystems {
  wasmPromise: Promise<ModuleType>
  auth: AppAuthSystem
  machineManager: MachineManager
  rustContext: RustContext
  engineCommandManager: ConnectionManager
  commands: AppCommandSystem
  settings: AppSettingsSystem
  billing: AppBillingSystem
  userFeatures: AppUserFeaturesSystem
  layout: AppLayoutSystem
  registry: AppRegistrySystem
}

export class App implements AppSubsystems {
  public projectSignal: Signal<ZDSProject | undefined> = signal(undefined)
  public debug: AppDebug = {}
  get project() {
    return this.projectSignal.value
  }
  set project(newProject: ZDSProject | undefined) {
    this.projectSignal.value = newProject
  }
  singletons: ReturnType<typeof this.buildSingletons>
  /**
   * THE bundle of WASM, a cornerstone of our app. We use this for:
   * - settings parse/unparse
   * - KCL parsing, execution, linting, and LSP
   *
   * Access this through `kclManager.wasmInstance`, not directly.
   */
  wasmPromise: Promise<ModuleType>
  /** Auth system. Use `send` method to act with auth. */
  auth: AppAuthSystem
  /** Machines to send models to print or cut on the local network */
  machineManager: MachineManager
  /** The command system for the app */
  commands: AppCommandSystem
  /** The settings system for the application */
  settings: AppSettingsSystem
  /** The engine connection management system */
  engineCommandManager: ConnectionManager
  /** A reloadable wrapper library around the WASM module */
  rustContext: RustContext
  /** The billing system for the application */
  billing: AppBillingSystem
  /** Feature flags available to the authenticated user */
  userFeatures: AppUserFeaturesSystem
  /** The layout system for the application */
  layout: AppLayoutSystem
  /** The registry system for the application */
  registry: AppRegistrySystem
  /**
   * The interface to reading/writing to IO.
   * TODO: We have agreed to move away from this XState approach, towards a class + signals approach.
   */
  systemIOActor: SystemIOActor

  // TODO: refactor this to not require keeping around the last settings to compare to
  private lastSettings: SaveSettingsPayload
  private activeWasmInstance: ModuleType | undefined
  private unsubscribeFromActiveWasmInstance: (() => void) | undefined

  constructor(subsystems: AppSubsystems) {
    this.wasmPromise = subsystems.wasmPromise
    this.auth = subsystems.auth
    this.engineCommandManager = subsystems.engineCommandManager
    this.rustContext = subsystems.rustContext
    this.machineManager = subsystems.machineManager
    this.billing = subsystems.billing
    this.commands = subsystems.commands
    this.settings = subsystems.settings
    this.layout = subsystems.layout
    this.registry = subsystems.registry
    this.userFeatures = subsystems.userFeatures
    this.systemIOActor = createActor(systemIOMachineImpl, {
      input: {
        wasmInstancePromise: this.wasmPromise,
        app: this,
      },
    }).start()

    this.syncAppCommands()
    this.commands.actor.send({
      type: 'Set userFeatures',
      data: this.userFeatures,
    })
    this.auth.actor.subscribe(this.syncUserFeaturesFromAuth)
    this.auth.actor.subscribe(this.syncCloudSyncRuntimePolicy)
    this.userFeatures.actor.subscribe(this.syncCloudSyncRuntimePolicy)
    this.userFeatures.actor.subscribe(this.syncAppCommands)
    this.userFeatures.actor.subscribe(this.syncKclRuntimeFlags)
    this.unsubscribeFromActiveWasmInstance = onActiveWasmInstance(
      this.setActiveWasmInstance
    )
    void this.wasmPromise
      .then(this.setActiveWasmInstance)
      .catch(reportRejection)
    this.syncUserFeaturesFromAuth(this.auth.actor.getSnapshot())
    this.syncCloudSyncRuntimePolicy()

    this.singletons = this.buildSingletons()
    this.lastSettings = getAllCurrentSettings(
      getOnlySettingsFromContext(this.settings.actor.getSnapshot().context)
    )
    this.settings.actor.subscribe(this.syncPluginSettings)
    this.syncPluginSettings(this.settings.actor.getSnapshot())
  }

  /**
   * The default app subsystems during normal runtime.
   * Useful if you want to manipulate, spy, or mock some subsystems in an App instance.
   */
  static getDefaultSystems({
    registryOverrides = [],
  }: AppRegistryOptions = {}) {
    const appRegistry = new Registry()
    appRegistry.configure([
      appRegistryOverridesSlot.of(...registryOverrides),
      appCommandsSlot.of(),
      appRegistryServicesSlot.of(),
      engineSceneRuntimeExtensionsSlot.of(),
      ...coreRegistryItems,
    ])
    const wasmPromise =
      appRegistry.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const auth = appRegistry.get(authService)
    const machineManager = appRegistry.get(machineManagerService).manager
    const userFeatures = appRegistry.get(userFeaturesService)
    const commands = appRegistry.get(commandSystemService)
    const settings = appRegistry.get(settingsService)
    const settingsActor = settings.actor
    const layout = appRegistry.get(layoutService)
    layout.get()
    const engineCommandManager = appRegistry.get(
      engineCommandManagerService
    ).manager
    const rustContext = new RustContext(
      wasmPromise,
      engineCommandManager,
      settingsActor
    )

    const billingActor = createActor(billingMachine, {
      input: {
        ...BILLING_CONTEXT_DEFAULTS,
        urlUserService: () => withAPIBaseURL(''),
      },
    }).start()
    const billing: AppBillingSystem = {
      actor: billingActor,
      send: billingActor.send.bind(App),
      useContext: () => useSelector(billingActor, ({ context }) => context),
    }

    return {
      wasmPromise,
      auth,
      engineCommandManager,
      rustContext,
      machineManager,
      commands,
      settings,
      billing,
      userFeatures,
      layout,
      registry: appRegistry,
    }
  }

  /** Instantiate an App with all the default subsystems */
  static fromDefaults(): App {
    const defaults = App.getDefaultSystems()
    return new App(defaults)
  }

  /**
   * Instantiate an App with some non-default subsystems.
   * Useful for testing, spying, or mocking subsystems (such as WASM in unit tests).
   */
  static fromProvided(
    provided: Partial<ReturnType<typeof App.getDefaultSystems>> &
      AppRegistryOptions = {}
  ) {
    const { registryOverrides, ...subsystems } = provided
    const defaults = App.getDefaultSystems({ registryOverrides })
    const combined = Object.assign(defaults, subsystems)
    return new App(combined)
  }

  async openProject(projectIORef: Project) {
    this.disposeProjectHistoryExtensions?.()
    const projectIORefSignal = signal(projectIORef)
    this.project = await ZDSProject.open(projectIORefSignal, this)

    // These extensions make global project operations un/redoable.
    this.disposeProjectHistoryExtensions = effect(() => {
      const project = this.project
      const executingEditor = project?.executingEditor.value
      if (!project || !executingEditor) {
        return
      }

      const disposeFSHistory = buildFSHistoryExtension(
        this.systemIOActor,
        executingEditor
      )
      const disposeZookeeperHistory = buildZookeeperHistoryExtension({
        kclManager: executingEditor,
        onCurrentFileDelete: async (deletedPaths) => {
          const fallbackPath = getZookeeperReplayFallbackFilePath(
            project,
            deletedPaths
          )
          if (!fallbackPath) {
            return Promise.reject(
              new Error(
                'Cannot replay this Zookeeper edit because no fallback KCL file is available.'
              )
            )
          }

          await project.openEditor(fallbackPath, executingEditor)
        },
        onActiveFileRestore: async (restoredPath, restoredContents) => {
          await project.openEditor(
            restoredPath,
            executingEditor,
            restoredContents
          )
        },
        onProjectFilesReplay: async (replayFiles) => {
          await project.syncReplayedFilesToRust(replayFiles)
          if (zookeeperReplayChangesProjectFileSet(replayFiles)) {
            this.systemIOActor.send({
              type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
            })
          }
        },
      })

      return () => {
        disposeFSHistory()
        disposeZookeeperHistory()
      }
    })

    // TODO: Rework the systemIOActor to fit into the system better,
    // so that the project doesn't need to subscribe to it.
    this.systemIOActor.subscribe(({ context }) => {
      const foundProject = (context.folders ?? []).find(
        (p) =>
          p.name === projectIORefSignal.value.name &&
          p.path === projectIORefSignal.value.path
      )
      if (foundProject && projectIORefSignal.value !== foundProject) {
        projectIORefSignal.value = foundProject
      }
    })

    this.unsubscribeFromSettings = this.settings.actor.subscribe(
      this.onSettingsUpdate
    )

    return this.project
  }
  private unsubscribeFromSettings: Subscription | undefined = undefined
  private disposeProjectHistoryExtensions: (() => void) | undefined = undefined
  dispose() {
    this.closeProject()
    this.unsubscribeFromActiveWasmInstance?.()
    this.unsubscribeFromActiveWasmInstance = undefined
    this.systemIOActor.stop()
    this.settings.actor.stop()
    this.commands.actor.stop()
    this.auth.actor.stop()
    this.billing.actor.stop()
    this.userFeatures.actor.stop()
    this.registry[Symbol.dispose]()
  }

  closeProject() {
    this.disposeProjectHistoryExtensions?.()
    this.disposeProjectHistoryExtensions = undefined
    this.unsubscribeFromSettings?.unsubscribe()
    this.unsubscribeFromSettings = undefined
    this.project?.close()
    this.project = undefined
  }

  syncUserFeaturesFromAuth = (
    snapshot: SnapshotFrom<typeof this.auth.actor>
  ) => {
    if (snapshot.matches('loggedIn')) {
      this.userFeatures.send({
        type: UserFeaturesTransition.Load,
        token: snapshot.context.token,
      })
      return
    }

    if (snapshot.matches('loggedOut')) {
      this.userFeatures.send({ type: UserFeaturesTransition.Clear })
    }
  }

  syncCloudSyncRuntimePolicy = () => {
    if (typeof window === 'undefined') {
      return
    }

    const authSnapshot = this.auth.actor.getSnapshot()
    const token = authSnapshot.matches('loggedIn')
      ? authSnapshot.context.token
      : undefined
    const enabled =
      Boolean(token) &&
      userFeaturesContextHas(
        this.userFeatures.actor.getSnapshot().context,
        OPFS_CLOUD_FEATURE_FLAG,
        false
      )

    this.registry.get(cloudSyncService).configure({
      enabled,
      token,
      syncExistingLocalProjects: !window.electron,
    })
  }

  setActiveWasmInstance = (wasmInstance: ModuleType) => {
    this.activeWasmInstance = wasmInstance
    this.syncKclRuntimeFlags()
  }

  syncKclRuntimeFlags = () => {
    if (!this.activeWasmInstance) {
      return
    }

    setKclRuntimeFlagsOnWasm(this.activeWasmInstance, this.userFeatures)
  }

  syncAppCommands = () => {
    const enableProjectDirectoryCommands =
      typeof window !== 'undefined' &&
      (Boolean(window.electron) ||
        userFeaturesContextHas(
          this.userFeatures.actor.getSnapshot().context,
          OPFS_CLOUD_FEATURE_FLAG,
          false
        ))

    this.registry.reconfigure(appCommandsSlot, [
      defineRegistryItem({
        id: 'app.global-commands',
        provides: [
          ...createAuthCommands({ authActor: this.auth.actor }).map(
            provideCommand
          ),
          ...createProjectCommands({
            systemIOActor: this.systemIOActor,
            enableProjectDirectoryCommands,
            getCurrentProjectDirectoryName: () =>
              this.settings.actor.getSnapshot().context.currentProject?.name,
          }).map(provideCommand),
        ],
      }),
    ])
  }

  /**
   * Keep plugin runtime state aligned with the persisted settings model.
   *
   * For now the settings actor is the source of truth and plugin toggle
   * services are an imperative projection of that state. A narrower follow-up
   * can invert this by deriving both the UI and persistence model directly from
   * extension-owned settings state.
   */
  syncPluginSettings = (snapshot: SnapshotFrom<typeof this.settings.actor>) => {
    const pluginActivationSettings = new Map(
      this.registry
        .get(zdsPluginActivationSettingsValueSpec)
        .map((setting) => [setting.pluginId, setting])
    )
    const activePluginIds: string[] = []

    for (const plugin of this.registry.get(pluginsValueSpec)) {
      const activationSetting = pluginActivationSettings.get(plugin.id)
      if (!activationSetting) {
        continue
      }

      const desiredActive = (
        snapshot.context as unknown as Record<
          string,
          Record<string, { current: unknown } | undefined> | undefined
        >
      )[activationSetting.category]?.[activationSetting.settingName]?.current
      if (typeof desiredActive !== 'boolean') {
        continue
      }
      if (desiredActive) {
        activePluginIds.push(plugin.id)
      }

      const toggle = this.registry.get(plugin.service)
      if (toggle.active.value === desiredActive) {
        continue
      }

      if (desiredActive) {
        toggle.enable()
        continue
      }

      toggle.disable()
    }

    const syncActivePlugins =
      typeof window !== 'undefined'
        ? window.electron?.pluginIpc.syncActivePlugins
        : undefined
    if (syncActivePlugins) {
      void syncActivePlugins(activePluginIds).catch(reportRejection)
    }
  }

  /**
   * Build the world!
   */
  buildSingletons() {
    // TODO: Remove this and make the app handle no executing editor,
    // so we don't need to stub with empty strings
    const kclManager = new KclManager('', '', {
      settings: this.settings.actor,
      wasmInstancePromise: this.wasmPromise,
      commandBar: this.commands.actor,
      projectPath: signal(''),
      engineCommandManager: this.engineCommandManager,
      rustContext: this.rustContext,
      keymap: this.registry.get(keymapService),
    })

    this.registry.reconfigure(appRegistryServicesSlot, [
      defineRegistryItem({
        id: 'app.runtime-services',
        providesServices: [
          provideService(
            executingEditorService,
            kclManager.executingEditorService
          ),
          provideService(systemIOService, {
            actor: this.systemIOActor,
          }),
        ],
      }),
    ])

    if (typeof window !== 'undefined') {
      window.engineCommandManager = kclManager.engineCommandManager
      window.rustContext = kclManager.rustContext
      window.engineDebugger = EngineDebugger

      /**
       * On each click, logs two lines for `SceneFixture.makeMouseHelpers` /
       * `convertPagePositionToStream` (e2e/playwright/fixtures/sceneFixture.ts).
       * Adds a document listener per call.
       */
      window.enableMousePositionLogs = () => {
        const onClick = (e: MouseEvent) => {
          const streamEl = document.querySelector('[data-testid="stream"]')
          const vw = document.documentElement.clientWidth
          const vh = document.documentElement.clientHeight
          if (!streamEl || vw <= 0 || vh <= 0) {
            return
          }
          const r = streamEl.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) {
            return
          }
          const cx = e.clientX
          const cy = e.clientY
          const ratioX = (cx - r.left) / r.width
          const ratioY = (cy - r.top) / r.height
          const pixelX = ratioX * vw
          const pixelY = ratioY * vh
          console.log(
            `[mouse→e2e] makeMouseHelpers(${ratioX.toFixed(4)}, ${ratioY.toFixed(4)}, { format: 'ratio' })`
          )
          console.log(
            `[mouse→e2e] makeMouseHelpers(${Math.round(pixelX)}, ${Math.round(pixelY)}, { steps: 20, format: 'pixels' })`
          )
        }
        document.addEventListener('click', onClick, true)
      }

      window.enableFillet = () => {
        window._enableFillet = true
      }
      window.zoomToFit = () => {
        void kclManager.engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'zoom_to_fit',
            object_ids: [],
            padding: 0.2,
            animated: false,
          },
        })
      }
    }

    this.commands.actor.send({ type: 'Set kclManager', data: kclManager })

    return {
      kclManager,
    }
  }

  /**
   * Until we update these dependents of the settings to take settings
   * as a dependency input, we must subscribe to updates from the outside.
   */
  onSettingsUpdate = (snapshot: SnapshotFrom<typeof this.settings.actor>) => {
    if (!this.project) {
      return // Everything in here only matters inside a project.
    }
    const { context } = snapshot

    // Update line wrapping
    this.singletons.kclManager.setEditorLineWrapping(
      context.textEditor.textWrapping.current
    )

    // Update engine highlighting
    const newHighlighting = context.modeling.highlightEdges.current
    if (
      newHighlighting !== this.lastSettings.modeling.highlightEdges &&
      this.singletons.kclManager.engineCommandManager.connection
    ) {
      this.singletons.kclManager.engineCommandManager
        .setHighlightEdges(newHighlighting)
        .catch(reportRejection)
    }

    // Update cursor blinking
    const newBlinking = context.textEditor.blinkingCursor.current
    document.documentElement.style.setProperty(
      '--cursor-color',
      newBlinking ? 'auto' : 'transparent'
    )
    this.singletons.kclManager.setCursorBlinking(newBlinking)

    // Update theme
    const newTheme = context.app.theme.current
    const newBackfaceColor = context.modeling.backfaceColor.current
    Promise.all([
      this.singletons.kclManager.updateTheme(newTheme),
      ...(this.singletons.kclManager.engineCommandManager.connection?.connected
        ? [
            this.singletons.kclManager.engineCommandManager.setDefaultSystemProperties(
              newBackfaceColor
            ),
          ]
        : []),
    ]).catch(reportRejection)

    // Execute AST
    try {
      const relevantSetting = (s: SaveSettingsPayload) => {
        const hasScaleGrid =
          s.modeling.showScaleGrid !== context.modeling.showScaleGrid.current
        const hasHighlightEdges =
          s.modeling.highlightEdges !== context.modeling.highlightEdges.current
        const hasBackfaceColor =
          s.modeling.backfaceColor !== context.modeling.backfaceColor.current
        return hasScaleGrid || hasHighlightEdges || hasBackfaceColor
      }

      const settingsIncludeNewRelevantValues = relevantSetting(
        this.lastSettings
      )

      // Relevant settings requiring a cleared scene and re-exec
      if (
        settingsIncludeNewRelevantValues &&
        this.singletons.kclManager.engineCommandManager.connection
      ) {
        this.singletons.kclManager.rustContext
          .clearSceneAndBustCache(
            jsAppSettings(this.settings.actor),
            this.singletons.kclManager.path
          )
          .then(() => this.singletons.kclManager.executeCode())
          .catch(reportRejection)
      }
    } catch (e) {
      console.error('Error executing AST after settings change', e)
    }

    this.singletons.kclManager.sceneInfra.camControls._setting_allowOrbitInSketchMode =
      context.app.allowOrbitInSketchMode.current

    const newCurrentProjection = context.modeling.cameraProjection.current
    if (
      this.singletons.kclManager.sceneInfra.camControls &&
      !this.singletons.kclManager.modelingState?.matches('Sketch')
    ) {
      this.singletons.kclManager.sceneInfra.camControls.engineCameraProjection =
        newCurrentProjection
    }

    // TODO: Migrate settings to not be an XState actor so we don't need to save a snapshot
    // of the last settings to know if they've changed.
    this.lastSettings = getAllCurrentSettings(
      getOnlySettingsFromContext(context)
    )
  }
}
