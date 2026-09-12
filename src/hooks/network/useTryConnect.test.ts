import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { tryConnecting } from '@src/hooks/network/useTryConnect'
import type { KclManager } from '@src/lang/KclManager'
import { emptyExecState } from '@src/lang/wasm'
import { NUMBER_OF_ENGINE_RETRIES } from '@src/lib/constants'
import { Connection } from '@src/lib/engineConnection/connection'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionError,
  EngineConnectionErrorKind,
} from '@src/lib/engineConnection/utils'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({ useSingletons: vi.fn() }))
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

function connectionFixture() {
  const connection = new Connection({
    url: 'wss://example.test/modeling',
    token: '',
    handleOnDataChannelMessage: vi.fn(),
    tearDownManager: vi.fn(),
    rejectPendingCommand: vi.fn(),
    handleMessage: vi.fn(),
    getCloudProjectId: () => undefined,
  })
  connection.mediaStream = new MediaStream()
  const manager = {
    started: false,
    connection: undefined as Connection | undefined,
    lastConnectionError: undefined as EngineConnectionError | undefined,
    start: vi.fn(async () => {
      manager.started = true
      manager.connection = connection
    }),
    tearDown: vi.fn(() => {
      manager.started = false
      manager.connection = undefined
    }),
  }
  const args = {
    isConnecting: { current: false },
    numberOfConnectionAttempts: { current: 0 },
    authToken: 'token',
    videoWrapperRef: { current: document.createElement('div') },
    setAppState: vi.fn(),
    videoRef: { current: document.createElement('video') },
    setIsSceneReady: vi.fn(),
    timeToConnect: 1_000,
    settingsActor: {} as SettingsActorType,
    setShowManualConnect: vi.fn(),
    sceneInfra: {
      camControls: { clearOldCameraState: vi.fn() },
    } as unknown as SceneInfra,
    engineCommandManager: manager as unknown as ConnectionManager,
    kclManager: {
      executeCode: vi.fn().mockResolvedValue(undefined),
    } as unknown as KclManager,
    rustContext: {
      clearSceneAndBustCache: vi.fn().mockResolvedValue(undefined),
    } as unknown as RustContext,
  }
  return { args, manager, connection }
}

describe('tryConnecting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('stops the initial retry loop after a terminal connection error', async () => {
    const { args, manager } = connectionFixture()
    const connectionError: EngineConnectionError = {
      kind: EngineConnectionErrorKind.BackendDisconnect,
      message: 'backend disconnected',
      terminal: true,
    }
    manager.start.mockImplementation(async () => {
      manager.lastConnectionError = connectionError
      throw new Error('connection failed')
    })

    await expect(tryConnecting(args)).rejects.toEqual(connectionError)
    expect(manager.start).toHaveBeenCalledOnce()
    expect(manager.tearDown).not.toHaveBeenCalled()
    expect(args.numberOfConnectionAttempts.current).toBe(0)
    expect(args.isConnecting.current).toBe(false)
    expect(args.setShowManualConnect).toHaveBeenCalledWith(true)
  })

  it.each([false, true])(
    'keeps competing callers out of a pending attempt (automatic retry=%s)',
    async (retry) => {
      const { args, manager, connection } = connectionFixture()
      const started = Promise.withResolvers<undefined>()
      const finish = Promise.withResolvers<undefined>()
      if (retry)
        manager.start.mockRejectedValueOnce(new Error('transient failure'))
      manager.start.mockImplementation(async () => {
        manager.started = true
        manager.connection = connection
        started.resolve(undefined)
        await finish.promise
      })
      const owner = tryConnecting(args)
      await started.promise
      try {
        expect(args.isConnecting.current).toBe(true)
        await expect(tryConnecting(args)).resolves.toBe('connecting')
        expect(manager.start).toHaveBeenCalledTimes(retry ? 2 : 1)
        expect(manager.tearDown).toHaveBeenCalledTimes(retry ? 1 : 0)
        expect(manager.connection).toBe(connection)
        expect(args.numberOfConnectionAttempts.current).toBe(retry ? 2 : 1)
      } finally {
        finish.resolve(undefined)
        await owner
      }
      expect(args.isConnecting.current).toBe(false)
      expect(args.numberOfConnectionAttempts.current).toBe(0)
      expect(args.setShowManualConnect).toHaveBeenLastCalledWith(false)
      expect(args.setAppState).toHaveBeenLastCalledWith({
        isStreamAcceptingInput: true,
      })
    }
  )

  it('releases the lock after retry exhaustion so manual recovery can connect', async () => {
    const { args, manager } = connectionFixture()
    const startNormally = manager.start.getMockImplementation()
    const error = new Error('connection failed')
    manager.start.mockRejectedValue(error)
    await expect(tryConnecting(args)).rejects.toBe(error)
    expect(manager.start).toHaveBeenCalledTimes(NUMBER_OF_ENGINE_RETRIES)
    expect(manager.tearDown).toHaveBeenCalledTimes(NUMBER_OF_ENGINE_RETRIES)
    expect(args.isConnecting.current).toBe(false)
    expect(args.numberOfConnectionAttempts.current).toBe(0)
    if (!startNormally) throw new Error('Missing fixture start implementation')
    manager.start.mockImplementation(startNormally)
    await expect(tryConnecting(args)).resolves.toBe('connected')
    expect(args.isConnecting.current).toBe(false)
    expect(args.setShowManualConnect).toHaveBeenLastCalledWith(false)
  })

  it('keeps ownership until scene setup finishes', async () => {
    const { args, manager } = connectionFixture()
    const setupStarted = Promise.withResolvers<undefined>()
    const finishSetup = Promise.withResolvers<undefined>()
    vi.spyOn(args.rustContext, 'clearSceneAndBustCache').mockImplementation(
      async () => {
        setupStarted.resolve(undefined)
        await finishSetup.promise
        return emptyExecState()
      }
    )
    const owner = tryConnecting(args)
    await setupStarted.promise
    try {
      await expect(tryConnecting(args)).resolves.toBe('connecting')
      expect(manager.start).toHaveBeenCalledOnce()
      expect(manager.tearDown).not.toHaveBeenCalled()
      expect(args.isConnecting.current).toBe(true)
    } finally {
      finishSetup.resolve(undefined)
      await owner
    }
    expect(args.isConnecting.current).toBe(false)
  })
})
