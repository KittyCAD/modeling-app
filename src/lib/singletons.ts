import EditorManager from '@src/editor/manager'
import { KclManager } from '@src/lang/KclSingleton'
import CodeManager from '@src/lang/codeManager'
import { EngineCommandManager } from '@src/lang/std/engineConnection'
import RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'

import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'

export const codeManager = new CodeManager()
export const engineCommandManager = new EngineCommandManager()
export const rustContext = new RustContext(engineCommandManager)

declare global {
  interface Window {
    editorManager: EditorManager
    engineCommandManager: EngineCommandManager
  }
}

// Accessible for tests mostly
window.engineCommandManager = engineCommandManager

export const sceneInfra = new SceneInfra(engineCommandManager)
engineCommandManager.camControlsCameraChange = sceneInfra.onCameraChange

// This needs to be after sceneInfra and engineCommandManager are is created.
export const editorManager = new EditorManager(engineCommandManager)

// This needs to be after codeManager is created.
// (lee: what??? why?)
export const kclManager = new KclManager(engineCommandManager, {
  rustContext,
  codeManager,
  editorManager,
  sceneInfra,
})

// The most obvious of cyclic dependencies.
// This is because the   handleOnViewUpdate(viewUpdate: ViewUpdate): void {
// method requires it for the current ast.
// CYCLIC REF
editorManager.kclManager = kclManager

// These are all late binding because of their circular dependency.
// TODO: proper dependency injection.
engineCommandManager.kclManager = kclManager
engineCommandManager.codeManager = codeManager
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
  ;(window as any).engineCommandManager = engineCommandManager
  ;(window as any).kclManager = kclManager
  ;(window as any).sceneInfra = sceneInfra
  ;(window as any).sceneEntitiesManager = sceneEntitiesManager
  ;(window as any).editorManager = editorManager
  ;(window as any).codeManager = codeManager
  ;(window as any).rustContext = rustContext
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

import { useSelector } from '@xstate/react'
import { createActor, setup, spawnChild } from 'xstate'

import { isDesktop } from '@src/lib/isDesktop'
import { createSettings } from '@src/lib/settings/initialSettings'
import { authMachine } from '@src/machines/authMachine'
import type { EngineStreamActor } from '@src/machines/engineStreamMachine'
import {
  engineStreamContextCreate,
  engineStreamMachine,
} from '@src/machines/engineStreamMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import { settingsMachine } from '@src/machines/settingsMachine'
import { systemIOMachineDesktop } from '@src/machines/systemIO/systemIOMachineDesktop'
import { systemIOMachineWeb } from '@src/machines/systemIO/systemIOMachineWeb'
const { AUTH, SETTINGS, SYSTEM_IO, ENGINE_STREAM } = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine,
  [SYSTEM_IO]: isDesktop() ? systemIOMachineDesktop : systemIOMachineWeb,
  [ENGINE_STREAM]: engineStreamMachine,
} as const

const appMachine = setup({
  types: {} as {
    children: {
      auth: typeof AUTH
      settings: typeof SETTINGS
      systemIO: typeof SYSTEM_IO
    }
    context: {
      codeManager: any
      kclManager: any
      engineCommandManager: any
      sceneInfra: any
      sceneEntitiesManager: any
    }
  },
  actors: appMachineActors,
}).createMachine({
  id: 'modeling-app',
  context: {
    codeManager: codeManager,
    kclManager: kclManager,
    engineCommandManager: engineCommandManager,
    sceneInfra: sceneInfra,
    sceneEntitiesManager: sceneEntitiesManager,
  },
  entry: [
    spawnChild(AUTH, { id: AUTH, systemId: AUTH }),
    spawnChild(SETTINGS, {
      id: SETTINGS,
      systemId: SETTINGS,
      input: createSettings(),
    }),
    spawnChild(SYSTEM_IO, { id: SYSTEM_IO, systemId: SYSTEM_IO }),
    spawnChild(ENGINE_STREAM, {
      id: ENGINE_STREAM,
      systemId: ENGINE_STREAM,
      input: engineStreamContextCreate(),
    }),
  ],
})

export const appActor = createActor(appMachine, {
  systemId: 'root',
})

/**
 * GOTCHA: the type coercion of this actor works because it is spawned for
 * the lifetime of {appActor}, but would not work if it were invoked
 * or if it were destroyed under any conditions during {appActor}'s life
 */
export const authActor = appActor.getSnapshot().children.auth!
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
export const settingsActor = appActor.getSnapshot().children.settings!
export const getSettings = () => {
  const { currentProject: _, ...settings } = settingsActor.getSnapshot().context
  return settings
}
export const useSettings = () =>
  useSelector(settingsActor, (state) => {
    // We have to peel everything that isn't settings off
    const { currentProject, ...settings } = state.context
    return settings
  })

export const systemIOActor = appActor.getSnapshot().children.systemIO!

export const engineStreamActor = appActor.system.get(
  ENGINE_STREAM
) as EngineStreamActor
