import type { UserFeature, UserResponse } from '@kittycad/lib'
import {
  Registry,
  type RegistryItem,
  Slot,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { type Signal, effect, signal } from '@preact/signals-core'
import { KclManager, type ZDSProject } from '@src/lang/KclManager'
import { initialiseWasm } from '@src/lang/wasmUtils'
import { MachineManager } from '@src/lib/MachineManager'
import { createAuthCommands } from '@src/lib/commandBarConfigs/authCommandConfig'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  BODIES_PANE_FEATURE_FLAG,
  OPFS_CLOUD_FEATURE_FLAG,
} from '@src/lib/constants'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { configureOpfsCloudSync } from '@src/lib/fs-zds/opfsCloud'
import { isPlaywright } from '@src/lib/isPlaywright'
import {
  type Layout,
  type LayoutService,
  createLayoutService,
  createLayoutServiceRegistryItem,
  createLayoutWithMetadata,
  defaultLayout,
  loadLayout,
  saveLayout,
  setBodiesPaneLayoutEnabled,
  setLayoutSaveHandler,
} from '@src/lib/layout'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import type { Project } from '@src/lib/project'
import RustContext from '@src/lib/rustContext'
import type { SaveSettingsPayload } from '@src/lib/settings/settingsTypes'
import {
  getAllCurrentSettings,
  jsAppSettings,
} from '@src/lib/settings/settingsUtils'
import { err, reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { authMachine } from '@src/machines/authMachine'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/machines/billingMachine'
import type { MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import {
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import {
  type UserFeaturesActorRef,
  type UserFeaturesContext,
  type UserFeaturesService,
  UserFeaturesTransition,
  userFeaturesContextHas,
  userFeaturesMachine,
} from '@src/machines/userFeaturesMachine'
import { ConnectionManager } from '@src/network/connectionManager'
import {
  type CommandSystemService,
  commandSystemService,
  provideCommand,
} from '@src/registry/contracts/commands'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { keymapService } from '@src/registry/contracts/keymap'
import { layoutContributionsValueSpec } from '@src/registry/contracts/layout'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import {
  type ProjectSessionService,
  projectSessionService,
} from '@src/registry/contracts/projectSession'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { projectsValueSpec } from '@src/registry/contracts/systemIO'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import {
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

const DEFAULT_LAYOUT_CONFIG_NAME = 'default'
const PLAYWRIGHT_LAYOUT_CONFIG_NAME = 'test'
const appCommandsSlot = new Slot()

function isPlaywrightRuntime() {
  return typeof window !== 'undefined' && isPlaywright()
}

function createAppRegistryItems({
  wasmPromise,
  machineManager,
  userFeatures,
}: {
  wasmPromise: Promise<ModuleType>
  machineManager: MachineManager
  userFeatures?: AppUserFeaturesSystem
}): RegistryItem[] {
  return [
    defineRegistryItem({
      id: 'app.wasm-promise',
      provides: [provideWasmPromise(wasmPromise)],
    }),
    defineRegistryItem({
      id: 'app.machine-manager',
      providesServices: [provideService(machineManagerService, machineManager)],
    }),
    ...(userFeatures
      ? [
          defineRegistryItem({
            id: 'app.user-features',
            providesServices: [
              provideService(userFeaturesService, {
                context: userFeatures.contextSignal,
                has: userFeatures.has,
              }),
            ],
          }),
        ]
      : []),
    appCommandsSlot.of(),
    appRegistryServicesSlot.of(),
    ...coreRegistryItems,
  ]
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

export type AppAuthSystem = {
  actor: ActorRefFrom<typeof authMachine>
  send: ActorRefFrom<typeof authMachine>['send']
  useAuthState: () => SnapshotFrom<typeof authMachine>
  useToken: () => string
  useUser: () => UserResponse | undefined
}

export type AppCommandSystem = CommandSystemService

export type AppSettingsSystem = SettingsRegistryService

export type AppBillingSystem = {
  actor: ActorRefFrom<typeof billingMachine>
  send: ActorRefFrom<typeof billingMachine>['send']
  useContext: () => ContextFrom<typeof billingMachine>
}

export type AppUserFeaturesSystem = UserFeaturesService & {
  actor: UserFeaturesActorRef
  send: UserFeaturesActorRef['send']
  contextSignal: Signal<UserFeaturesContext>
  useContext: () => UserFeaturesContext
  useHas: (featureFlagId: UserFeature, defaultValue: boolean) => boolean
}

export type AppLayoutSystem = {
  signal: Signal<Layout>
  get: () => Layout
  set: (l: Layout) => void
  reset: () => void
  service: LayoutService
  saveEffectUnsubscribeFn: ReturnType<typeof effect>
}

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
  /** The currently-opened project and editor lifecycle system */
  projectSession: ProjectSessionService
  /**
   * The interface to reading/writing to IO.
   * TODO: We have agreed to move away from this XState approach, towards a class + signals approach.
   */
  systemIOActor: SystemIOActor

  // TODO: refactor this to not require keeping around the last settings to compare to
  private lastSettings: SaveSettingsPayload
  private pluginSettingsSubscription: Subscription

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
    this.projectSession = this.registry.get(projectSessionService)
    this.projectSignal = this.projectSession.openedProject
    this.projectSession.bindApp(this)

    this.syncAppCommands()
    this.commands.actor.send({
      type: 'Set userFeatures',
      data: this.userFeatures,
    })
    this.auth.actor.subscribe(this.syncUserFeaturesFromAuth)
    this.auth.actor.subscribe(this.syncOpfsCloudBacking)
    this.userFeatures.actor.subscribe(this.syncOpfsCloudBacking)
    this.settings.actor.subscribe(this.syncOpfsCloudBacking)
    this.userFeatures.actor.subscribe(this.syncAppCommands)
    this.syncUserFeaturesFromAuth(this.auth.actor.getSnapshot())
    this.syncOpfsCloudBacking()

    this.singletons = this.buildSingletons()
    this.lastSettings = getAllCurrentSettings(
      getOnlySettingsFromContext(this.settings.actor.getSnapshot().context)
    )
    this.pluginSettingsSubscription = this.settings.actor.subscribe(
      this.syncPluginSettings
    )
    this.syncPluginSettings(this.settings.actor.getSnapshot())

    const projectsSignal = this.registry.signal(projectsValueSpec)
    effect(() => {
      const projects = projectsSignal.value
      if (projects === undefined) {
        return
      }

      this.systemIOActor.send({
        type: SystemIOMachineEvents.setFolders,
        data: { folders: projects },
      })
    })
  }

  /**
   * The default app subsystems during normal runtime.
   * Useful if you want to manipulate, spy, or mock some subsystems in an App instance.
   */
  static getDefaultSystems(wasmPromise = initialiseWasm()) {
    const authActor = createActor(authMachine).start()
    const auth: AppAuthSystem = {
      actor: authActor,
      send: (...args: Parameters<typeof authActor.send>) =>
        authActor.send(...args),
      useAuthState: () => useSelector(authActor, (state) => state),
      useToken: () => useSelector(authActor, (state) => state.context.token),
      useUser: () => useSelector(authActor, (state) => state.context.user),
    }

    const machineManager = window.electron
      ? new MachineManager({
          getMachineApiIp: window.electron.getMachineApiIp,
          listMachines: window.electron.listMachines,
        })
      : new MachineManager() // Instantiate with no-op functions

    const appRegistry = new Registry()
    appRegistry.configure(
      createAppRegistryItems({ wasmPromise, machineManager })
    )
    const commands = appRegistry.get(commandSystemService)
    const settings = appRegistry.get(settingsService)
    const settingsActor = settings.actor
    const engineCommandManager = new ConnectionManager({
      settingsActor,
    })
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

    const userFeaturesActor = createActor(userFeaturesMachine).start()
    const userFeaturesContextSignal = signal<UserFeaturesContext>(
      userFeaturesActor.getSnapshot().context
    )
    userFeaturesActor.subscribe((snapshot) => {
      userFeaturesContextSignal.value = snapshot.context
    })
    const userFeatures: AppUserFeaturesSystem = {
      actor: userFeaturesActor,
      send: userFeaturesActor.send.bind(App),
      contextSignal: userFeaturesContextSignal,
      has: (featureFlagId, defaultValue) =>
        userFeaturesContextHas(
          userFeaturesActor.getSnapshot().context,
          featureFlagId,
          defaultValue
        ),
      useContext: () =>
        useSelector(userFeaturesActor, ({ context }) => context),
      useHas: (featureFlagId, defaultValue) =>
        useSelector(userFeaturesActor, ({ context }) =>
          userFeaturesContextHas(context, featureFlagId, defaultValue)
        ),
    }

    const usePlaywrightLayout = isPlaywrightRuntime()
    const layoutConfigName = usePlaywrightLayout
      ? PLAYWRIGHT_LAYOUT_CONFIG_NAME
      : DEFAULT_LAYOUT_CONFIG_NAME
    const runtimeDefaultLayout = usePlaywrightLayout
      ? playwrightLayoutConfig
      : defaultLayout
    const layoutSignal = signal<Layout>(runtimeDefaultLayout)
    const getRuntimeDefaultLayout = () =>
      setBodiesPaneLayoutEnabled(
        structuredClone(runtimeDefaultLayout),
        !usePlaywrightLayout &&
          userFeatures.has(BODIES_PANE_FEATURE_FLAG, false)
      )
    const layoutService = createLayoutService(layoutSignal)
    const layout: AppLayoutSystem = {
      signal: layoutSignal,
      get: () => layoutSignal.value,
      set: (l: Layout) => {
        layoutSignal.value = structuredClone(l)
      },
      reset: () => {
        layoutSignal.value = getRuntimeDefaultLayout()
      },
      service: layoutService,
      saveEffectUnsubscribeFn: effect(() =>
        saveLayout({ layout: layoutSignal.value, layoutName: layoutConfigName })
      ),
    }
    appRegistry.configure([
      ...createAppRegistryItems({ wasmPromise, machineManager, userFeatures }),
      createLayoutServiceRegistryItem(layoutService),
    ])

    let hasHydratedLayout = false
    let lastBodiesPaneFeatureEnabled: boolean | undefined
    const applyRegistryLayoutContributions = () =>
      layoutService.applyContributions(
        appRegistry.get(layoutContributionsValueSpec)
      )
    const syncBodiesPaneFeatureLayout = () => {
      if (!hasHydratedLayout || usePlaywrightLayout) {
        return
      }

      const enabled = userFeatures.has(BODIES_PANE_FEATURE_FLAG, false)
      if (enabled === lastBodiesPaneFeatureEnabled) {
        return
      }

      const currentLayout = layoutSignal.peek()
      const nextLayout = setBodiesPaneLayoutEnabled(currentLayout, enabled)
      if (nextLayout !== currentLayout) {
        layoutSignal.value = nextLayout
      }
      lastBodiesPaneFeatureEnabled = enabled
    }
    const hydrateLayoutFromSettings = (
      snapshot: SnapshotFrom<typeof settingsActor>
    ) => {
      if (hasHydratedLayout || snapshot.value !== 'idle') {
        return
      }

      setLayoutSaveHandler(({ layout, layoutName }) => {
        const currentLayouts = getOnlySettingsFromContext(
          settingsActor.getSnapshot().context
        ).layout.configs.current

        settingsActor.send({
          type: 'set.layout.configs',
          data: {
            level: 'user',
            value: {
              ...currentLayouts,
              [layoutName ?? 'default']: createLayoutWithMetadata(layout),
            },
          },
        })
      })

      const settingsSnapshot = getOnlySettingsFromContext(snapshot.context)
      const settingsLayout =
        settingsSnapshot.layout.configs.current[layoutConfigName] ??
        settingsSnapshot.layout.configs.current.default
      if (settingsLayout) {
        layoutSignal.value = structuredClone(settingsLayout.layout)
      } else {
        const legacyLayout = loadLayout(layoutConfigName)
        const fallbackLegacyLayout =
          err(legacyLayout) && layoutConfigName !== DEFAULT_LAYOUT_CONFIG_NAME
            ? loadLayout(DEFAULT_LAYOUT_CONFIG_NAME)
            : legacyLayout
        if (!err(fallbackLegacyLayout)) {
          layoutSignal.value = structuredClone(fallbackLegacyLayout)
        }
      }

      hasHydratedLayout = true
      applyRegistryLayoutContributions()
      syncBodiesPaneFeatureLayout()
    }
    settingsActor.subscribe(hydrateLayoutFromSettings)
    hydrateLayoutFromSettings(settingsActor.getSnapshot())
    userFeaturesActor.subscribe(syncBodiesPaneFeatureLayout)
    effect(() => {
      const contributions = appRegistry.signal(
        layoutContributionsValueSpec
      ).value
      if (hasHydratedLayout) {
        layoutService.applyContributions(contributions)
      }
    })

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
    provided: Partial<ReturnType<typeof App.getDefaultSystems>>
  ) {
    const defaults = provided.wasmPromise
      ? App.getDefaultSystems(provided.wasmPromise) // Allows us to instantiate without WASM!
      : App.getDefaultSystems()
    const combined = Object.assign(defaults, provided)
    return new App(combined)
  }

  async openProject(projectIORef: Project) {
    return this.projectSession.openProject(projectIORef)
  }
  closeProject() {
    this.projectSession.closeProject()
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

  syncOpfsCloudBacking = () => {
    if (typeof window === 'undefined' || window.electron) {
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

    configureOpfsCloudSync({
      enabled,
      token,
      projectDirectoryPath:
        this.settings.actor.getSnapshot().context.app.projectDirectory.current,
    })
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
          if (!streamEl || vw <= 0 || vh <= 0) return
          const r = streamEl.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) return
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
