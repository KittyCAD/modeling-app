import {
  emptyExecState,
  errFromErrWithOutputs,
  ExecState,
  execStateFromRust,
  initPromise,
} from 'lang/wasm'
import { getModule, ModuleType } from 'lib/wasm_lib_wrapper'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { DeepPartial } from 'lib/types'
import { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import { DefaultPlaneStr, defaultPlaneStrToKey } from 'lib/planes'
import { err } from 'lib/trap'
import { EngineCommandManager } from 'lang/std/engineConnection'

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
    } catch (e) {
      this.wasmInitFailed = true
    }
  }

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.ensureWasmInit().then(async () => {
      await this.create()
    })
  }

  // Create a new context instance
  async create() {
    this.rustInstance = getModule()
    this.ctxInstance = await new this.rustInstance.Context(
      this.engineCommandManager,
      fileSystemManager
    )
  }

  // Execute a program.
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    await this._checkInstance()

    if (this.ctxInstance) {
      try {
        const result = await this.ctxInstance.execute(
          JSON.stringify(node),
          path,
          JSON.stringify(settings)
        )
        /* Set the default planes, safe to call after execute. */
        this._defaultPlanes = await this.getDefaultPlanes()
        return execStateFromRust(result, node)
      } catch (e: any) {
        const err = errFromErrWithOutputs(e)
        this._defaultPlanes = err.defaultPlanes
        return Promise.reject(err)
      }
    }

    // You will never get here.
    return Promise.reject(emptyExecState())
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  // Get the default planes.
  // We make this private so YOU CANNOT HAVE A RACE CONDITION.
  // We control when we get the default planes.
  private async getDefaultPlanes() {
    await this._checkInstance()

    if (this.ctxInstance) {
      return this.ctxInstance.getDefaultPlanes()
    }
  }

  // Clear the scene and bust the cache.
  async clearSceneAndBustCache() {
    await this._checkInstance()

    if (this.ctxInstance) {
      await this.ctxInstance.clearSceneAndBustCache()
      /* Set the default planes, safe to call after bust cache. */
      this._defaultPlanes = await this.getDefaultPlanes()
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
  private async _checkInstance() {
    if (!this.ctxInstance) {
      // Create the context instance.
      await this.create()
    }
  }

  // Clean up resources
  destroy() {
    if (this.ctxInstance) {
      // In a real implementation, you might need to manually free resources
      this.ctxInstance = null
    }
  }
}
