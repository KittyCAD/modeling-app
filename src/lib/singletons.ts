import { withAPIBaseURL } from '@src/lib/withBaseURL'
import EditorManager from '@src/editor/manager'
import { KclManager } from '@src/lang/KclSingleton'
import CodeManager from '@src/lang/codeManager'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'

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
  mlEphantDefaultContext,
  mlEphantManagerMachine,
} from '@src/machines/mlEphantManagerMachine'
import { settingsMachine } from '@src/machines/settingsMachine'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import { systemIOMachineWeb } from '@src/machines/systemIO/systemIOMachineWeb'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { ConnectionManager } from '@src/network/connectionManager'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { initialShortcuts, ShortcutService } from '@src/lib/shortcuts'

export const engineCommandManager = new ConnectionManager()
export const rustContext = new RustContext(engineCommandManager)

declare global {
  interface Window {
    editorManager: EditorManager
    engineCommandManager: ConnectionManager
    engineDebugger: Debugger
    shortcutsService: ShortcutService
  }
}

// Accessible for tests mostly
window.engineCommandManager = engineCommandManager

export const sceneInfra = new SceneInfra(engineCommandManager)

// This needs to be after sceneInfra and engineCommandManager are is created.
export const editorManager = new EditorManager(engineCommandManager)
export const codeManager = new CodeManager({ editorManager })

// This needs to be after codeManager is created.
// (lee: what??? why?)
export const kclManager = new KclManager(engineCommandManager, {
  rustContext,
  codeManager,
  editorManager,
  sceneInfra,
})
export const shortcutService = new ShortcutService(initialShortcuts)
window.shortcutsService = shortcutService

import { initPromise } from '@src/lang/wasmUtils'
// Initialize KCL version
import { setKclVersion } from '@src/lib/kclVersion'
import { AppMachineEventType } from '@src/lib/types'
import {
  defaultLayout,
  defaultLayoutConfig,
  saveLayout,
  type Layout,
} from '@src/lib/layout'
import { processEnv } from '@src/env'

initPromise
  .then(() => {
    if (processEnv()?.VITEST) {
      const message =
        'singletons is trying to call initPromise and setKclVersion. This will be blocked in VITEST runtimes.'
      console.log(message)
      return
    }

    setKclVersion(kclManager.kclVersion)
  })
  .catch((e) => {
    console.error(e)
  })

// The most obvious of cyclic dependencies.
// This is because the   handleOnViewUpdate(viewUpdate: ViewUpdate): void {
// method requires it for the current ast.
// CYCLIC REF
editorManager.kclManager = kclManager
editorManager.codeManager = codeManager

// These are all late binding because of their circular dependency.
// TODO: proper dependency injection.
engineCommandManager.kclManager = kclManager
engineCommandManager.codeManager = codeManager
engineCommandManager.sceneInfra = sceneInfra
engineCommandManager.rustContext = rustContext

kclManager.sceneInfraBaseUnitMultiplierSetter = (unit: BaseUnit) => {
  sceneInfra.baseUnit = unit
}

export const sceneEntitiesManager = new SceneEntities(
  engineCommandManager,
  sceneInfra,
  editorManager,
  codeManager,
  kclManager,
  rustContext
)

if (typeof window !== 'undefined') {
  ; (window as any).engineCommandManager = engineCommandManager
    ; (window as any).kclManager = kclManager
    ; (window as any).sceneInfra = sceneInfra
    ; (window as any).sceneEntitiesManager = sceneEntitiesManager
    ; (window as any).editorManager = editorManager
    ; (window as any).codeManager = codeManager
    ; (window as any).rustContext = rustContext
    ; (window as any).engineDebugger = EngineDebugger
    ; (window as any).enableMousePositionLogs = () =>
      document.addEventListener('mousemove', (e) =>
        console.log(`await page.mouse.click(${e.clientX}, ${e.clientY})`)
      )
    ; (window as any).enableFillet = () => {
      ; (window as any)._enableFillet = true
    }
    ; (window as any).zoomToFit = () =>
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
const {
  AUTH,
  SETTINGS,
  SYSTEM_IO,
  MLEPHANT_MANAGER,
  COMMAND_BAR,
  BILLING,
} = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine,
  [SYSTEM_IO]: isDesktop() ? systemIOMachineDesktop : systemIOMachineWeb,
  [MLEPHANT_MANAGER]: mlEphantManagerMachine,
  [COMMAND_BAR]: commandBarMachine,
  [BILLING]: billingMachine,
} as const

