import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { KclManager, ZDSProject } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import { useSelector } from '@xstate/react'
import type { ActorRefFrom, ContextFrom, SnapshotFrom } from 'xstate'
import { createActor } from 'xstate'
import { createAuthCommands } from '@src/lib/commandBarConfigs/authCommandConfig'
import { createProjectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  createSettings,
  type SettingsType,
} from '@src/lib/settings/initialSettings'
import { authMachine } from '@src/machines/authMachine'
import {
  BILLING_CONTEXT_DEFAULTS,
  billingMachine,
} from '@src/machines/billingMachine'
import {
  getOnlySettingsFromContext,
  type SettingsActorType,
  settingsMachine,
} from '@src/machines/settingsMachine'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import {
  type CommandBarActorType,
  commandBarMachine,
} from '@src/machines/commandBarMachine'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { initialiseWasm } from '@src/lang/wasmUtils'
import {
  defaultLayout,
  defaultLayoutConfig,
  saveLayout,
  type Layout,
} from '@src/lib/layout'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import { type Signal, signal, effect } from '@preact/signals-core'
import { MachineManager } from '@src/lib/MachineManager'
import type { Project } from '@src/lib/project'
import type { User } from '@kittycad/lib/dist/types/src'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SystemIOActor } from '@src/machines/systemIO/utils'

// We set some of our singletons on the window for debugging and E2E tests
declare global {
  interface Window {
    app: App
    kclManager: KclManager
    engineCommandManager: ConnectionManager
    rustContext: RustContext
    engineDebugger: Debugger
  }
}

export type AppAuthSystem = {
  actor: ActorRefFrom<typeof authMachine>
  send: ActorRefFrom<typeof authMachine>['send']
  useAuthState: () => SnapshotFrom<typeof authMachine>
  useToken: () => string
  useUser: () => User | undefined
}

export type AppCommandSystem = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export type AppSettingsSystem = {
  actor: SettingsActorType
  send: SettingsActorType['send']
  get: () => SettingsType
  useSettings: () => SettingsType
}

export type AppBillingSystem = {
  actor: ActorRefFrom<typeof billingMachine>
  send: ActorRefFrom<typeof billingMachine>['send']
  useContext: () => ContextFrom<typeof billingMachine>
}

export type AppLayoutSystem = {
  signal: Signal<Layout>
  get: () => Layout
  set: (l: Layout) => void
  reset: () => void
  saveEffectUnsubscribeFn: ReturnType<typeof effect>
}

/** All of the subsystems needed to run the ZDS app */
export interface AppSubsystems {
  wasmPromise: Promise<ModuleType>
  auth: AppAuthSystem
  machineManager: MachineManager
  commands: AppCommandSystem
  settings: AppSettingsSystem
  billing: AppBillingSystem
  layout: AppLayoutSystem
}

export class App implements AppSubsystems {
  public projectSignal: Signal<ZDSProject | undefined> = signal(undefined)
  get project() {
    return this.projectSignal.value
  }
  set project(newProject: ZDSProject | undefined) {
    this.projectSignal.value = newProject
  }
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
  /** The billing system for the application */
  billing: AppBillingSystem
  /** The layout system for the application */
  layout: AppLayoutSystem
  /**
   * The interface to reading/writing to IO.
   * TODO: We have agreed to move away from this XState approach, towards a class + signals approach.
   */
  systemIOActor: SystemIOActor

  constructor(subsystems: AppSubsystems) {
    this.wasmPromise = subsystems.wasmPromise
    this.auth = subsystems.auth
    this.machineManager = subsystems.machineManager
    this.billing = subsystems.billing
    this.commands = subsystems.commands
    this.settings = subsystems.settings
    this.layout = subsystems.layout
    this.systemIOActor = createActor(systemIOMachineImpl, {
      input: {
        wasmInstancePromise: this.wasmPromise,
        app: this,
      },
    }).start()

    // Initialize global commands
    this.commands.actor.send({
      type: 'Add commands',
      data: {
        commands: [
          ...createAuthCommands({ authActor: this.auth.actor }),
          ...createProjectCommands({ systemIOActor: this.systemIOActor }),
        ],
      },
    })

    this.registerWindowHelpersForTests()
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

    const commandBarActor = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise: wasmPromise,
        machineManager,
      },
    }).start()

    const commands: AppCommandSystem = {
      actor: commandBarActor,
      send: commandBarActor.send.bind(this),
      useState: () => useSelector(commandBarActor, (state) => state),
    }

    const settingsActor = createActor(settingsMachine, {
      input: {
        ...createSettings(),
        commandBarActor: commandBarActor,
        wasmInstancePromise: wasmPromise,
      },
    }).start()
    const settings: AppSettingsSystem = {
      actor: settingsActor,
      send: settingsActor.send.bind(this),
      get: () =>
        getOnlySettingsFromContext(settingsActor.getSnapshot().context),
      useSettings: () =>
        useSelector(settingsActor, (state) => {
          // We have to peel everything that isn't settings off
          return getOnlySettingsFromContext(state.context)
        }),
    }

    const billingActor = createActor(billingMachine, {
      input: {
        ...BILLING_CONTEXT_DEFAULTS,
        urlUserService: () => withAPIBaseURL(''),
      },
    }).start()
    const billing: AppBillingSystem = {
      actor: billingActor,
      send: billingActor.send.bind(this),
      useContext: () => useSelector(billingActor, ({ context }) => context),
    }

    const layoutSignal = signal<Layout>(defaultLayout)
    const layout: AppLayoutSystem = {
      signal: layoutSignal,
      get: () => layoutSignal.value,
      set: (l: Layout) => {
        layoutSignal.value = structuredClone(l)
      },
      reset: () => {
        layoutSignal.value = structuredClone(defaultLayoutConfig)
      },
      saveEffectUnsubscribeFn: effect(() =>
        saveLayout({ layout: layoutSignal.value })
      ),
    }

    return {
      wasmPromise,
      auth,
      machineManager,
      commands,
      settings,
      billing,
      layout,
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
    const projectIORefSignal = signal(projectIORef)
    this.project = await ZDSProject.open(projectIORefSignal, this)

    // This extension makes it possible to mark FS operations as un/redoable
    effect(() => {
      if (!!this.project?.executingEditor.value) {
        buildFSHistoryExtension(
          this.systemIOActor,
          this.project.executingEditor.value
        )
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

    return this.project
  }
  closeProject() {
    this.project?.close()
    this.project = undefined
  }

  registerWindowHelpersForTests() {
    if (typeof window !== 'undefined') {
      window.engineDebugger = EngineDebugger
      ;(window as any).enableMousePositionLogs = () =>
        document.addEventListener('mousemove', (e) =>
          console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
        )
      ;(window as any).enableFillet = () => {
        ;(window as any)._enableFillet = true
      }
    }
  }
}
