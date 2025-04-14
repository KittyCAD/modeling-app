import { VITE_KC_API_BASE_URL } from '@src/env'
import { UAParser } from 'ua-parser-js'

import type { OsInfo } from '@rust/kcl-lib/bindings/OsInfo'
import type { WebrtcStats } from '@rust/kcl-lib/bindings/WebrtcStats'

import type CodeManager from '@src/lang/codeManager'
import type {
  CommandLog,
  EngineCommandManager,
} from '@src/lang/std/engineConnection'
import { isDesktop } from '@src/lib/isDesktop'
import type RustContext from '@src/lib/rustContext'
import screenshot from '@src/lib/screenshot'
import { APP_VERSION } from '@src/routes/utils'

/* eslint-disable suggest-no-throw/suggest-no-throw --
 * All the throws in CoreDumpManager are intentional and should be caught and handled properly
 * by the calling Promises with a catch block. The throws are essential to properly handling
 * when the app isn't ready enough or otherwise unable to produce a core dump. By throwing
 * instead of simply erroring, the code halts execution at the first point which it cannot
 * complete the core dump request.
 **/

/**
 * CoreDumpManager module
 * - for getting all the values from the JS world to pass to the Rust world for a core dump.
 * @module lib/coredump
 * @class
 */
// CoreDumpManager is instantiated in ModelingMachineProvider and passed to coreDump() in wasm.ts
// The async function coreDump() handles any errors thrown in its Promise catch method and rethrows
// them to so the toast handler in ModelingMachineProvider can show the user an error message toast
// TODO: Throw more
export class CoreDumpManager {
  engineCommandManager: EngineCommandManager
  codeManager: CodeManager
  rustContext: RustContext
  token: string | undefined
  baseUrl: string = VITE_KC_API_BASE_URL