const appMachine = setup({
  types: {} as {
    events: AppMachineEvent
    context: AppMachineContext
  },
}).createMachine({
  id: 'modeling-app',
  context: {
    codeManager: codeManager,
    kclManager: kclManager,
    engineCommandManager: engineCommandManager,
    sceneInfra: sceneInfra,
    sceneEntitiesManager: sceneEntitiesManager,
    layout: defaultLayout,
  },
  entry: [
    /**
     * We have been battling XState's type unions exploding in size,
     * so for these global actors, we have decided to forego creating them by reference
     * using the `actors` property in the `setup` function, and
     * inline them instead.
     */
    spawnChild(appMachineActors[AUTH], { systemId: AUTH }),
    spawnChild(appMachineActors[SETTINGS], {
      systemId: SETTINGS,
      input: createSettings(),
    }),
    spawnChild(appMachineActors[MLEPHANT_MANAGER], {
      systemId: MLEPHANT_MANAGER,
      input: mlEphantDefaultContext(),
    }),
    spawnChild(appMachineActors[SYSTEM_IO], {
      systemId: SYSTEM_IO,
    }),
    spawnChild(appMachineActors[COMMAND_BAR], {
      systemId: COMMAND_BAR,
      input: {
        commands: [],
      },
    }),
    spawnChild(appMachineActors[BILLING], {
      systemId: BILLING,
      input: {
        ...BILLING_CONTEXT_DEFAULTS,
        urlUserService: () => withAPIBaseURL(''),
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

export const appActor = createActor(appMachine, {
  systemId: 'root',
})

/**
 * GOTCHA: the type coercion of this actor works because it is spawned for
 * the lifetime of {appActor}, but would not work if it were invoked
 * or if it were destroyed under any conditions during {appActor}'s life
 */
export const authActor = appActor.system.get(AUTH) as ActorRefFrom<
  (typeof appMachineActors)[typeof AUTH]
>
export const useAuthState = () => useSelector(authActor, (state) => state)
export const useToken = () =>
  useSelector(authActor, (state) => state.context.token)
export const useUser = () =>
  useSelector(authActor, (state) => state.context.user)

/**
 * GOTCHA: the type coercion of this actor works because it is spawned for
 * the lifetime of {appActor}, but would not work if it were invoked
 * or if it were destroyed under any conditions during {appActor}'s life
 */
export const settingsActor = appActor.system.get(SETTINGS) as ActorRefFrom<
  (typeof appMachineActors)[typeof SETTINGS]
>
export const getSettings = () => {
  const { currentProject: _, ...settings } = settingsActor.getSnapshot().context
  return settings
}

// These are all late binding because of their circular dependency.
// TODO: proper dependency injection.
sceneInfra.camControls.getSettings = getSettings
sceneEntitiesManager.getSettings = getSettings

export const useSettings = () =>
  useSelector(settingsActor, (state) => {
    // We have to peel everything that isn't settings off
    const { currentProject, ...settings } = state.context
    return settings
  })

export type SystemIOActor = ActorRefFrom<
  (typeof appMachineActors)[typeof SYSTEM_IO]
>

export const systemIOActor = appActor.system.get(SYSTEM_IO) as SystemIOActor

export const mlEphantManagerActor = appActor.system.get(
  MLEPHANT_MANAGER
) as ActorRefFrom<(typeof appMachineActors)[typeof MLEPHANT_MANAGER]>

export const commandBarActor = appActor.system.get(COMMAND_BAR) as ActorRefFrom<
  (typeof appMachineActors)[typeof COMMAND_BAR]
>

// TODO: proper dependency management
sceneEntitiesManager.commandBarActor = commandBarActor

export const billingActor = appActor.system.get(BILLING) as ActorRefFrom<
  (typeof appMachineActors)[typeof BILLING]
>

const cmdBarStateSelector = (state: SnapshotFrom<typeof commandBarActor>) =>
  state
export const useCommandBarState = () => {
  return useSelector(commandBarActor, cmdBarStateSelector)
}

// Initialize global commands
commandBarActor.send({
  type: 'Add commands',
  data: {
    commands: [
      ...createAuthCommands({ authActor }),
      ...createProjectCommands({ systemIOActor }),
    ],
  },
})

const layoutSelector = (state: SnapshotFrom<typeof appActor>) =>
  state.context.layout
export const getLayout = () => appActor.getSnapshot().context.layout
export const useLayout = () => useSelector(appActor, layoutSelector)
export const setLayout = (layout: Layout) =>
  appActor.send({ type: AppMachineEventType.SetLayout, layout })
