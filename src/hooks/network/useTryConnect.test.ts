import type { CameraStateSnapshot } from '@src/clientSideScene/CameraControls'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { tryConnecting } from '@src/hooks/network/useTryConnect'
import type { KclManager } from '@src/lang/KclManager'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionError,
  EngineConnectionErrorKind,
} from '@src/lib/engineConnection/utils'
import { reapplyActiveViewAfterReconnect } from '@src/lib/kclNamedViewActivation'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({ useSingletons: vi.fn() }))
vi.mock('@src/lib/kclNamedViewActivation', () => ({
  reapplyActiveViewAfterReconnect: vi.fn(),
}))
vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn(),
}))
vi.mock('@src/lib/engineConnection/videoCodecSupport', () => ({
  preflightEngineVideoCodecSupport: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@src/lib/settings/settingsUtils', () => ({
  getSettingsFromActorContext: vi.fn(),
  jsAppSettings: vi.fn(),
}))
vi.mock('@src/lib/trap', () => ({ reportRejection: vi.fn() }))

function createSuccessfulConnectionHarness(
  cameraStateBeforeReconnect?: CameraStateSnapshot
) {
  const mediaStream = new MediaStream()
  const manager = {
    started: false,
    connection: undefined as ConnectionManager['connection'],
    lastConnectionError: undefined as EngineConnectionError | undefined,
    start: vi.fn(async () => {
      manager.started = true
      manager.connection = { mediaStream } as ConnectionManager['connection']
    }),
    tearDown: vi.fn(() => {
      manager.started = false
      manager.connection = undefined
    }),
  }
  const camControls = {
    oldCameraState: undefined as unknown,
    cameraStateBeforeReconnect,
    restoreRemoteCameraStateAndTriggerSync: vi.fn(),
    restoreCameraState: vi.fn().mockResolvedValue(undefined),
    clearOldCameraState: vi.fn(() => {
      camControls.oldCameraState = undefined
    }),
    clearCameraStateBeforeReconnect: vi.fn(() => {
      camControls.cameraStateBeforeReconnect = undefined
    }),
  }
  const rustContext = {
    clearSceneAndBustCache: vi.fn().mockResolvedValue(undefined),
  }
  const kclManager = {
    path: undefined,
    executeCode: vi.fn().mockResolvedValue(undefined),
  }

  return {
    manager,
    camControls,
    args: {
      abnormalCloseRetries: { current: 0 },
      isConnecting: { current: false },
      numberOfConnectionAttempts: { current: 0 },
      authToken: 'token',
      videoWrapperRef: {
        current: { clientWidth: 256, clientHeight: 256 } as HTMLDivElement,
      },
      setAppState: vi.fn(),
      videoRef: { current: document.createElement('video') },
      waitForStreamPresentation: vi
        .fn<(signal: AbortSignal) => Promise<boolean>>()
        .mockResolvedValue(true),
      signal: new AbortController().signal,
      setIsSceneReady: vi.fn(),
      timeToConnect: 1_000,
      settingsActor: {} as SettingsActorType,
      setShowManualConnect: vi.fn(),
      sceneInfra: { camControls } as unknown as SceneInfra,
      engineCommandManager: manager as unknown as ConnectionManager,
      kclManager: kclManager as unknown as KclManager,
      rustContext: rustContext as unknown as RustContext,
    },
  }
}

describe('tryConnecting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reapplyActiveViewAfterReconnect).mockResolvedValue(false)
    vi.mocked(resetCameraPosition).mockResolvedValue(undefined)
  })

  it('stops the initial retry loop after a terminal connection error', async () => {
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
        waitForStreamPresentation: vi.fn().mockResolvedValue(true),
        signal: new AbortController().signal,
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
    expect(manager.tearDown).not.toHaveBeenCalled()
    expect(numberOfConnectionAttempts.current).toBe(0)
    expect(setShowManualConnect).toHaveBeenCalledWith(true)
  })

  it('uses the initial camera reset only for the first connection', async () => {
    const { args, manager, camControls } = createSuccessfulConnectionHarness()

    await expect(tryConnecting(args)).resolves.toBe('connected')

    expect(resetCameraPosition).toHaveBeenCalledOnce()
    expect(camControls.restoreCameraState).not.toHaveBeenCalled()
    const acceptingInputCall = vi
      .mocked(args.setAppState)
      .mock.calls.findIndex(([state]) => state.isStreamAcceptingInput === true)
    expect(args.waitForStreamPresentation).toHaveBeenCalledOnce()
    expect(
      vi.mocked(args.waitForStreamPresentation).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(args.setAppState).mock.invocationCallOrder[acceptingInputCall]
    )
    const blockedInputCall = vi
      .mocked(args.setAppState)
      .mock.calls.findIndex(([state]) => state.isStreamAcceptingInput === false)
    expect(
      vi.mocked(args.setAppState).mock.invocationCallOrder[blockedInputCall]
    ).toBeLessThan(manager.start.mock.invocationCallOrder[0])
  })

  it('does not reuse a previous terminal error when a fresh attempt fails', async () => {
    const { args, manager } = createSuccessfulConnectionHarness()
    args.authToken = ''
    manager.lastConnectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'stale terminal error',
      terminal: true,
    }

    await expect(tryConnecting(args)).rejects.toBe(
      'authToken is missing on connection initialization'
    )

    expect(manager.start).not.toHaveBeenCalled()
    expect(manager.lastConnectionError).toBeUndefined()
  })

  it('does not retry after connection setup is cancelled', async () => {
    const { args, manager } = createSuccessfulConnectionHarness()
    const controller = new AbortController()
    args.signal = controller.signal
    vi.mocked(args.waitForStreamPresentation).mockImplementation(async () => {
      controller.abort()
      return true
    })

    await expect(tryConnecting(args)).resolves.toBe('cancelled')

    expect(manager.start).toHaveBeenCalledOnce()
    expect(manager.tearDown).not.toHaveBeenCalled()
  })

  it('restores the pre-teardown camera through a retry', async () => {
    const cameraStateBeforeReconnect = {} as CameraStateSnapshot
    const { args, manager, camControls } = createSuccessfulConnectionHarness(
      cameraStateBeforeReconnect
    )
    camControls.oldCameraState = {}
    vi.mocked(reapplyActiveViewAfterReconnect).mockResolvedValue(true)
    camControls.restoreCameraState
      .mockRejectedValueOnce(new Error('connection dropped during setup'))
      .mockResolvedValueOnce(undefined)

    await expect(tryConnecting(args)).resolves.toBe('connected')

    expect(manager.start).toHaveBeenCalledTimes(2)
    expect(camControls.restoreCameraState).toHaveBeenCalledTimes(2)
    expect(camControls.restoreCameraState).toHaveBeenNthCalledWith(
      1,
      cameraStateBeforeReconnect
    )
    expect(camControls.restoreCameraState).toHaveBeenNthCalledWith(
      2,
      cameraStateBeforeReconnect
    )
    expect(resetCameraPosition).not.toHaveBeenCalled()
    expect(
      camControls.restoreRemoteCameraStateAndTriggerSync
    ).not.toHaveBeenCalled()
    expect(camControls.clearOldCameraState).toHaveBeenCalledOnce()
    expect(camControls.clearCameraStateBeforeReconnect).toHaveBeenCalledOnce()
  })
})