  constructor(
    engineCommandManager: EngineCommandManager,
    codeManager: CodeManager,
    rustContext: RustContext,
    token: string | undefined
  ) {
    this.engineCommandManager = engineCommandManager
    this.codeManager = codeManager
    this.rustContext = rustContext
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

  kclCode(): string {
    return this.codeManager.code
  }

  // Get the backend pool we've requested.
  pool(): string {
    return this.engineCommandManager.settings.pool || ''
  }

  // Get the os information.
  getOsInfo(): string {
    if (this.isDesktop()) {
      const osinfo: OsInfo = {
        platform: window.electron.platform ?? null,
        arch: window.electron.arch ?? null,
        browser: 'desktop',
        version: window.electron.version ?? null,
      }
      return JSON.stringify(osinfo)
    }

    const userAgent = window.navigator.userAgent || 'unknown browser'
    if (userAgent === 'unknown browser') {
      const osinfo: OsInfo = {
        platform: userAgent,
        arch: userAgent,
        version: userAgent,
        browser: userAgent,
      }
      return JSON.stringify(osinfo)
    }

    const parser = new UAParser(userAgent)
    const parserResults = parser.getResult()
    const osinfo: OsInfo = {
      platform: parserResults.os.name || userAgent,
      arch: parserResults.cpu.architecture || userAgent,
      version: parserResults.os.version || userAgent,
      browser: userAgent,
    }
    return JSON.stringify(osinfo)
  }

  isDesktop(): boolean {
    return isDesktop()
  }

  getWebrtcStats(): Promise<string> {
    if (!this.engineCommandManager.engineConnection) {
      // when the engine connection is not available, return an empty object.
      return Promise.resolve(JSON.stringify({}))
    }

    if (!this.engineCommandManager.engineConnection.webrtcStatsCollector) {
      // when the engine connection is not available, return an empty object.
      return Promise.resolve(JSON.stringify({}))
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

  // Currently just a placeholder to begin loading singleton and xstate data into
  getClientState(): Promise<string> {
    /**
     * Check if a function is private method
     */
    const isPrivateMethod = (key: string) => {
      return key.length && key[0] === '_'
    }

    // Turn off verbose logging by default
    const verboseLogging = false

    /**
     * Toggle verbose debug logging of step-by-step client state coredump data
     */
    const debugLog = verboseLogging ? console.log : () => {}

    console.warn('CoreDump: Gathering client state')

    // Initialize the clientState object
    let clientState = {
      // singletons
      engine_command_manager: {
        artifact_map: {},
        command_logs: [] as CommandLog[],
        engine_connection: { state: { type: '' } },
        default_planes: {},
        scene_command_artifacts: {},
      },
      kcl_manager: {
        ast: {},
        kcl_errors: [],
      },
      scene_infra: {},
      scene_entities_manager: {},
      editor_manager: {},
      // xstate
      auth_machine: {},
      command_bar_machine: {},
      file_machine: {},
      home_machine: {},
      modeling_machine: {},
      settings_machine: {},
    }
    debugLog('CoreDump: initialized clientState', clientState)
    debugLog('CoreDump: globalThis.window', globalThis.window)

    try {
      // Singletons

      // engine_command_manager
      debugLog('CoreDump: engineCommandManager', this.engineCommandManager)

      // command logs - this.engineCommandManager.commandLogs
      if (this.engineCommandManager?.commandLogs) {
        debugLog(
          'CoreDump: Engine Command Manager command logs',
          this.engineCommandManager.commandLogs
        )
        clientState.engine_command_manager.command_logs = structuredClone(
          this.engineCommandManager.commandLogs
        )
      }

      // default planes - this.rustContext.defaultPlanes
      if (this.rustContext.defaultPlanes) {
        debugLog(
          'CoreDump: Engine Command Manager default planes',
          this.rustContext.defaultPlanes
        )
        clientState.engine_command_manager.default_planes = structuredClone(
          this.rustContext.defaultPlanes
        )
      }

      // engine connection state
      if (this.engineCommandManager?.engineConnection?.state) {
        debugLog(
          'CoreDump: Engine Command Manager engine connection state',
          this.engineCommandManager.engineConnection.state
        )
        clientState.engine_command_manager.engine_connection.state =
          this.engineCommandManager.engineConnection.state
      }

      // in sequence - this.engineCommandManager.inSequence
      if (this.engineCommandManager?.inSequence) {
        debugLog(
          'CoreDump: Engine Command Manager in sequence',
          this.engineCommandManager.inSequence
        )
        ;(clientState.engine_command_manager as any).in_sequence =
          this.engineCommandManager.inSequence
      }

      // out sequence - this.engineCommandManager.outSequence
      if (this.engineCommandManager?.outSequence) {
        debugLog(
          'CoreDump: Engine Command Manager out sequence',
          this.engineCommandManager.outSequence
        )
        ;(clientState.engine_command_manager as any).out_sequence =
          this.engineCommandManager.outSequence
      }

      // KCL Manager - globalThis?.window?.kclManager
      const kclManager = (globalThis?.window as any)?.kclManager
      debugLog('CoreDump: kclManager', kclManager)

      if (kclManager) {
        // KCL Manager AST
        debugLog('CoreDump: KCL Manager AST', kclManager?.ast)
        if (kclManager?.ast) {
          clientState.kcl_manager.ast = structuredClone(kclManager.ast)
        }

        // artifact map - this.kclManager.artifactGraph
        debugLog(
          'CoreDump: KCL Manager artifact map',
          kclManager?.artifactGraph
        )
        if (kclManager.artifactGraph) {
          debugLog(
            'CoreDump: Engine Command Manager artifact map',
            kclManager.artifactGraph
          )
          clientState.engine_command_manager.artifact_map = structuredClone(
            kclManager.artifactGraph
          )
        }

        // KCL Errors
        debugLog('CoreDump: KCL Errors', kclManager?.kclErrors)
        if (kclManager?.kclErrors) {
          clientState.kcl_manager.kcl_errors = structuredClone(
            kclManager.kclErrors
          )
        }

        // KCL isExecuting
        debugLog('CoreDump: KCL isExecuting', kclManager?.isExecuting)
        if (kclManager?.isExecuting) {
          ;(clientState.kcl_manager as any).isExecuting = kclManager.isExecuting
        }

        // KCL logs
        debugLog('CoreDump: KCL logs', kclManager?.logs)
        if (kclManager?.logs) {
          ;(clientState.kcl_manager as any).logs = structuredClone(
            kclManager.logs
          )
        }

        // KCL programMemory
        debugLog('CoreDump: KCL programMemory', kclManager?.programMemory)
        if (kclManager?.programMemory) {
          ;(clientState.kcl_manager as any).programMemory = structuredClone(
            kclManager.programMemory
          )
        }

        // KCL wasmInitFailed
        debugLog('CoreDump: KCL wasmInitFailed', kclManager?.wasmInitFailed)
        if (kclManager?.wasmInitFailed) {
          ;(clientState.kcl_manager as any).wasmInitFailed =
            kclManager.wasmInitFailed
        }
      }

      // Scene Infra - globalThis?.window?.sceneInfra
      const sceneInfra = (globalThis?.window as any)?.sceneInfra
      debugLog('CoreDump: Scene Infra', sceneInfra)

      if (sceneInfra) {
        const sceneInfraSkipKeys = ['camControls']
        const sceneInfraKeys = Object.keys(sceneInfra)
          .sort()
          .filter((entry) => {
            return (
              typeof sceneInfra[entry] !== 'function' &&
              !sceneInfraSkipKeys.includes(entry)
            )
          })

        debugLog('CoreDump: Scene Infra keys', sceneInfraKeys)
        sceneInfraKeys.forEach((key: string) => {
          debugLog('CoreDump: Scene Infra', key, sceneInfra[key])
          try {
            ;(clientState.scene_infra as any)[key] = sceneInfra[key]
          } catch (error) {
            console.error(
              'CoreDump: unable to parse Scene Infra ' + key + ' data due to ',
              error
            )
          }
        })
      }

      // Scene Entities Manager - globalThis?.window?.sceneEntitiesManager
      const sceneEntitiesManager = (globalThis?.window as any)
        ?.sceneEntitiesManager
      debugLog('CoreDump: sceneEntitiesManager', sceneEntitiesManager)

      if (sceneEntitiesManager) {
        // Scene Entities Manager active segments
        debugLog(
          'CoreDump: Scene Entities Manager active segments',
          sceneEntitiesManager?.activeSegments
        )
        if (sceneEntitiesManager?.activeSegments) {
          // You can't structuredClone a THREE.js Group, so let's just get the userData.
          ;(clientState.scene_entities_manager as any).activeSegments =
            Object.entries(sceneEntitiesManager.activeSegments).map(
              ([id, segmentGroup]) => ({
                segmentId: id,
                userData:
                  segmentGroup &&
                  typeof segmentGroup === 'object' &&
                  'userData' in segmentGroup
                    ? segmentGroup.userData
                    : null,
              })
            )
        }
      }

      // Editor Manager - globalThis?.window?.editorManager
      const editorManager = (globalThis?.window as any)?.editorManager
      debugLog('CoreDump: editorManager', editorManager)

      if (editorManager) {
        const editorManagerSkipKeys = ['camControls']
        const editorManagerKeys = Object.keys(editorManager)
          .sort()
          .filter((entry) => {
            return (
              typeof editorManager[entry] !== 'function' &&
              !isPrivateMethod(entry) &&
              !editorManagerSkipKeys.includes(entry)
            )
          })

        debugLog('CoreDump: Editor Manager keys', editorManagerKeys)
        editorManagerKeys.forEach((key: string) => {
          debugLog('CoreDump: Editor Manager', key, editorManager[key])
          try {
            ;(clientState.editor_manager as any)[key] = structuredClone(
              editorManager[key]
            )
          } catch (error) {
            console.error(
              'CoreDump: unable to parse Editor Manager ' +
                key +
                ' data due to ',
              error
            )
          }
        })
      }

      // enableMousePositionLogs - Not coredumped
      // See https://github.com/KittyCAD/modeling-app/issues/2338#issuecomment-2136441998
      debugLog(
        'CoreDump: enableMousePositionLogs [not coredumped]',
        (globalThis?.window as any)?.enableMousePositionLogs
      )

      // XState Machines
      debugLog(
        'CoreDump: xstate services',
        (globalThis?.window as any)?.__xstate__?.services
      )

      debugLog('CoreDump: final clientState', clientState)

      const clientStateJson = JSON.stringify(clientState)
      debugLog('CoreDump: final clientState JSON', clientStateJson)

      return Promise.resolve(clientStateJson)
    } catch (error) {
      console.error('CoreDump: unable to return data due to ', error)
      return Promise.reject(JSON.stringify(error))
    }
  }

  // Return a data URL (png format) of the screenshot of the current page.
  screenshot(): Promise<string> {
    return (
      screenshot()
        .then((screenshotStr: string) => screenshotStr)
        // maybe rust should handle an error, but an empty string at least doesn't cause the core dump to fail entirely
        .catch((error: any) => ``)
    )
  }
}
