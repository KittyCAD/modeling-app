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

  getWebrtcStats(): Promise<string> {
    if (!this.engineCommandManager.engineConnection) {
      throw new Error('Engine connection not initialized')
    }

    if (!this.engineCommandManager.engineConnection.webrtcStatsCollector) {
      throw new Error('Engine webrtcStatsCollector not initialized')
    }

    return this.engineCommandManager.engineConnection
      .webrtcStatsCollector()
      .catch((error: any) => {
        throw new Error(`Error getting webrtc stats: ${error}`)
      })
      .then((stats: any) => {
        const webrtcStats: WebrtcStats = {
          packets_lost: stats.rtc_packets_lost,
          frames_received: stats.rtc_frames_received,
          frame_width: stats.rtc_frame_width,
          frame_height: stats.rtc_frame_height,
          frame_rate: stats.rtc_frames_per_second,
          key_frames_decoded: stats.rtc_keyframes_decoded,
          frames_dropped: stats.rtc_frames_dropped,
          pause_count: stats.rtc_pause_count,
          total_pauses_duration: stats.rtc_total_pauses_duration_sec,
          freeze_count: stats.rtc_freeze_count,
          total_freezes_duration: stats.rtc_total_freezes_duration_sec,
          pli_count: stats.rtc_pli_count,
        }
        return JSON.stringify(webrtcStats)
      })
  }
}
