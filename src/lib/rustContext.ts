import { EngineCommandManager } from 'lang/std/engineConnection'
import { initPromise } from 'lang/wasm'
import { getModule } from './wasm_lib_wrapper'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { DeepPartial } from './types'
import { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import { DefaultPlaneStr, defaultPlaneStrToKey } from './planes'
import { err } from './trap'

export default class RustContext {
  private wasmLoaded: boolean
  private rustInstance: any
  private ctxInstance: Context | null
  private _defaultPlanes: DefaultPlanes | null

  constructor() {
    this.wasmLoaded = false
    this.rustInstance = null
    this.ctxInstance = null
    this._defaultPlanes = null
  }

  // Initialize the WASM module
  async init() {
    if (this.wasmLoaded) return Promise.resolve()

    try {
      await initPromise

      this.wasmLoaded = true

      console.log('Rust WASM module loaded successfully')
      return Promise.resolve()
    } catch (error) {
      console.error('Failed to load Rust WASM module:', error)
      return Promise.reject(error)
    }
  }

  // Create a new context instance
  async create(engineCommandManager: EngineCommandManager) {
    if (!this.wasmLoaded) {
      await this.init()
    }

    // Create a new Calculator instance from Rust
    this.rustInstance = getModule()
    this.ctxInstance = await new this.rustInstance.Context(
      engineCommandManager,
      fileSystemManager
    )
  }

  // Execute a program.
  async execute(
    engineCommandManager: EngineCommandManager,
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ) {
    await this._checkInstance(engineCommandManager)

    if (this.ctxInstance) {
      const result = await this.ctxInstance.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
      /* Set the default planes, safe to call after execute. */
      this._defaultPlanes = await this.getDefaultPlanes(engineCommandManager)

      return result
    }
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  // Get the default planes.
  // We make this private so YOU CANNOT HAVE A RACE CONDITION.
  // We control when we get the default planes.
  private async getDefaultPlanes(engineCommandManager: EngineCommandManager) {
    await this._checkInstance(engineCommandManager)

    if (this.ctxInstance) {
      return this.ctxInstance.getDefaultPlanes()
    }
  }

  // Clear the scene and bust the cache.
  async clearSceneAndBustCache(engineCommandManager: EngineCommandManager) {
    await this._checkInstance(engineCommandManager)

    if (this.ctxInstance) {
      await this.ctxInstance.clearSceneAndBustCache()
      /* Set the default planes, safe to call after bust cache. */
      this._defaultPlanes = await this.getDefaultPlanes(engineCommandManager)
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
  private async _checkInstance(engineCommandManager: EngineCommandManager) {
    if (!this.ctxInstance) {
      // Create the context instance.
      await this.create(engineCommandManager)
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
