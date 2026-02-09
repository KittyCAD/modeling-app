import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { KclManager } from '@src/lang/KclManager'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  BaseUnit,
  SaveSettingsPayload,
} from '@src/lib/settings/settingsTypes'

import { useSelector } from '@xstate/react'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import { assign, createActor, fromPromise, setup, spawnChild } from 'xstate'

import { createAuthCommands } from '@src/lib/commandBarConfigs/authCommandConfig'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { isDesktop } from '@src/lib/isDesktop'
import {
  createSettings,
  type SettingsType,
} from '@src/lib/settings/initialSettings'
import type { AppMachineContext, AppMachineEvent } from '@src/lib/types'
import { authMachine } from '@src/machines/authMachine'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/machines/billingMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import {
  getOnlySettingsFromContext,
  SettingsActorType,
  settingsMachine,
  type SettingsMachineContext,
} from '@src/machines/settingsMachine'
import {
  getAllCurrentSettings,
  loadAndValidateSettings,
} from '@src/lib/settings/settingsUtils'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import { systemIOMachineWeb } from '@src/machines/systemIO/systemIOMachineWeb'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { ConnectionManager } from '@src/network/connectionManager'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { initialiseWasm } from '@src/lang/wasmUtils'
import { saveSettings } from '@src/lib/settings/settingsUtils'
import { getResolvedTheme, getOppositeTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { AppMachineEventType } from '@src/lib/types'
import {
  defaultLayout,
  defaultLayoutConfig,
  saveLayout,
  type Layout,
} from '@src/lib/layout'
import type { Project } from '@src/lib/project'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { signal } from '@preact/signals-core'

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

  private commandBarActor = createActor(commandBarMachine, {
    input: { commands: [], wasmInstancePromise: this.wasmPromise },
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

  // TODO: refactor this to not require keeping around the last settings to compare to
  private lastSettings = signal<SaveSettingsPayload | undefined>(undefined)

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
  }

  /**
   * Build the world!
   */
  buildSingletons() {
    const dummySettingsActor = createActor(settingsMachine, {
      input: { commandBarActor: this.commandBarActor, ...createSettings() },
    })

    const engineCommandManager = new ConnectionManager()
    const rustContext = new RustContext(
      engineCommandManager,
      this.wasmPromise,
      // HACK: convert settings to not be an XState actor to prevent the need for
      // this dummy-with late binding of the real thing.
      // TODO: https://github.com/KittyCAD/modeling-app/issues/9356
      dummySettingsActor
    )

    // Accessible for tests mostly
    window.engineCommandManager = engineCommandManager

    const sceneInfra = new SceneInfra(engineCommandManager, this.wasmPromise)
    const kclManager = new KclManager(engineCommandManager, this.wasmPromise, {
      rustContext,
      sceneInfra,
    })

    // These are all late binding because of their circular dependency.
    // TODO: proper dependency injection.
    engineCommandManager.kclManager = kclManager
    engineCommandManager.sceneInfra = sceneInfra
    engineCommandManager.rustContext = rustContext

    kclManager.sceneInfraBaseUnitMultiplierSetter = (unit: BaseUnit) => {
      sceneInfra.baseUnit = unit
    }

    const sceneEntitiesManager = new SceneEntities(
      engineCommandManager,
      sceneInfra,
      kclManager,
      rustContext
    )
    /** 🚨 Circular dependency alert 🚨 */
    kclManager.sceneEntitiesManager = sceneEntitiesManager

    /**
     * TODO: remove dependence on other subsystems. Instead, make those systems
     * subscribe to settings changes.
     */
    const settingsWithProvides = settingsMachine.provide({
      actors: {
        persistSettings: fromPromise<
          undefined,
          {
            doNotPersist: boolean
            context: SettingsMachineContext
            toastCallback?: () => void
          }
        >(async ({ input }) => {
          // Without this, when a user changes the file, it'd
          // create a detection loop with the file-system watcher.
          if (input.doNotPersist) return

          const {
            currentProject,
            commandBarActor: _c,
            ...settings
          } = input.context

          await saveSettings(this.wasmPromise, settings, currentProject?.path)

          if (input.toastCallback) {
            input.toastCallback()
          }
        }),
        loadUserSettings: fromPromise<SettingsType, SettingsType>(async () => {
          const { settings } = await loadAndValidateSettings(
            kclManager.wasmInstancePromise
          )
          return settings
        }),
        loadProjectSettings: fromPromise<
          SettingsType,
          { project?: Project; settings: SettingsType }
        >(async ({ input }) => {
          const { settings } = await loadAndValidateSettings(
            kclManager.wasmInstancePromise,
            input.project?.path
          )
          return settings
        }),
      },
    })
    const settingsActor = createActor(settingsWithProvides, {
      input: {
        ...createSettings(),
        commandBarActor: this.commandBarActor,
      },
    }).start()

    const onSettingsUpdate = ({ context }: SnapshotFrom<SettingsActorType>) => {
      // Update line wrapping
      const newWrapping = context.textEditor.textWrapping.current
      if (newWrapping !== this.lastSettings.value?.textEditor.textWrapping) {
        kclManager.setEditorLineWrapping(newWrapping)
      }

      // Update engine highlighting
      const newHighlighting = context.modeling.highlightEdges.current
      if (
        newHighlighting !== this.lastSettings.value?.modeling.highlightEdges
      ) {
        engineCommandManager
          .setHighlightEdges(newHighlighting)
          .catch(reportRejection)
      }

      // Update cursor blinking
      const newBlinking = context.textEditor.blinkingCursor.current
      if (newBlinking !== this.lastSettings.value?.textEditor.blinkingCursor) {
        document.documentElement.style.setProperty(
          `--cursor-color`,
          newBlinking ? 'auto' : 'transparent'
        )
        kclManager.setCursorBlinking(newBlinking)
      }

      // Update theme
      const newTheme = context.app.theme.current
      if (newTheme !== this.lastSettings.value?.app.theme) {
        const resolvedTheme = getResolvedTheme(newTheme)
        const opposingTheme = getOppositeTheme(newTheme)
        sceneInfra.theme = opposingTheme
        sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
        kclManager.setEditorTheme(resolvedTheme)
        engineCommandManager.setTheme(newTheme).catch(reportRejection)
      }

      // Execute AST
      try {
        const relevantSetting = (s: SaveSettingsPayload | undefined) => {
          return (
            s?.modeling?.defaultUnit !== context.modeling.defaultUnit.current ||
            s?.modeling.showScaleGrid !==
              context.modeling.showScaleGrid.current ||
            s?.modeling?.highlightEdges !==
              context.modeling.highlightEdges.current
          )
        }

        const settingsIncludeNewRelevantValues = relevantSetting(
          this.lastSettings.value
        )

        // Unit changes requires a re-exec of code
        if (settingsIncludeNewRelevantValues) {
          kclManager.executeCode().catch(reportRejection)
        }
      } catch (e) {
        console.error('Error executing AST after settings change', e)
      }

      this.lastSettings.value = getAllCurrentSettings(
        getOnlySettingsFromContext(context)
      )
    }
    settingsActor.subscribe(onSettingsUpdate)

    settingsActor.subscribe((snapshot) => {
      sceneInfra.camControls._setting_allowOrbitInSketchMode =
        snapshot.context.app.allowOrbitInSketchMode.current

      const newCurrentProjection =
        snapshot.context.modeling.cameraProjection.current
      if (
        sceneInfra.camControls &&
        newCurrentProjection !== sceneInfra.camControls.engineCameraProjection
      ) {
        sceneInfra.camControls.engineCameraProjection = newCurrentProjection
      }
    })

    if (typeof window !== 'undefined') {
      ;(window as any).engineCommandManager = engineCommandManager
      ;(window as any).kclManager = kclManager
      ;(window as any).sceneInfra = sceneInfra
      ;(window as any).sceneEntitiesManager = sceneEntitiesManager
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
        sceneInfra: sceneInfra,
        sceneEntitiesManager: sceneEntitiesManager,
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

    // HACK: late attaching settings actor to this manager
    rustContext.settingsActor = settingsActor

    const getSettings = () => {
      const { currentProject: _, ...settings } =
        settingsActor.getSnapshot().context
      return settings
    }

    // These are all late binding because of their circular dependency.
    // TODO: proper dependency injection.
    sceneInfra.camControls.getSettings = getSettings
    sceneEntitiesManager.getSettings = getSettings

    const useSettings = () =>
      useSelector(settingsActor, (state) => {
        // We have to peel everything that isn't settings off
        return getOnlySettingsFromContext(state.context)
      })

    const systemIOActor = appActor.system.get(SYSTEM_IO) as SystemIOActor
    // This extension makes it possible to mark FS operations as un/redoable
    buildFSHistoryExtension(systemIOActor, kclManager)

    // TODO: proper dependency management
    sceneEntitiesManager.commandBarActor = this.commandBarActor
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
      sceneInfra,
      kclManager,
      sceneEntitiesManager,
      appActor,
      settingsActor,
      getSettings,
      useSettings,
      systemIOActor,
      getLayout,
      useLayout,
      setLayout,
    }
  }
}
