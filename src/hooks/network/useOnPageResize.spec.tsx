import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const appState = vi.hoisted(() => ({ isStreamAcceptingInput: true }))
vi.mock('@src/AppState', () => ({ useAppState: () => appState }))

import { useOnPageResize } from '@src/hooks/network/useOnPageResize'
import { promiseFactory } from '@src/lib/utils'

let notifyResize = () => {}
const disconnect = vi.fn()

class TestResizeObserver implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = disconnect

  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  disconnect.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mountResize() {
  let width = 640
  const wrapper = document.createElement('div')
  Object.defineProperties(wrapper, {
    clientWidth: { get: () => width },
    clientHeight: { get: () => 480 },
  })
  const handleResize = vi.fn().mockResolvedValue(undefined)
  const hook = renderHook(() =>
    useOnPageResize({
      videoWrapperRef: { current: wrapper },
      videoRef: { current: document.createElement('video') },
      canvasRef: { current: document.createElement('canvas') },
      engineCommandManager: { connection: undefined, handleResize },
    })
  )
  return { ...hook, handleResize, setWidth: (value: number) => (width = value) }
}

async function nextFrame() {
  await act(async () => vi.advanceTimersToNextFrame())
}

test('coalesces rapid viewport sizes on the next frame instead of waiting for resize debounce', async () => {
  const { handleResize, setWidth, unmount } = mountResize()
  notifyResize()
  setWidth(800)
  notifyResize()
  await nextFrame()

  expect(handleResize).toHaveBeenCalledExactlyOnceWith({
    width: 800,
    height: 480,
  })
  unmount()
})

test('keeps the final size when a previous resize is still pending', async () => {
  const { handleResize, setWidth, unmount } = mountResize()
  const pending = promiseFactory<undefined>()
  handleResize.mockReturnValueOnce(pending.promise)
  notifyResize()
  await act(async () => vi.advanceTimersByTimeAsync(300))
  setWidth(800)
  notifyResize()
  setWidth(960)
  notifyResize()
  await nextFrame()
  expect(handleResize).toHaveBeenCalledTimes(1)

  await act(async () => pending.resolve(undefined))
  await nextFrame()
  expect(handleResize).toHaveBeenLastCalledWith({ width: 960, height: 480 })
  expect(handleResize).toHaveBeenCalledTimes(2)
  unmount()
})

test('cancels a queued viewport update when its observer unmounts', async () => {
  const { handleResize, unmount } = mountResize()
  notifyResize()
  unmount()
  await nextFrame()

  expect(handleResize).not.toHaveBeenCalled()
  expect(disconnect).toHaveBeenCalledOnce()
})

test('does not resume a pending resize sequence after the observer unmounts', async () => {
  const { handleResize, setWidth, unmount } = mountResize()
  const pending = promiseFactory<undefined>()
  handleResize.mockReturnValueOnce(pending.promise)
  notifyResize()
  await act(async () => vi.advanceTimersByTimeAsync(300))
  setWidth(800)
  notifyResize()
  unmount()
  await act(async () => pending.resolve(undefined))
  await nextFrame()

  expect(handleResize).toHaveBeenCalledTimes(1)
})
