import { EngineCommandManager } from 'lang/std/engineConnection'
import { WebrtcStats } from 'wasm-lib/kcl/bindings/WebrtcStats'
import { OsInfo } from 'wasm-lib/kcl/bindings/OsInfo'
import { isTauri } from 'lib/isTauri'
import {
  platform as tauriPlatform,
  arch as tauriArch,
  version as tauriKernelVersion,
} from '@tauri-apps/plugin-os'
import { APP_VERSION } from 'routes/Settings'

// This is a class for getting all the values from the JS world to pass to the Rust world
// for a core dump.
class CoreDumpManager {
  engineCommandManager: EngineCommandManager

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
  }

  // Get the version of the app from the package.json.
  version(): string {
    return APP_VERSION
  }

  // Get the arch of the app.
  arch(): Promise<string> {
    if (this.isTauri()) {
      return tauriArch()
    }

    // TODO: get more information about the browser.
    return new Promise((resolve, reject) => {
      resolve('browser')
    })
  }

  // Get the platform of the app.
  platform(): Promise<string> {
    if (this.isTauri()) {
      return tauriPlatform()
    }

    // TODO: get more information about the browser.
    return new Promise((resolve, reject) => {
      resolve('browser')
    })
  }

  // Get the kernel version.
  kernelVersion(): Promise<string> {
    if (this.isTauri()) {
      return tauriKernelVersion()
    }

    // TODO: get more information about the browser.
    return new Promise((resolve, reject) => {
      resolve('browser')
    })
  }

  // Get the os information.
  getOsInfo(): Promise<string> {
    return this.arch()
      .catch((error: any) => {
        throw new Error(`Error getting arch: ${error}`)
      })
      .then((arch: string) => {
        return this.platform()
          .catch((error: any) => {
            throw new Error(`Error getting platform: ${error}`)
          })
          .then((platform: string) => {
            return this.kernelVersion()
              .catch((error: any) => {
                throw new Error(`Error getting kernel version: ${error}`)
              })
              .then((kernelVersion: string) => {
                const osinfo: OsInfo = {
                  platform,
                  arch,
                  version: kernelVersion,
                }
                return JSON.stringify(osinfo)
              })
          })
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
