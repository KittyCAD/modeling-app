import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { KclManager } from '@src/lang/KclManager'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'

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
  settingsMachine,
  type SettingsMachineContext,
} from '@src/machines/settingsMachine'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import { systemIOMachineWeb } from '@src/machines/systemIO/systemIOMachineWeb'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { ConnectionManager } from '@src/network/connectionManager'
import type { Debugger } from '@src/lib/debugger'
import { EngineDebugger } from '@src/lib/debugger'
import { initPromise } from '@src/lang/wasmUtils'
import { saveSettings } from '@src/lib/settings/settingsUtils'
import { getResolvedTheme, getOppositeTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'

const dummySettingsActor = createActor(settingsMachine, {
  input: createSettings(),
})

export const engineCommandManager = new ConnectionManager()
export const rustContext = new RustContext(
  engineCommandManager,
  initPromise,
  // HACK: convert settings to not be an XState actor to prevent the need for
  // this dummy-with late binding of the real thing.
  // TODO: https://github.com/KittyCAD/modeling-app/issues/9356
  dummySettingsActor
)

declare global {
  interface Window {
    kclManager: KclManager
    engineCommandManager: ConnectionManager
    engineDebugger: Debugger
  }
}

// Accessible for tests mostly
window.engineCommandManager = engineCommandManager

export const sceneInfra = new SceneInfra(engineCommandManager)
export const kclManager = new KclManager(engineCommandManager, initPromise, {
  rustContext,
  sceneInfra,
})

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

// These are all late binding because of their circular dependency.
// TODO: proper dependency injection.
engineCommandManager.kclManager = kclManager
engineCommandManager.sceneInfra = sceneInfra
engineCommandManager.rustContext = rustContext

kclManager.sceneInfraBaseUnitMultiplierSetter = (unit: BaseUnit) => {
  sceneInfra.baseUnit = unit
}

export const sceneEntitiesManager = new SceneEntities(
  engineCommandManager,
  sceneInfra,
  kclManager,
  rustContext
)
/** 🚨 Circular dependency alert 🚨 */
kclManager.sceneEntitiesManager = sceneEntitiesManager

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
const { AUTH, SETTINGS, SYSTEM_IO, COMMAND_BAR, BILLING } = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine.provide({
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

        kclManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true
        const { currentProject, ...settings } = input.context

        await saveSettings(settings, currentProject?.path)

        if (input.toastCallback) {
          input.toastCallback()
        }
      }),
    },
    actions: {
      setEngineTheme: ({ context }) => {
        engineCommandManager
          .setTheme(context.app.theme.current)
          .catch(reportRejection)
      },
      setClientTheme: ({ context }) => {
        const resolvedTheme = getResolvedTheme(context.app.theme.current)
        const opposingTheme = getOppositeTheme(context.app.theme.current)
        sceneInfra.theme = opposingTheme
        sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
        kclManager.setEditorTheme(resolvedTheme)
      },
      setAllowOrbitInSketchMode: ({ context }) => {
        sceneInfra.camControls._setting_allowOrbitInSketchMode =
          context.app.allowOrbitInSketchMode.current
        // ModelingMachineProvider will do a use effect to trigger the camera engine sync
      },
      'Execute AST': ({ context, event }) => {
        try {
          const relevantSetting = (s: SettingsType) => {
            return (
              s.modeling?.defaultUnit?.current !==
                context.modeling.defaultUnit.current ||
              s.modeling.showScaleGrid.current !==
                context.modeling.showScaleGrid.current ||
              s.modeling?.highlightEdges.current !==
                context.modeling.highlightEdges.current
            )
          }

          const allSettingsIncludesUnitChange =
            event.type === 'Set all settings' &&
            relevantSetting(event.settings || context)

          const shouldExecute =
            kclManager !== undefined &&
            (event.type === 'set.modeling.defaultUnit' ||
              event.type === 'set.modeling.showScaleGrid' ||
              event.type === 'set.modeling.highlightEdges' ||
              event.type === 'Reset settings' ||
              allSettingsIncludesUnitChange)

          if (shouldExecute) {
            // Unit changes requires a re-exec of code
            kclManager.executeCode().catch(reportRejection)
          } else {
            // For any future logging we'd like to do
            // console.log(
            //   'Not re-executing AST because the settings change did not affect the code interpretation'
            // )
          }
        } catch (e) {
          console.error('Error executing AST after settings change', e)
        }
      },
      setEngineCameraProjection: ({ context }) => {
        const newCurrentProjection = context.modeling.cameraProjection.current
        sceneInfra.camControls?.setEngineCameraProjection(newCurrentProjection)
      },
    },
  }),
  [SYSTEM_IO]: isDesktop() ? systemIOMachineDesktop : systemIOMachineWeb,
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

// HACK: late attaching settings actor to this manager
rustContext.settingsActor = settingsActor

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
