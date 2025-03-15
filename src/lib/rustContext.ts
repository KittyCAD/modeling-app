import { EngineCommandManager } from 'lang/std/engineConnection'
import { initPromise } from 'lang/wasm'
import { getModule } from './wasm_lib_wrapper'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { DeepPartial } from './types'
import { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import { Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'

class RustContext {
  wasmLoaded: boolean
  rustInstance: any
  ctxInstance: Context | null

  constructor() {
    this.wasmLoaded = false
    this.rustInstance = null
    this.ctxInstance = null
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

  // Create a new calculator instance
  create(engineCommandManager: EngineCommandManager) {
    if (!this.wasmLoaded) {
      throw new Error('WASM module not loaded. Call init() first.')
    }

    // Create a new Calculator instance from Rust
    this.rustInstance = getModule()
    this.ctxInstance = this.rustInstance.Context(
      engineCommandManager,
      fileSystemManager
    )
    return this
  }

  // Execute a program.
  execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ) {
    this._checkInstance()

    if (this.ctxInstance) {
      return this.ctxInstance.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
    }
  }

  // Helper to check if context instance exists
  _checkInstance() {
    if (!this.ctxInstance) {
      throw new Error('Context instance not created. Call create() first.')
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
