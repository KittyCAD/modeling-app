import {
  ARG_ANGLE,
  ARG_END_ABSOLUTE_X,
  ARG_END_ABSOLUTE_Y,
  ARG_LENGTH,
  ARG_LENGTH_X,
  ARG_LENGTH_Y,
} from '@src/lang/constants'
import { createArrayExpression } from '@src/lang/create'
import { findKwArg, findKwArgAny } from '@src/lang/util'
import type { CallExpressionKw, Expr } from '@src/lang/wasm'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { ConnectionManager } from '@src/network/connectionManager'
import RustContext from '@src/lib/rustContext'
import { KclManager } from '@src/lang/KclManager'
import { reportRejection } from '@src/lib/trap'
import env from '@src/env'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { createActor } from 'xstate'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createSettings } from '@src/lib/settings/initialSettings'
import { settingsMachine } from '@src/machines/settingsMachine'
import { getSettingsFromActorContext } from '@src/lib/settings/settingsUtils'
import { MachineManager } from '@src/lib/MachineManager'

/**
 * Throw x if it's an Error. Only use this in tests.
 */
export function assertNotErr<T>(x: T): asserts x is Exclude<T, Error> {
  if (x instanceof Error) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw x
  }
}

/**
Find the angle and some sort of length parameter from an angledLine-ish call.
E.g. finds the (angle, length) in angledLine or the (angle, endAbsoluteX) in angledLineToX
*/
export function findAngleLengthPair(call: CallExpressionKw): Expr | undefined {
  const angle = findKwArg(ARG_ANGLE, call)
  const lengthLike = findKwArgAny(
    [
      ARG_LENGTH,
      ARG_LENGTH_X,
      ARG_LENGTH_Y,
      ARG_END_ABSOLUTE_X,
      ARG_END_ABSOLUTE_Y,
    ],
    call
  )
  if (angle && lengthLike) {
    return createArrayExpression([angle, lengthLike])
  }
}

// Initialize all the singletons, the WASM blob, and open an engine connection
// Most likely a lite engine connection because this function should only run in vitest
// if this runs in vitest the engineCommandManager will run a lite connection mode.
export async function buildTheWorldAndConnectToEngine() {
  const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  const instancePromise = loadAndInitialiseWasmInstance(WASM_PATH)
  const engineCommandManager = new ConnectionManager()
  const machineManager = new MachineManager()
  const commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise: instancePromise,
      machineManager,
    },
  }).start()
  const settingsActor = createActor(settingsMachine, {
    input: {
      commandBarActor,
      ...createSettings(),
      wasmInstancePromise: instancePromise,
    },
  })
  const rustContext = new RustContext(
    engineCommandManager,
    instancePromise,
    settingsActor
  )
  const kclManager = new KclManager({
    engineCommandManager,
    wasmInstancePromise: instancePromise,
    rustContext,
    settings: settingsActor,
    commandBar: commandBarActor,
  })
  engineCommandManager.kclManager = kclManager
  engineCommandManager.sceneInfra = kclManager.sceneInfra
  engineCommandManager.rustContext = rustContext

  kclManager.sceneEntitiesManager.commandBarActor = commandBarActor

  const getSettings = () => getSettingsFromActorContext(settingsActor)
  kclManager.sceneInfra.camControls.getSettings = getSettings
  kclManager.sceneEntitiesManager.getSettings = getSettings

  await new Promise((resolve, reject) => {
    engineCommandManager
      .start({
        token: env().VITE_ZOO_API_TOKEN || '',
        width: 256,
        height: 256,
        setStreamIsReady: () => {
          console.log('no op for a unit test')
        },
        callbackOnUnitTestingConnection: (message: string) => {
          if (message === 'auth_token_invalid') {
            const reason =
              'auth_token_invalid for the engine. Please set VITE_ZOO_API_TOKEN to the development token.'
            reject(reason)
          }

          if (message === 'auth success') {
            resolve(true)
            console.log('unit test connected!')
          }
        },
      })
      .catch(reportRejection)
  })
  return {
    instance: await instancePromise,
    engineCommandManager,
    rustContext,
    sceneInfra: kclManager.sceneInfra,
    kclManager,
    sceneEntitiesManager: kclManager.sceneEntitiesManager,
    commandBarActor,
    settingsActor,
    machineManager,
  }
}

/**
 * Loads the WASM wrapper module. Left sync
 * because some systems in our app await the Promise anyway.
 */
export async function loadWasm() {
  const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  const instancePromise = loadAndInitialiseWasmInstance(WASM_PATH)
  return instancePromise
}

/**
 * "Building the world" in Node consists of only the WASM module.
 *
 * Must use for Node integration tests, because some non-Node systems
 * like `kclManager.editorView` rely on browser window APIs that break in Node
 * testing environments.
 */
export async function buildTheWorldNode() {
  const instance = loadWasm()
  return { instance }
}

// Initialize all the singletons and the WASM blob but do not connect to the engine
export async function buildTheWorldAndNoEngineConnection(mockWasm = false) {
  const instancePromise = mockWasm
    ? Promise.resolve({} as ModuleType)
    : loadWasm()
  const engineCommandManager = new ConnectionManager()
  const machineManager = new MachineManager()
  const commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise: instancePromise,
      machineManager,
    },
  }).start()
  const settingsActor = createActor(settingsMachine, {
    input: {
      commandBarActor,
      ...createSettings(),
      wasmInstancePromise: instancePromise,
    },
  })
  const rustContext = new RustContext(
    engineCommandManager,
    instancePromise,
    settingsActor
  )
  const kclManager = new KclManager({
    engineCommandManager,
    wasmInstancePromise: instancePromise,
    rustContext,
    settings: settingsActor,
    commandBar: commandBarActor,
  })
  engineCommandManager.kclManager = kclManager
  engineCommandManager.sceneInfra = kclManager.sceneInfra
  engineCommandManager.rustContext = rustContext

  settingsActor.start()
  const getSettings = () => getSettingsFromActorContext(settingsActor)
  kclManager.sceneInfra.camControls.getSettings = getSettings
  kclManager.sceneEntitiesManager.getSettings = getSettings

  return {
    instance: await instancePromise,
    engineCommandManager,
    rustContext,
    sceneInfra: kclManager.sceneInfra,
    kclManager,
    sceneEntitiesManager: kclManager.sceneEntitiesManager,
    commandBarActor,
    settingsActor,
    machineManager,
  }
}
