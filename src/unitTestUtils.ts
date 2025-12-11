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
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { KclManager } from '@src/lang/KclManager'
import { reportRejection } from '@src/lib/trap'
import env from '@src/env'
import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { createActor } from 'xstate'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

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
  const rustContext = new RustContext(engineCommandManager, instancePromise)
  const sceneInfra = new SceneInfra(engineCommandManager)
  const kclManager = new KclManager(engineCommandManager, instancePromise, {
    rustContext,
    sceneInfra,
  })
  engineCommandManager.kclManager = kclManager
  engineCommandManager.sceneInfra = sceneInfra
  engineCommandManager.rustContext = rustContext

  const commandBarActor = createActor(commandBarMachine, {
    input: { commands: [], kclManager },
  }).start()

  const sceneEntitiesManager = new SceneEntities(
    engineCommandManager,
    sceneInfra,
    kclManager,
    rustContext,
    await instancePromise
  )
  sceneEntitiesManager.commandBarActor = commandBarActor
  kclManager.sceneEntitiesManager = sceneEntitiesManager

  await new Promise((resolve) => {
    engineCommandManager
      .start({
        token: env().VITE_ZOO_API_TOKEN || '',
        width: 256,
        height: 256,
        setStreamIsReady: () => {
          console.log('no op for a unit test')
        },
        callbackOnUnitTestingConnection: () => {
          resolve(true)
          console.log('unit test connected!')
        },
      })
      .catch(reportRejection)
  })
  return {
    instance: await instancePromise,
    engineCommandManager,
    rustContext,
    sceneInfra,
    kclManager,
    sceneEntitiesManager,
    commandBarActor,
  }
}

// Initialize all the singletons and the WASM blob but do not connect to the engine
export async function buildTheWorldAndNoEngineConnection(mockWasm = false) {
  async function loadWasm() {
    const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    const instancePromise = loadAndInitialiseWasmInstance(WASM_PATH)
    return instancePromise
  }
  const instancePromise = mockWasm
    ? Promise.resolve({} as ModuleType)
    : loadWasm()
  const engineCommandManager = new ConnectionManager()
  const rustContext = new RustContext(engineCommandManager, instancePromise)
  const sceneInfra = new SceneInfra(engineCommandManager)

  const kclManager = new KclManager(engineCommandManager, instancePromise, {
    rustContext,
    sceneInfra,
  })
  engineCommandManager.kclManager = kclManager
  engineCommandManager.sceneInfra = sceneInfra
  engineCommandManager.rustContext = rustContext
  const sceneEntitiesManager = new SceneEntities(
    engineCommandManager,
    sceneInfra,
    kclManager,
    rustContext
  )
  kclManager.sceneEntitiesManager = sceneEntitiesManager
  return {
    instance: await instancePromise,
    engineCommandManager,
    rustContext,
    sceneInfra,
    kclManager,
    sceneEntitiesManager,
  }
}
