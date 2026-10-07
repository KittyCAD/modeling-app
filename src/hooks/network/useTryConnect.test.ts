import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { tryConnecting, useTryConnect } from '@src/hooks/network/useTryConnect'
import { useSingletons } from '@src/lib/boot'
import { renderHook } from '@testing-library/react'
import type { KclManager } from '@src/lang/KclManager'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { reapplyActiveViewAfterReconnect } from '@src/lib/kclNamedViewActivation'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
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
vi.mock('@src/lang/kclLanguageVersion', () => ({
  getKclLanguageVersion: vi.fn(),
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
vi.mock(import('@src/lib/trap'), async (importOriginal) => ({
  ...(await importOriginal()),
  reportRejection: vi.fn(),
}))

describe('tryConnecting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getKclLanguageVersion).mockReturnValue('2.0')
  })

  it('uses the latest requested mode and restores camera setup on reconnect', async () => {
    vi.mocked(preflightEngineVideoCodecSupport).mockResolvedValue(undefined)
    const manager = {
      started: false,
      geometryOnly: false,
      connection: { mediaStream: {} },
      start: vi.fn(async ({ geometryOnly }: { geometryOnly: boolean }) => {
        manager.started = true
        manager.geometryOnly = geometryOnly
      }),
      tearDown: vi.fn(),
    }
    const rustContext = {
      clearSceneAndBustCache: vi.fn().mockResolvedValue(undefined),
      wasmInstancePromise: Promise.resolve({}),
    }
    const kclManager = {
      engineCommandManager: manager,
      rustContext,
      code: 'kclVersion 2.0',
      executeCode: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(useSingletons).mockReturnValue({
      kclManager,
    } as unknown as ReturnType<typeof useSingletons>)
    const { result, rerender, unmount } = renderHook(
      ({ geometryOnly }) => useTryConnect({ geometryOnly }),
      { initialProps: { geometryOnly: true } }
    )
    // Simulate a callback retained by an event listener across mode changes.
    const reconnect = result.current.tryConnecting
    const sceneInfra = {
      camControls: { clearOldCameraState: vi.fn() },
    } as unknown as SceneInfra
    for (const geometryOnly of [true, false, true]) {
      rerender({ geometryOnly })
      manager.started = false
      vi.mocked(resetCameraPosition).mockClear()
      vi.mocked(reapplyActiveViewAfterReconnect).mockClear()
      await expect(
        reconnect({
          isConnecting: result.current.isConnecting,
          numberOfConnectionAttempts: result.current.numberOfConnectionAttempts,
          authToken: 'token',
          videoWrapperRef: { current: document.createElement('div') },
          videoRef: { current: { srcObject: null } as HTMLVideoElement },
          setAppState: vi.fn(),
          setIsSceneReady: vi.fn(),
          timeToConnect: 1_000,
          settingsActor: {} as SettingsActorType,
          setShowManualConnect: vi.fn(),
          sceneInfra,
        })
      ).resolves.toBe('connected')
      expect(manager.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ geometryOnly, kclVersion: '2.0' })
      )
      expect(resetCameraPosition).toHaveBeenCalledTimes(geometryOnly ? 0 : 1)
      expect(reapplyActiveViewAfterReconnect).toHaveBeenCalledTimes(
        geometryOnly ? 0 : 1
      )
    }
    expect(rustContext.clearSceneAndBustCache).toHaveBeenCalledTimes(3)
    expect(kclManager.executeCode).toHaveBeenCalledTimes(3)
    expect(manager.tearDown).not.toHaveBeenCalled()
    unmount()
  })

  it.each<{
    source: string
    version: KclVersion | Error
    expectedVersion: KclVersion | undefined
  }>([
    { source: 'valid', version: '2.0', expectedVersion: '2.0' },
    {
      source: 'invalid',
      version: new Error('Invalid KCL version'),
      expectedVersion: undefined,
    },
  ])('stops terminal retries with $source source', async (testCase) => {
    vi.mocked(getKclLanguageVersion).mockReturnValue(testCase.version)
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
        kclManager: { code: 'test source' } as KclManager,
        rustContext: {
          wasmInstancePromise: Promise.resolve({}),
        } as RustContext,
      })
    ).rejects.toEqual(connectionError)

    expect(manager.start).toHaveBeenCalledOnce()
    expect(manager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        geometryOnly: false,
        kclVersion: testCase.expectedVersion,
      })
    )
    expect(manager.tearDown).not.toHaveBeenCalled()
    expect(numberOfConnectionAttempts.current).toBe(0)
    expect(setShowManualConnect).toHaveBeenCalledWith(true)
  })

  it.each([true, false])(
    'stops the initial retry loop after a terminal connection error (geometryOnly=%s)',
    async (geometryOnly) => {
      vi.mocked(preflightEngineVideoCodecSupport).mockImplementation(
        async () => {
          if (geometryOnly)
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
          geometryOnly,
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
          kclManager: { code: 'kclVersion 2.0' } as KclManager,
          rustContext: {
            wasmInstancePromise: Promise.resolve({}),
          } as RustContext,
        })
      ).rejects.toEqual(connectionError)

      expect(manager.start).toHaveBeenCalledOnce()
      expect(manager.start).toHaveBeenCalledWith(
        expect.objectContaining({ geometryOnly, kclVersion: '2.0' })
      )
      expect(preflightEngineVideoCodecSupport).toHaveBeenCalledTimes(
        geometryOnly ? 0 : 1
      )
      expect(manager.tearDown).not.toHaveBeenCalled()
      expect(numberOfConnectionAttempts.current).toBe(0)
      expect(setShowManualConnect).toHaveBeenCalledWith(true)
    }
  )
})

