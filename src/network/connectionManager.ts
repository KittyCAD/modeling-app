import { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { Connection } from './connection'
import {
  darkModeMatcher,
  getOppositeTheme,
  getThemeColorForEngine,
  Themes,
} from '@src/lib/theme'
import { withWebSocketURL } from '@src/lib/withBaseURL'
import { EngineCommandManagerEvents, EngineConnectionEvents } from './utils'
import {
  createOnDarkThemeMediaQueryChange,
  createOnEngineConnectionOpened,
  createOnEngineConnectionRestartRequest,
  createOnEngineOffline,
} from './connectionManagerEvents'
import type RustContext from '@src/lib/rustContext'
import { uuidv4 } from '@src/lib/utils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import CodeManager from '@src/lang/codeManager'

export class ConnectionManager extends EventTarget {
  started: boolean
  _camControlsCameraChange = () => {}

  connection: Connection | undefined
  sceneInfra: SceneInfra | undefined
  codeManager: CodeManager | undefined

  // Circular dependency that is why it can be undefined
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

  set camControlsCameraChange(cb: () => void) {
    this._camControlsCameraChange = cb
  }

  // I guess this in the entry point
  // Don't initialize a different set of default settings, what is the point!
  async start({
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

    // Make sure dependencies exist during runtime otherwise crash!
    if (!this.rustContext) {
      throw new Error('rustContext is undefined')
    }
    1
    if (!this.sceneInfra) {
      throw new Error('sceneInfra is undefined')
    }

    if (settings) {
      this.settings = settings
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

    const onEngineConnectionOpened = createOnEngineConnectionOpened({
      rustContext: this.rustContext,
      settings: this.settings,
      jsAppSettings: await jsAppSettings(),
      path: this.codeManager?.currentFilePath || '',
      sendSceneCommand: this.sendSceneCommand.bind(this),
      setTheme: this.setTheme.bind(this),
      listenToDarkModeMatcher: this.listenToDarkModeMatcher.bind(this),
      // Don't think this needs the bind because it is an external set function for the callback
      camControlsCameraChange: this._camControlsCameraChange,
      sceneInfra: this.sceneInfra,
      connection: this.connection,
    })

    this.connection.addEventListener(
      EngineConnectionEvents.RestartRequest,
      onEngineConnetionRestartRequest
    )
    this.connection.addEventListener(
      EngineConnectionEvents.Offline,
      onEngineOffline
    )
    this.connection.addEventListener(
      EngineConnectionEvents.Opened,
      onEngineConnectionOpened
    )

    // TODO: There are N listeners above that would need to be removed if this class is destroyed or restarted.
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

  // Set the engine's theme
  async setTheme(theme: Themes) {
    // Set the stream background color
    // This takes RGBA values from 0-1
    // So we convert from the conventional 0-255 found in Figma
    await this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_background_color',
        color: getThemeColorForEngine(theme),
      },
    })

    // Sets the default line colors
    const opposingTheme = getOppositeTheme(theme)
    await this.sendSceneCommand({
      cmd_id: uuidv4(),
      type: 'modeling_cmd_req',
      cmd: {
        type: 'set_default_system_properties',
        color: getThemeColorForEngine(opposingTheme),
      },
    })
  }

  listenToDarkModeMatcher() {
    // TODO: Keep track of event listener
    const onDarkThemeMediaQueryChange = createOnDarkThemeMediaQueryChange({
      setTheme: this.setTheme.bind(this),
    })
    darkModeMatcher?.addEventListener('change', onDarkThemeMediaQueryChange)
  }

  sendSceneCommand() {}
}
