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
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'

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
    zookeeperPromptRunningSignal.value = false
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
    zookeeperPromptRunningSignal.value = false
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('does not disconnect while KCL is executing', async () => {
    hookMocks.state.kclManager.isExecuting = true

    const startCallback = vi.fn()
    const beforeIdleTeardown = vi.fn()
    const idleCallback = vi.fn()

    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback,
        beforeIdleTeardown,
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
    expect(beforeIdleTeardown).not.toHaveBeenCalled()
    expect(idleCallback).not.toHaveBeenCalled()

    unmount()
  })

  test('starts the idle countdown only after KCL finishes executing', async () => {
    const startCallback = vi.fn()
    const beforeIdleTeardown = vi.fn()
    const idleCallback = vi.fn()

    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback,
        beforeIdleTeardown,
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
    expect(beforeIdleTeardown).toHaveBeenCalledTimes(1)
    expect(idleCallback).toHaveBeenCalledTimes(1)
    expect(beforeIdleTeardown.mock.invocationCallOrder[0]).toBeLessThan(
      hookMocks.state.kclManager.engineCommandManager.tearDown.mock
        .invocationCallOrder[0]
    )
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown.mock
        .invocationCallOrder[0]
    ).toBeLessThan(idleCallback.mock.invocationCallOrder[0])

    unmount()
  })

  test('does not disconnect while a Zookeeper prompt is running', async () => {
    zookeeperPromptRunningSignal.value = true

    const idleCallback = vi.fn()
    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback: vi.fn(),
        beforeIdleTeardown: vi.fn(),
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

    zookeeperPromptRunningSignal.value = false
    await advance(5_000)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()

    await advance(1_000)
    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).toHaveBeenCalledTimes(1)
    expect(idleCallback).toHaveBeenCalledTimes(1)

    unmount()
  })

  test('does not disconnect when a Zookeeper prompt starts during idle teardown', async () => {
    let finishSavingCameraState: () => void = () => undefined
    hookMocks.state.kclManager.sceneInfra.camControls.saveRemoteCameraState =
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSavingCameraState = resolve
          })
      )

    const idleCallback = vi.fn()
    const beforeIdleTeardown = vi.fn()
    const { unmount } = renderHook(() =>
      useOnPageIdle({
        startCallback: vi.fn(),
        beforeIdleTeardown,
        idleCallback,
      })
    )

    await advance(5_000)
    expect(
      hookMocks.state.kclManager.sceneInfra.camControls.saveRemoteCameraState
    ).toHaveBeenCalledTimes(1)

    zookeeperPromptRunningSignal.value = true
    await act(async () => {
      finishSavingCameraState()
      await Promise.resolve()
    })

    expect(
      hookMocks.state.kclManager.engineCommandManager.tearDown
    ).not.toHaveBeenCalled()
    expect(beforeIdleTeardown).not.toHaveBeenCalled()
    expect(idleCallback).not.toHaveBeenCalled()

    unmount()
  })
})
