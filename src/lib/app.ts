import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { KclManager } from '@src/lang/KclManager'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'
import type { SaveSettingsPayload } from '@src/lib/settings/settingsTypes'
import { useSelector } from '@xstate/react'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import { assign, createActor, setup, spawnChild } from 'xstate'

import { createAuthCommands } from '@src/lib/commandBarConfigs/authCommandConfig'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { isDesktop } from '@src/lib/isDesktop'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { AppMachineContext, AppMachineEvent } from '@src/lib/types'
import { authMachine } from '@src/machines/authMachine'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/machines/billingMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import {
  getOnlySettingsFromContext,
  settingsMachine,
} from '@src/machines/settingsMachine'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import { systemIOMachineWeb } from '@src/machines/systemIO/systemIOMachineWeb'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { ConnectionManager } from '@src/network/connectionManager'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { initialiseWasm } from '@src/lang/wasmUtils'
import { AppMachineEventType } from '@src/lib/types'
import {
  defaultLayout,
  defaultLayoutConfig,
  saveLayout,
  type Layout,
} from '@src/lib/layout'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { signal } from '@preact/signals-core'
import { getAllCurrentSettings } from '@src/lib/settings/settingsUtils'
import { MachineManager } from '@src/lib/MachineManager'
import { getOppositeTheme, getResolvedTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'

// We set some of our singletons on the window for debugging and E2E tests
declare global {
  interface Window {
    kclManager: KclManager
    engineCommandManager: ConnectionManager
    engineDebugger: Debugger
  }
}

export type SystemIOActor = ActorRefFrom<typeof systemIOMachine>

export class App {
  singletons: ReturnType<typeof this.buildSingletons>

  /**
   * THE bundle of WASM, a cornerstone of our app. We use this for:
   * - settings parse/unparse
   * - KCL parsing, execution, linting, and LSP
   *
   * Access this through `kclManager.wasmInstance`, not directly.
   */
  public wasmPromise = initialiseWasm()

  /** Machines to send models to print or cut on the local network */
  machineManager = window.electron
    ? new MachineManager({
        getMachineApiIp: window.electron.getMachineApiIp,
        listMachines: window.electron.listMachines,
      })
    : new MachineManager() // Instantiate with no-op functions

  private commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise: this.wasmPromise,
      machineManager: this.machineManager,
    },
  }).start()
  /** The command system for the app */
  public commands = {
    actor: this.commandBarActor,
    send: this.commandBarActor.send.bind(this),
    useState: () => useSelector(this.commandBarActor, (state) => state),
  }

  private authActor = createActor(authMachine).start()
  /** Auth system. Use `send` method to act with auth. */
  auth = {
    actor: this.authActor,
    send: (...args: Parameters<typeof this.authActor.send>) =>
      this.authActor.send(...args),
    useAuthState: () => useSelector(this.authActor, (state) => state),
    useToken: () => useSelector(this.authActor, (state) => state.context.token),
    useUser: () => useSelector(this.authActor, (state) => state.context.user),
  }

  private settingsActor = createActor(settingsMachine, {
    input: {
      ...createSettings(),
      commandBarActor: this.commandBarActor,
      wasmInstancePromise: this.wasmPromise,
    },
  }).start()
  // TODO: refactor this to not require keeping around the last settings to compare to
  private lastSettings = signal<SaveSettingsPayload>(
    getAllCurrentSettings(
      getOnlySettingsFromContext(this.settingsActor.getSnapshot().context)
    )
  )
  /** The settings system for the application */
  public settings = {
    actor: this.settingsActor,
    send: this.settingsActor.send.bind(this),
    get: () =>
      getOnlySettingsFromContext(this.settingsActor.getSnapshot().context),
    useSettings: () =>
      useSelector(this.settingsActor, (state) => {
        // We have to peel everything that isn't settings off
        return getOnlySettingsFromContext(state.context)
      }),
  }

  private billingActor = createActor(billingMachine, {
    input: {
      ...BILLING_CONTEXT_DEFAULTS,
      urlUserService: () => withAPIBaseURL(''),
    },
  }).start()
  /** The billing system for the app, which today focuses on Zookeeper credits */
  billing = {
    actor: this.billingActor,
    send: this.billingActor.send.bind(this),
    useContext: () => useSelector(this.billingActor, ({ context }) => context),
  }

  constructor() {
    this.singletons = this.buildSingletons()
    this.settingsActor.subscribe(this.onSettingsUpdate)
  }

  /**
   * Build the world!
   */
  buildSingletons() {
    const engineCommandManager = new ConnectionManager()
    const rustContext = new RustContext(
      engineCommandManager,
      this.wasmPromise,
      // HACK: convert settings to not be an XState actor to prevent the need for
      // this dummy-with late binding of the real thing.
      // TODO: https://github.com/KittyCAD/modeling-app/issues/9356
      this.settingsActor
    )

    // Accessible for tests mostly
    window.engineCommandManager = engineCommandManager

    const kclManager = new KclManager({
      rustContext,
      engineCommandManager,
      settings: this.settingsActor,
      wasmInstancePromise: this.wasmPromise,
    })

    // These are all late binding because of their circular dependency.
    // TODO: proper dependency injection.
    engineCommandManager.kclManager = kclManager
    engineCommandManager.sceneInfra = kclManager.sceneInfra
    engineCommandManager.rustContext = rustContext

    if (typeof window !== 'undefined') {
      ;(window as any).engineCommandManager = engineCommandManager
      ;(window as any).kclManager = kclManager
      ;(window as any).rustContext = rustContext
      ;(window as any).engineDebugger = EngineDebugger
      ;(window as any).enableMousePositionLogs = () =>
        document.addEventListener('mousemove', (e) =>
          console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
        )
      ;(window as any).enableFillet = () => {
        ;(window as any)._enableFillet = true
      }
      ;(window as any).zoomToFit = () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'zoom_to_fit',
            object_ids: [], // leave empty to zoom to all objects
            padding: 0.2, // padding around the objects
            animated: false, // don't animate the zoom for now
          },
        })
    }
    const { SYSTEM_IO } = ACTOR_IDS
    const appMachineActors = {
      [SYSTEM_IO]: isDesktop() ? systemIOMachineDesktop : systemIOMachineWeb,
    } as const

    const appMachine = setup({
      types: {} as {
        events: AppMachineEvent
        context: AppMachineContext
      },
    }).createMachine({
      id: 'modeling-app',
      context: {
        kclManager: kclManager,
        engineCommandManager: engineCommandManager,
        sceneInfra: kclManager.sceneInfra,
        sceneEntitiesManager: kclManager.sceneEntitiesManager,
        commandBarActor: this.commandBarActor,
        layout: defaultLayout,
      },
      entry: [
        spawnChild(appMachineActors[SYSTEM_IO], {
          systemId: SYSTEM_IO,
          input: {
            wasmInstancePromise: this.wasmPromise,
          },
        }),
      ],
      on: {
        [AppMachineEventType.SetLayout]: {
          actions: [
            assign({ layout: ({ event }) => structuredClone(event.layout) }),
            ({ event }) => saveLayout({ layout: event.layout }),
          ],
        },
        [AppMachineEventType.ResetLayout]: {
          actions: [
            assign({ layout: structuredClone(defaultLayoutConfig) }),
            ({ context }) => saveLayout({ layout: context.layout }),
          ],
        },
      },
    })

    const appActor = createActor(appMachine, {
      systemId: 'root',
    })

    // These are all late binding because of their circular dependency.
    // TODO: proper dependency injection.
    kclManager.sceneEntitiesManager.getSettings = this.settings.get

    const systemIOActor = appActor.system.get(SYSTEM_IO) as SystemIOActor
    // This extension makes it possible to mark FS operations as un/redoable
    buildFSHistoryExtension(systemIOActor, kclManager)

    // TODO: proper dependency management
    kclManager.sceneEntitiesManager.commandBarActor = this.commandBarActor
    this.commandBarActor.send({ type: 'Set kclManager', data: kclManager })

    // Initialize global commands
    this.commandBarActor.send({
      type: 'Add commands',
      data: {
        commands: [
          ...createAuthCommands({ authActor: this.authActor }),
          ...createProjectCommands({ systemIOActor }),
        ],
      },
    })

    const layoutSelector = (state: SnapshotFrom<typeof appActor>) =>
      state.context.layout
    const getLayout = () => appActor.getSnapshot().context.layout
    const useLayout = () => useSelector(appActor, layoutSelector)
    const setLayout = (layout: Layout) =>
      appActor.send({ type: AppMachineEventType.SetLayout, layout })

    return {
      engineCommandManager,
      rustContext,
      sceneInfra: kclManager.sceneInfra,
      kclManager,
      sceneEntitiesManager: kclManager.sceneEntitiesManager,
      appActor,
      systemIOActor,
      getLayout,
      useLayout,
      setLayout,
    }
  }

  /**
   * Until we update these dependents of the settings to take settings
   * as a dependency input, we must subscribe to updates from the outside.
   */
  onSettingsUpdate = (snapshot: SnapshotFrom<typeof this.settingsActor>) => {
    const { context } = snapshot

    // Update line wrapping
    this.singletons.kclManager.setEditorLineWrapping(
      context.textEditor.textWrapping.current
    )

    // Update engine highlighting
    const newHighlighting = context.modeling.highlightEdges.current
    if (
      newHighlighting !== this.lastSettings.value?.modeling.highlightEdges &&
      this.singletons.engineCommandManager.connection
    ) {
      this.singletons.engineCommandManager
        .setHighlightEdges(newHighlighting)
        .catch(reportRejection)
    }

    // Update cursor blinking
    const newBlinking = context.textEditor.blinkingCursor.current
    document.documentElement.style.setProperty(
      `--cursor-color`,
      newBlinking ? 'auto' : 'transparent'
    )
    this.singletons.kclManager.setCursorBlinking(newBlinking)

    // Update theme
    const newTheme = context.app.theme.current
    const resolvedTheme = getResolvedTheme(newTheme)
    const opposingTheme = getOppositeTheme(newTheme)
    this.singletons.kclManager.sceneInfra.theme = opposingTheme
    this.singletons.kclManager.sceneEntitiesManager.updateSegmentBaseColor(
      opposingTheme
    )
    this.singletons.kclManager.setEditorTheme(resolvedTheme)
    if (this.singletons.engineCommandManager.connection) {
      this.singletons.engineCommandManager
        .setTheme(newTheme)
        .catch(reportRejection)
    }

    // Execute AST
    try {
      const relevantSetting = (s: SaveSettingsPayload | undefined) => {
        const hasScaleGrid =
          s?.modeling.showScaleGrid !== context.modeling.showScaleGrid.current
        const hasHighlightEdges =
          s?.modeling?.highlightEdges !==
          context.modeling.highlightEdges.current
        return hasScaleGrid || hasHighlightEdges
      }

      const settingsIncludeNewRelevantValues = relevantSetting(
        this.lastSettings.value
      )

      // Unit changes requires a re-exec of code
      if (
        settingsIncludeNewRelevantValues &&
        this.singletons.engineCommandManager.connection
      ) {
        this.singletons.kclManager.executeCode().catch(reportRejection)
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
    this.lastSettings.value = getAllCurrentSettings(
      getOnlySettingsFromContext(context)
    )
  }
}
