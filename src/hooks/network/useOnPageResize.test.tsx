import { useOnPageMounted } from '@src/hooks/network/useOnPageMounted'
import { useOnPageResize } from '@src/hooks/network/useOnPageResize'
import type { Connection } from '@src/lib/engineConnection/connection'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

// The engine transport is irrelevant to observer and React subscription ownership.
function attachConnection(manager: ConnectionManager) {
  const connection = { disconnectAll: vi.fn() } as unknown as Connection
  manager.connection = connection
  manager.started = true
  return connection
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reacts to readiness without reconnecting and cancels resize work across teardown', () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const observers: {
    notify: () => void
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(notify: () => void) {
        observers.push({
          notify,
          observe: this.observe,
          disconnect: this.disconnect,
        })
      }
    }
  )
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
    frames.delete(frame)
  })
  const flushFrames = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(0))
  }
  const manager = new ConnectionManager({
    settingsActor: {} as SettingsActorType,
  })
  const connection = attachConnection(manager)
  const start = vi.spyOn(manager, 'start').mockResolvedValue(undefined)
  const resize = vi.spyOn(manager, 'handleResize').mockResolvedValue(undefined)
  const videoWrapperRef = { current: document.createElement('div') }
  Object.defineProperties(videoWrapperRef.current, {
    clientWidth: { value: 512 },
    clientHeight: { value: 256 },
  })
  const params = {
    engineCommandManager: manager,
    videoWrapperRef,
    videoRef: { current: document.createElement('video') },
    canvasRef: { current: document.createElement('canvas') },
  }
  const { result, rerender, unmount } = renderHook(() => {
    const mounted = useOnPageMounted({
      callback: () => {
        void manager.start({ token: 'token', width: 256, height: 256 })
      },
    })
    useOnPageResize(params)
    return mounted
  })
  try {
    expect(observers).toHaveLength(0)
    act(() => {
      manager.markStreamReady(connection)
    })
    expect(observers).toHaveLength(0)
    act(() => {
      manager.markStreamAcceptingInput(connection)
    })
    expect(observers).toHaveLength(1)
    rerender()
    expect(start).toHaveBeenCalledOnce()
    expect(observers[0].observe).toHaveBeenCalledOnce()

    // Leave both a debounced resize and an animation frame pending.
    observers[0].notify()
    flushFrames()
    observers[0].notify()
    act(() => {
      manager.tearDown({ route: 'window-offline', initiatedBy: 'client' })
    })
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    vi.runAllTimers()
    expect(resize).not.toHaveBeenCalled()

    const replacement = attachConnection(manager)
    act(() => {
      manager.markStreamReady(replacement)
      manager.markStreamAcceptingInput(replacement)
    })
    expect(observers).toHaveLength(2)
    // A late notification from the disconnected observer cannot resize B.
    observers[0].notify()
    flushFrames()
    expect(resize).not.toHaveBeenCalled()
    observers[1].notify()
    flushFrames()
    vi.advanceTimersByTime(250)
    expect(resize).toHaveBeenCalledExactlyOnceWith({ width: 512, height: 256 })
    expect(start).toHaveBeenCalledOnce()
    // Even a reconnect batched into one React update replaces the observer.
    act(() => {
      manager.tearDown({ route: 'window-offline', initiatedBy: 'client' })
      const next = attachConnection(manager)
      manager.markStreamReady(next)
      manager.markStreamAcceptingInput(next)
    })
    expect(observers).toHaveLength(3)
    expect(observers[1].disconnect).toHaveBeenCalledOnce()
    observers[2].notify()
    unmount()
    expect(frames.size).toBe(0)
    expect(observers[2].disconnect).toHaveBeenCalledOnce()
  } finally {
    result.current.resetGlobalEngineConnectionManager(manager)
  }
})
