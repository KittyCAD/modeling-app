import { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { Connection } from './connection'
import { Themes } from '@src/lib/theme'
import { withWebSocketURL } from '@src/lib/withBaseURL'
import { EngineCommandManagerEvents, EngineConnectionEvents } from './utils'
import {
  createOnEngineConnectionRestartRequest,
  createOnEngineOffline,
} from './connectionManagerEvents'
import type RustContext from '@src/lib/rustContext'

export class ConnectionManager extends EventTarget {
  started: boolean

  connection: Connection | undefined
  rustContext: RustContext | undefined

  streamDimensions = {
    // startFromWasm uses 256, 256
    width: 256,
    height: 256,
  }
  settings: SettingsViaQueryString = {
    pool: null,
    theme: Themes.Dark,
    highlightEdges: true,
    enableSSAO: true,
    showScaleGrid: false,
    cameraProjection: 'orthographic', // Gotcha: was perspective now is orthographic
    cameraOrbit: 'spherical',
  }

  constructor(settings?: SettingsViaQueryString) {
    super()
    this.started = false

    if (settings) {
      // completely overwrite the settings
      this.settings = settings
    }
  }

  // I guess this in the entry point
  // Don't initialize a different set of default settings, what is the point!
  start({
    settings,
    width,
    height,
    token,
  }: {
    settings?: SettingsViaQueryString
    width: number
    height: number
    token: string
  }) {
    if (this.started) {
      throw new Error(
        'You tried to start the engine again, why are you starting it?'
      )
    }
    this.started = true

    if (this.connection) {
      throw new Error(
        'You tried to make a new connection. You already have one!'
      )
    }

    if (width <= 0) {
      throw new Error(`width is <=0, ${width}`)
    }

    if (height <= 0) {
      throw new Error(`height is <=0, ${height}`)
    }

    this.streamDimensions = {
      width,
      height,
    }

    // Gotcha: do not proxy handleResize!
    // TODO: this.handleResize(this.streamDimensions); return;

    const url = this.generateWebsocketURL()
    this.connection = new Connection({
      connectionManager: this,
      url,
      token,
    })
    // Start listening!
    this.connection.connect()

    // TODO:
    // Nothing more to do when using a lite engine initialization
    // if (callbackOnEngineLiteConnect) return

    this.dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineAvailable, {
        detail: this.connection,
      })
    )

    const onEngineConnetionRestartRequest =
      createOnEngineConnectionRestartRequest({
        dispatchEvent: this.dispatchEvent.bind(this),
      })
    const onEngineOffline = createOnEngineOffline({
      dispatchEvent: this.dispatchEvent.bind(this),
    })

    this.connection.addEventListener(
      EngineConnectionEvents.RestartRequest,
      onEngineConnetionRestartRequest
    )
    this.connection.addEventListener(
      EngineConnectionEvents.Offline,
      onEngineOffline
    )

    // TODO: There are 2 listeners above that would need to be removed if this class is destroyed or restarted.
  }

  generateWebsocketURL() {
    let additionalSettings = this.settings.enableSSAO ? '&post_effect=ssao' : ''
    additionalSettings +=
      '&show_grid=' + (this.settings.showScaleGrid ? 'true' : 'false')
    const pool = !this.settings.pool ? '' : `&pool=${this.settings.pool}`
    const url = withWebSocketURL(
      `?video_res_width=${this.streamDimensions.width}&video_res_height=${this.streamDimensions.height}${additionalSettings}${pool}`
    )
    return url
  }
}
