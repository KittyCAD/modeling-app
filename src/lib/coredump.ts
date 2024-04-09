import { EngineCommandManager } from 'lang/std/engineConnection'
import { WebrtcStats } from 'wasm-lib/kcl/bindings/WebrtcStats'
import { isTauri } from 'lib/isTauri'
import { platform as tauriPlatform } from '@tauri-apps/plugin-os'

// This is a class for getting all the values from the JS world to pass to the Rust world
// for a core dump.
class CoreDumpManager {
  engineCommandManager: EngineCommandManager

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
  }

  // Get the version of the app from the package.json.
  version(): string {
    // TODO: fix me
    return '0.0.1'
  }

  // Get the platform of the app.
  platform(): Promise<string> {
    if (this.isTauri()) {
      return tauriPlatform()
        .catch((error) => {
          throw new Error(`Error getting platform: ${error}`)
        })
        .then((platform) => {
          return platform
        })
    }

    return new Promise((resolve, reject) => {
      // Get the browser information.
      // TODO: get more information about the browser.
      return 'browser'
    })
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
