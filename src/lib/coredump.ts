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
import { UAParser } from 'ua-parser-js'
import screenshot from 'lib/screenshot'
import React from 'react'
import { VITE_KC_API_BASE_URL } from 'env'

// This is a class for getting all the values from the JS world to pass to the Rust world
// for a core dump.
export class CoreDumpManager {
  engineCommandManager: EngineCommandManager
  htmlRef: React.RefObject<HTMLDivElement> | null
  token: string | undefined
  baseUrl: string = VITE_KC_API_BASE_URL

  constructor(
    engineCommandManager: EngineCommandManager,
    htmlRef: React.RefObject<HTMLDivElement> | null,
    token: string | undefined
  ) {
    this.engineCommandManager = engineCommandManager
    this.htmlRef = htmlRef
    this.token = token
  }

  // Get the token.
  authToken(): string {
    if (!this.token) {
      throw new Error('Token not set')
    }
    return this.token
  }

  // Get the base url.
  baseApiUrl(): string {
    return this.baseUrl
  }

  // Get the version of the app from the package.json.
  version(): string {
    return APP_VERSION
  }

  // Get the backend pool we've requested.
  pool(): string {
    return this.engineCommandManager.pool || ''
  }

  // Get the os information.
  getOsInfo(): Promise<string> {
    if (this.isTauri()) {
      return tauriArch()
        .catch((error: any) => {
          throw new Error(`Error getting arch: ${error}`)
        })
        .then((arch: string) => {
          return tauriPlatform()
            .catch((error: any) => {
              throw new Error(`Error getting platform: ${error}`)
            })
            .then((platform: string) => {
              return tauriKernelVersion()
                .catch((error: any) => {
                  throw new Error(`Error getting kernel version: ${error}`)
                })
                .then((kernelVersion: string) => {
                  const osinfo: OsInfo = {
                    platform,
                    arch,
                    browser: 'tauri',
                    version: kernelVersion,
                  }
                  return JSON.stringify(osinfo)
                })
            })
        })
    }

    const userAgent = window.navigator.userAgent || 'unknown browser'
    if (userAgent === 'unknown browser') {
      const osinfo: OsInfo = {
        platform: userAgent,
        arch: userAgent,
        version: userAgent,
        browser: userAgent,
      }
      return new Promise((resolve) => resolve(JSON.stringify(osinfo)))
    }

    const parser = new UAParser(userAgent)
    const parserResults = parser.getResult()
    const osinfo: OsInfo = {
      platform: parserResults.os.name || userAgent,
      arch: parserResults.cpu.architecture || userAgent,
      version: parserResults.os.version || userAgent,
      browser: userAgent,
    }
    return new Promise((resolve) => resolve(JSON.stringify(osinfo)))
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
          jitter: stats.rtc_jitter_sec,
        }
        return JSON.stringify(webrtcStats)
      })
  }

  // Return a data URL (png format) of the screenshot of the current page.
  screenshot(): Promise<string> {
    return screenshot(this.htmlRef)
      .then((screenshot: string) => {
        return screenshot
      })
      .catch((error: any) => {
        throw new Error(`Error getting screenshot: ${error}`)
      })
  }
}
