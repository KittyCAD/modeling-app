import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { tryConnecting } from '@src/hooks/network/useTryConnect'
import type { KclManager } from '@src/lang/KclManager'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionError,
  EngineConnectionErrorKind,
} from '@src/lib/engineConnection/utils'
import { preflightEngineVideoCodecSupport } from '@src/lib/engineConnection/videoCodecSupport'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({ useSingletons: vi.fn() }))
vi.mock('@src/lib/engineConnection/videoCodecSupport', () => ({
  preflightEngineVideoCodecSupport: vi.fn(),
}))
vi.mock('@src/lib/kclNamedViewActivation', () => ({
  reapplyActiveViewAfterReconnect: vi.fn(),
}))
vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(),
}))
vi.mock('@src/lib/settings/settingsUtils', () => ({
  getSettingsFromActorContext: vi.fn(),
  jsAppSettings: vi.fn(),
}))
vi.mock('@src/lib/trap', () => ({ reportRejection: vi.fn() }))

describe('tryConnecting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([true, false])(
    'stops the initial retry loop after a terminal connection error (webrtc=%s)',
    async (webrtc) => {
      vi.mocked(preflightEngineVideoCodecSupport).mockImplementation(
        async () => {
          if (!webrtc)
            throw new Error(
              'WebSocket-only connections must not check video codecs'
            )
          return undefined
        }
      )
      const connectionError: EngineConnectionError = {
        kind: EngineConnectionErrorKind.BackendDisconnect,
        message: 'backend disconnected',
        terminal: true,
      }
      const manager = {
        started: false,
        connection: undefined,
        lastConnectionError: undefined as EngineConnectionError | undefined,
        start: vi.fn(async () => {
          manager.lastConnectionError = connectionError
          throw new Error('connection failed')
        }),
        tearDown: vi.fn(),
      }
      const setShowManualConnect = vi.fn()
      const numberOfConnectionAttempts = { current: 0 }

      await expect(
        tryConnecting({
          webrtc,
          abnormalCloseRetries: { current: 0 },
          isConnecting: { current: false },
          numberOfConnectionAttempts,
          authToken: 'token',
          videoWrapperRef: {
            current: { clientWidth: 256, clientHeight: 256 } as HTMLDivElement,
          },
          setAppState: vi.fn(),
          videoRef: { current: null },
          setIsSceneReady: vi.fn(),
          timeToConnect: 1_000,
          settingsActor: {} as SettingsActorType,
          setShowManualConnect,
          sceneInfra: {} as SceneInfra,
          engineCommandManager: manager as unknown as ConnectionManager,
          kclManager: {} as KclManager,
          rustContext: {} as RustContext,
        })
      ).rejects.toEqual(connectionError)

      expect(manager.start).toHaveBeenCalledOnce()
      expect(manager.start).toHaveBeenCalledWith(
        expect.objectContaining({ webrtc })
      )
      expect(preflightEngineVideoCodecSupport).toHaveBeenCalledTimes(
        webrtc ? 1 : 0
      )
      expect(manager.tearDown).not.toHaveBeenCalled()
      expect(numberOfConnectionAttempts.current).toBe(0)
      expect(setShowManualConnect).toHaveBeenCalledWith(true)
    }
  )
})
