import toast from 'react-hot-toast'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import { fileSystemManager } from '@src/lang/std/fileSystemManager'
import type { ExecState } from '@src/lang/wasm'
import {
  errFromErrWithOutputs,
  execStateFromRust,
  initPromise,
  mockExecStateFromRust,
} from '@src/lang/wasm'
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
      const outcome = execStateFromRust(result, node)

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
  async clearSceneAndBustCache(
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = await this._checkInstance()

    const ast: Node<Program> = {
      body: [],
      shebang: null,
      start: 0,
      end: 0,
      moduleId: 0,
      nonCodeMeta: {
        nonCodeNodes: {},
        startNodes: [],
      },
      innerAttrs: [],
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
    }

    try {
      const result = await instance.bustCacheAndResetScene(
        JSON.stringify(settings),
        path
      )
      /* Set the default planes, safe to call after execute. */
      const outcome = execStateFromRust(result, ast)

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
