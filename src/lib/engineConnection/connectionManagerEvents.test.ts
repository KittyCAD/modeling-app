import { describe, expect, it, vi } from 'vitest'

import { Themes } from '@src/lib/theme'
import { Connection } from '@src/lib/engineConnection/connection'
import {
  createOnDarkThemeMediaQueryChange,
  createOnEngineConnectionOpened,
} from '@src/lib/engineConnection/connectionManagerEvents'

describe('createOnDarkThemeMediaQueryChange', () => {
  it('ignores system color changes when the app theme is fixed', () => {
    const setTheme = vi
      .fn<(theme: Themes) => Promise<void>>()
      .mockResolvedValue(undefined)

    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.Light,
      setTheme,
    })()
    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.Dark,
      setTheme,
    })()

    expect(setTheme).not.toHaveBeenCalled()
  })

  it('refreshes the engine theme when the app theme follows the system', () => {
    const setTheme = vi
      .fn<(theme: Themes) => Promise<void>>()
      .mockResolvedValue(undefined)

    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.System,
      setTheme,
    })()

    expect(setTheme).toHaveBeenCalledTimes(1)
    expect(setTheme).toHaveBeenCalledWith(Themes.System)
  })
})

describe('engine connection setup', () => {
  it.each([true, false])(
    'only configures the renderer outside geometry-only mode (%s)',
    async (geometryOnly) => {
      const connection = new Connection({
        url: 'ws://localhost/modeling-test',
        token: 'token',
        geometryOnly,
        handleOnDataChannelMessage: vi.fn(),
        recordShutdownTrigger: vi.fn(() => true),
        tearDownManager: vi.fn(),
        rejectPendingCommand: vi.fn(),
        handleMessage: vi.fn(),
        getCloudProjectId: () => undefined,
      })
      expect(connection.webrtc).toBe(!geometryOnly)
      const sendSceneCommand = vi.fn().mockResolvedValue(null)
      const setTheme = vi.fn().mockResolvedValue(undefined)
      const setDefaultSystemProperties = vi.fn().mockResolvedValue(undefined)
      const listenToDarkModeMatcher = vi.fn()
      const camControlsCameraChange = vi.fn()
      const setStreamIsReady = vi.fn()
      await createOnEngineConnectionOpened({
        connection,
        settings: {
          theme: Themes.Light,
          enableSSAO: true,
          showScaleGrid: true,
          highlightEdges: true,
          cameraProjection: 'orthographic',
          cameraOrbit: 'spherical',
          backfaceColor: '#ffffff',
        },
        sendSceneCommand,
        setTheme,
        setDefaultSystemProperties,
        listenToDarkModeMatcher,
        camControlsCameraChange,
        setStreamIsReady,
      })()

      expect(sendSceneCommand).toHaveBeenCalledTimes(geometryOnly ? 0 : 3)
      for (const callback of [
        setTheme,
        setDefaultSystemProperties,
        listenToDarkModeMatcher,
        camControlsCameraChange,
      ]) {
        expect(callback).toHaveBeenCalledTimes(geometryOnly ? 0 : 1)
      }
      expect(setStreamIsReady).toHaveBeenCalledWith(true)
    }
  )
})
