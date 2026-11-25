import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import { getSettingsFromActorContext } from '@src/lib/settings/settingsUtils'
import { signal } from '@preact/signals-core'
import env from '@src/env'
import {
  ARG_ANGLE,
  ARG_END_ABSOLUTE_X,
  ARG_END_ABSOLUTE_Y,
  ARG_LENGTH,
  ARG_LENGTH_X,
  ARG_LENGTH_Y,
} from '@src/lang/constants'
import { createArrayExpression } from '@src/lang/create'
import { KclManager } from '@src/lang/KclManager'
import { findKwArg, findKwArgAny } from '@src/lang/util'
import type { CallExpressionKw, Expr } from '@src/lang/wasm'
import {
  initialiseWasmNode,
  loadAndInitialiseWasmInstance,
} from '@src/lang/wasmUtilsNode'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { MachineManager } from '@src/lib/MachineManager'
import { createTextFileIO } from '@src/lib/projectSession/textFileIO'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import { createRustContext } from '@src/lib/rustContext'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { settingsMachine } from '@src/machines/settingsMachine'
import {
  type UserFeaturesSettleService,
  UserFeaturesState,
} from '@src/machines/userFeaturesMachine'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { join } from 'path'
import { createActor } from 'xstate'

export { createProjectForTest } from '@src/lib/projectTestUtils'

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

/**
 * A user-features service whose fetch has already settled, so gated code
 * (e.g. `KclManager.executeCode`) proceeds immediately in tests.
 */
export function createSettledUserFeaturesForTest(): UserFeaturesSettleService {
  return {
    actor: {
      getSnapshot: () => ({
        matches: (state) => state === UserFeaturesState.Ready,
        context: {
          fetchedAt: new Date(),
        },
      }),
      subscribe: () => ({
        unsubscribe: () => {},
      }),
    },
  }
}

/**
 * Build independent legacy managers and a native context for an integration session.
 * The caller owns dispose(), including when a disconnected session is retired before retrying.
 */
export async function buildTheWorldAndConnectToEngine({
  webrtc = true,
  geometryOnly = false,
  signal: abortSignal,
}: {
  webrtc?: boolean
  geometryOnly?: boolean
  signal?: AbortSignal
} = {}) {
  const instancePromise = initialiseWasmNode()
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
      fileOperations: testFileOperations,
      commandBarActor,
      defaultProjectLibraries: [],
      projectLibrarySettingDefaultPolicies: [],
      extensionSettings: {},
      ...createSettings(),
      wasmInstancePromise: instancePromise,
    },
  })
  const engineCommandManager = new ConnectionManager({
    settingsActor,
  })
  const rustContext = createRustContext(
    instancePromise,
    engineCommandManager,
    settingsActor
  )
  const kclManager = new KclManager('some-file', '', {
    fileOperations: testFileOperations,
    textFileIO: createTextFileIO(testFileOperations, {
      watch: () => {},
      unwatch: () => {},
    }),
    wasmInstancePromise: instancePromise,
    settings: settingsActor,
    kclExecutionSettings: createTestKclExecutionSettings(() =>
      getSettingsFromActorContext(settingsActor)
    ),
    commandBar: commandBarActor,
    engineCommandManager,
    rustContext,
    userFeatures: createSettledUserFeaturesForTest(),
    project: signal(createProjectForTest()),
    projectPath: signal('some-project'),
  })
  const dispose = () => {
    kclManager.close()
    engineCommandManager.tearDown({
      route: 'service-disposed',
      initiatedBy: 'client',
    })
    rustContext.destroy()
    commandBarActor.stop()
    settingsActor.stop()
    machineManager.stop()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        abortSignal?.removeEventListener('abort', aborted)
        engineCommandManager.removeEventListener(
          EngineConnectionManagerEvents.Offline,
          disconnected
        )
      }
      const fail = (error: unknown) => {
        cleanup()
        reject(error)
      }
      const disconnected = () =>
        fail(
          new Error('The test engine connection closed before authentication')
        )
      const aborted = () =>
        fail(new Error('Opening the test engine connection was cancelled'))
      if (abortSignal?.aborted) {
        aborted()
        return
      }
      abortSignal?.addEventListener('abort', aborted, { once: true })
      engineCommandManager.addEventListener(
        EngineConnectionManagerEvents.Offline,
        disconnected
      )
      void engineCommandManager
        .start({
          token: env().VITE_ZOO_API_TOKEN || '',
          width: 256,
          height: 256,
          setStreamIsReady: () => {},
          callbackOnUnitTestingConnection: (message: string) => {
            if (message === 'auth_token_invalid') {
              fail(
                new Error(
                  'auth_token_invalid for the engine. Please set VITE_ZOO_API_TOKEN to the development token.'
                )
              )
            } else if (message === 'auth success') {
              cleanup()
              resolve()
            }
          },
          unitTestWebrtc: webrtc,
          unitTestGeometryOnly: geometryOnly,
          geometryOnly,
          rustContext,
        })
        .catch(fail)
    })
    return {
      instance: await instancePromise,
      engineCommandManager,
      engineSessionId: engineCommandManager.engineSessionId,
      rustContext,
      kclManager,
      commandBarActor,
      settingsActor,
      machineManager,
      dispose,
    }
  } catch (error) {
    dispose()
    return Promise.reject(error)
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
export function createTestWasmRegistryItem(
  wasmPromise: Promise<ModuleType> = loadWasm()
) {
  return [provideWasmPromise(() => wasmPromise)]
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
  return {
    instance,
  }
}

// Initialize all the singletons and the WASM blob but do not connect to the engine
export async function buildTheWorldAndNoEngineConnection(
  mockWasm = false,
  userFeatures: UserFeaturesSettleService = createSettledUserFeaturesForTest()
) {
  const instancePromise = mockWasm
    ? Promise.resolve({} as ModuleType)
    : loadWasm()
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
      fileOperations: testFileOperations,
      commandBarActor,
      defaultProjectLibraries: [],
      projectLibrarySettingDefaultPolicies: [],
      extensionSettings: {},
      ...createSettings(),
      wasmInstancePromise: instancePromise,
    },
  })
  const engineCommandManager = new ConnectionManager({
    settingsActor,
  })
  const rustContext = createRustContext(
    instancePromise,
    engineCommandManager,
    settingsActor
  )
  const kclManager = new KclManager('some-file', '', {
    fileOperations: testFileOperations,
    textFileIO: createTextFileIO(testFileOperations, {
      watch: () => {},
      unwatch: () => {},
    }),
    wasmInstancePromise: instancePromise,
    settings: settingsActor,
    kclExecutionSettings: createTestKclExecutionSettings(() =>
      getSettingsFromActorContext(settingsActor)
    ),
    commandBar: commandBarActor,
    engineCommandManager,
    rustContext,
    userFeatures,
    project: signal(createProjectForTest()),
    projectPath: signal('some-project'),
  })
  settingsActor.start()
  return {
    instance: await instancePromise,
    engineCommandManager: kclManager.engineCommandManager,
    rustContext: kclManager.rustContext,
    sceneInfra: kclManager.sceneInfra,
    kclManager,
    sceneEntitiesManager: kclManager.sceneEntitiesManager,
    commandBarActor,
    settingsActor,
    machineManager,
  }
}
