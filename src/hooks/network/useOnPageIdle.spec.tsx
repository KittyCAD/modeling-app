import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const hookMocks = vi.hoisted(() => {
  const state = {
    streamIdleMode: 5_000,
    modelingValue: 'idle',
    kclManager: null as any,
  }

  return {
    state,
    useApp: () => ({
      settings: {
        useSettings: () => ({
          app: {
            streamIdleMode: {
              current: state.streamIdleMode,
            },
          },
        }),
      },
    }),
    useSingletons: () => ({
      kclManager: state.kclManager,
    }),
    useModelingContext: () => ({
      state: {
        matches: (value: string) => value === state.modelingValue,
      },
    }),
  }
})

vi.mock('@src/lib/boot', () => ({
  useApp: hookMocks.useApp,
  useSingletons: hookMocks.useSingletons,
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: hookMocks.useModelingContext,
}))

import { useOnPageIdle } from '@src/hooks/network/useOnPageIdle'

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useOnPageIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hookMocks.state.streamIdleMode = 5_000
    hookMocks.state.modelingValue = 'idle'
    hookMocks.state.kclManager = {
      isExecuting: false,
      sceneInfra: {
        camControls: {
          saveRemoteCameraState: vi.fn().mockResolvedValue(undefined),
          clearOldCameraState: vi.fn(),
          oldCameraState: null,
        },
      },
      engineCommandManager: {
        tearDown: vi.fn(),
      },
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('does not disconnect while KCL is executing', async () => {
    hookMocks.state.kclManager.isExecuting = true

    const startCallback = vi.fn()
    const idleCallback = vi.fn()

    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback,
        idleCallback,
      })
    )

    await advance(30_000)

    expect(
      hookMocks.state.kclManager.sceneInfra.camControls.saveRemoteCameraState
    ).not.toHaveBeenCalled()
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()
    expect(idleCallback).not.toHaveBeenCalled()

    unmount()
  })

  test('starts the idle countdown only after KCL finishes executing', async () => {
    const startCallback = vi.fn()
    const idleCallback = vi.fn()

    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback,
        idleCallback,
      })
    )

    await advance(4_000)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()

    hookMocks.state.kclManager.isExecuting = true
    await advance(10_000)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()

    hookMocks.state.kclManager.isExecuting = false
    await advance(5_000)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()

    await advance(1_000)

    expect(
      hookMocks.state.kclManager.sceneInfra.camControls.saveRemoteCameraState
    ).toHaveBeenCalledTimes(1)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).toHaveBeenCalledTimes(1)
    expect(idleCallback).toHaveBeenCalledTimes(1)

    unmount()
  })
})
