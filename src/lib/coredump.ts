import { EngineCommandManager } from 'lang/std/engineConnection'
import { WebrtcStats } from 'wasm-lib/kcl/bindings/WebrtcStats'
import { isTauri } from 'lib/isTauri'

// This is a class for getting all the values from the JS world to pass to the Rust world
// for a core dump.
class CoreDumpManager {
  engineCommandManager: EngineCommandManager

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
  }

  // Get the version of the app from the package.json.
  version(): string {
    return process.env.npm_package_version || 'unknown'
  }

  isTauri(): boolean {
    return isTauri()
  }

  getWebrtcStats(): Promise<WebrtcStats | null> {
    return new Promise((resolve, reject) => {
      resolve(null)
    })
  }
}
