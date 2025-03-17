import {
  emptyExecState,
  errFromErrWithOutputs,
  ExecState,
  execStateFromRust,
  initPromise,
  mockExecStateFromRust,
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

    // You will never get here.
    return Promise.reject(emptyExecState())
  }

  // Execute a program with in mock mode.
  async executeMock(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    usePrevMemory?: boolean
  ): Promise<ExecState> {
    await this._checkInstance()

    if (this.ctxInstance) {
      try {
        if (usePrevMemory === undefined) {
          usePrevMemory = true
        }

        const result = await this.ctxInstance.executeMock(
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

    // You will never get here.
    return Promise.reject(emptyExecState())
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  // Clear the scene and bust the cache.
  async clearSceneAndBustCache(
    settings: DeepPartial<Configuration>,
    path?: string
  ) {
    // Send through and empty ast to clear the scene.
    // This will also bust the cache and reset the default planes.
    // We do it like this so it works better with adding stuff later and the
    // cache.
    // It also works better with the id generator.
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
    }

    await this.execute(ast, settings, path)
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
