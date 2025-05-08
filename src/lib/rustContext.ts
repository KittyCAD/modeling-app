import toast from 'react-hot-toast'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { BSON } from 'bson'

import type { Models } from '@kittycad/lib/dist/types/src'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import { fileSystemManager } from '@src/lang/std/fileSystemManager'
import type { ExecState } from '@src/lang/wasm'
import {
  errFromErrWithOutputs,
  execStateFromRust,
  mockExecStateFromRust,
} from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { defaultPlaneStrToKey } from '@src/lib/planes'
import { err, reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getModule } from '@src/lib/wasm_lib_wrapper'

export default class RustContext {
  private wasmInitFailed: boolean = true
  private rustInstance: ModuleType | null = null
  private ctxInstance: Context | null = null
  private _defaultPlanes: DefaultPlanes | null = null
  private engineCommandManager: EngineCommandManager

  // Initialize the WASM module
  async ensureWasmInit() {
    try {
      await initPromise
      if (this.wasmInitFailed) {
        this.wasmInitFailed = false
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      this.wasmInitFailed = true
    }
  }

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager

    this.ensureWasmInit()
      .then(async () => {
        this.ctxInstance = await this.create()
      })
      .catch(reportRejection)
  }

  // Create a new context instance
  async create(): Promise<Context> {
    this.rustInstance = getModule()

    // We need this await here, DO NOT REMOVE it even if your editor says it's
    // unnecessary. The constructor of the module is async and it will not
    // resolve if you don't await it.
    const ctxInstance = await new this.rustInstance.Context(
      this.engineCommandManager,
      fileSystemManager
    )

    return ctxInstance
  }

  // Execute a program.
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = await this._checkInstance()

    try {
      const result = await instance.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
      /* Set the default planes, safe to call after execute. */
      const outcome = execStateFromRust(result)

      this._defaultPlanes = outcome.defaultPlanes

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this._defaultPlanes = err.defaultPlanes
      return Promise.reject(err)
    }
  }

  // Execute a program with in mock mode.
  async executeMock(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    usePrevMemory?: boolean
  ): Promise<ExecState> {
    const instance = await this._checkInstance()

    if (usePrevMemory === undefined) {
      usePrevMemory = true
    }

    try {
      const result = await instance.executeMock(
        JSON.stringify(node),
        path,
        JSON.stringify(settings),
        usePrevMemory
      )
      return mockExecStateFromRust(result)
    } catch (e: any) {
      return Promise.reject(errFromErrWithOutputs(e))
    }
  }

  // Export a scene to a file.
  async export(
    format: DeepPartial<OutputFormat3d>,
    settings: DeepPartial<Configuration>,
    toastId: string
  ): Promise<ModelingAppFile[] | undefined> {
    const instance = await this._checkInstance()

    try {
      return await instance.export(
        JSON.stringify(format),
        JSON.stringify(settings)
      )
    } catch (e: any) {
      const parsed: RustKclError = JSON.parse(e.toString())
      toast.error(parsed.msg, { id: toastId })
      return
    }
  }

  async waitForAllEngineCommands() {
    await this.engineCommandManager.waitForAllCommands()
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  // Clear/reset the scene and bust the cache.
  // Do not use this function unless you absolutely need to. In most cases,
  // we should just fix the  cache for whatever bug you are seeing.
  // The only time it makes sense to run this is if the engine disconnects and
  // reconnects. The rust side has no idea that happened and will think the
  // cache is still valid.
  // Caching on the rust side accounts for changes to files outside of the
  // scope of the current file the user is on. It collects all the dependencies
  // and checks if any of them have changed. If they have, it will bust the
  // cache and recompile the scene.
  async clearSceneAndBustCache(
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = await this._checkInstance()

    try {
      const result = await instance.bustCacheAndResetScene(
        JSON.stringify(settings),
        path
      )
      /* Set the default planes, safe to call after execute. */
      const outcome = execStateFromRust(result)

      this._defaultPlanes = outcome.defaultPlanes

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this._defaultPlanes = err.defaultPlanes
      return Promise.reject(err)
    }
  }

  getDefaultPlaneId(name: DefaultPlaneStr): string | Error {
    const key = defaultPlaneStrToKey(name)
    if (!this.defaultPlanes) {
      return new Error('Default planes not initialized')
    } else if (err(key)) {
      return key
    }
    return this.defaultPlanes[key]
  }

  // Send a response back to the rust side, that we got back from the engine.
  async sendResponse(
    response: Models['WebSocketResponse_type']
  ): Promise<void> {
    const instance = await this._checkInstance()

    try {
      const serialized = BSON.serialize(response)
      await instance.sendResponse(serialized)
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  // Helper to check if context instance exists
  private async _checkInstance(): Promise<Context> {
    if (!this.ctxInstance) {
      // Create the context instance.
      this.ctxInstance = await this.create()
    }

    return this.ctxInstance
  }

  // Clean up resources
  destroy() {
    if (this.ctxInstance) {
      // In a real implementation, you might need to manually free resources
      this.ctxInstance = null
    }
  }
}