describe('reconnect camera restoration', () => {
  it.each(
    ['reconnect', 'idle', 'both'].flatMap((source) =>
      ['none', 'clear', 'camera', 'named'].map((retired) => ({
        source,
        retired,
      }))
    )
  )(
    'restores $source camera before rebuilding (retired at $retired)',
    async ({ source, retired }) => {
      vi.mocked(getKclLanguageVersion).mockReturnValue('2.0')
      const snapshot = { pivot_position: { x: 4, y: 5, z: 6 } }
      const events: string[] = []
      const manager = {
        started: false,
        connection: { mediaStream: {} },
        start: vi.fn(async () => {
          manager.started = true
        }),
      }
      const camControls = {
        reconnectCameraState: source === 'idle' ? undefined : snapshot,
        oldCameraState:
          source === 'idle'
            ? snapshot
            : source === 'both'
              ? { pivot_position: { x: 7, y: 8, z: 9 } }
              : undefined,
        overrideOldCameraStateToPreventDesync: vi.fn(),
        captureCameraForReconnect: vi.fn(),
        setCameraView: vi.fn(async () => {
          events.push('camera')
          if (retired === 'camera') manager.connection = { mediaStream: {} }
        }),
        clearOldCameraState: vi.fn(),
      }
      const executeCode = vi.fn(async () => {
        events.push('execute')
      })
      vi.mocked(reapplyActiveViewAfterReconnect).mockReset()
      vi.mocked(reapplyActiveViewAfterReconnect).mockImplementationOnce(
        async () => {
          events.push('named view')
          if (retired === 'named') manager.connection = { mediaStream: {} }
          return true
        }
      )
      vi.mocked(resetCameraPosition).mockClear()
      await tryConnecting({
        abnormalCloseRetries: { current: 0 },
        isConnecting: { current: false },
        numberOfConnectionAttempts: { current: 0 },
        authToken: 'token',
        videoWrapperRef: {
          current: { clientWidth: 256, clientHeight: 256 } as HTMLDivElement,
        },
        setAppState: vi.fn(),
        videoRef: { current: {} as HTMLVideoElement },
        setIsSceneReady: vi.fn(),
        timeToConnect: 1000,
        settingsActor: {} as SettingsActorType,
        setShowManualConnect: vi.fn(),
        sceneInfra: { camControls } as unknown as SceneInfra,
        engineCommandManager: manager as unknown as ConnectionManager,
        kclManager: { executeCode } as unknown as KclManager,
        rustContext: {
          clearSceneAndBustCache: vi.fn(async () => {
            events.push('clear')
            if (retired === 'clear') manager.connection = { mediaStream: {} }
          }),
        } as unknown as RustContext,
      })
      expect(events).toEqual(
        retired === 'clear'
          ? ['clear']
          : retired === 'camera'
            ? ['clear', 'camera']
            : ['clear', 'camera', 'execute', 'named view']
      )
      expect(camControls.reconnectCameraState).toBeUndefined()
      expect(
        camControls.overrideOldCameraStateToPreventDesync
      ).toHaveBeenCalledTimes(source === 'idle' ? 1 : 0)
      expect(resetCameraPosition).not.toHaveBeenCalled()
      if (retired === 'clear') {
        expect(camControls.setCameraView).not.toHaveBeenCalled()
      } else {
        expect(camControls.setCameraView).toHaveBeenCalledExactlyOnceWith(
          snapshot
        )
      }
      if (retired === 'none' || retired === 'named') {
        expect(reapplyActiveViewAfterReconnect).toHaveBeenLastCalledWith(
          expect.anything(),
          { restoreCamera: false }
        )
      } else {
        expect(reapplyActiveViewAfterReconnect).not.toHaveBeenCalled()
      }
      if (retired !== 'none')
        expect(camControls.clearOldCameraState).not.toHaveBeenCalled()
      expect(manager.start).toHaveBeenCalledWith(
        expect.objectContaining({ prepareForReconnect: expect.any(Function) })
      )
    }
  )
})
