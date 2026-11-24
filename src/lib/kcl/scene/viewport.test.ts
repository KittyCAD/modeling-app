import {
  observeViewportSize,
  observeViewportDensity,
} from '@src/lib/kcl/scene/viewport'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

it('coalesces layout changes until the next frame and cancels pending work on detach', () => {
  const deliveries: Array<() => void> = []
  const disconnected = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        deliveries.push(() => callback([], this))
      }
      observe() {}
      unobserve() {}
      disconnect = disconnected
    }
  )
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  const resize = vi.fn()
  const stop = observeViewportSize(document.createElement('div'), resize)
  try {
    deliveries[0]()
    deliveries[0]()
    expect(resize).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    const callback = frames.get(frameId)
    frames.delete(frameId)
    callback?.(0)
    expect(resize).toHaveBeenCalledOnce()
    deliveries[0]()
    expect(frames.size).toBe(1)
    stop()
    expect(frames.size).toBe(0)
    deliveries[0]()
    expect(frames.size).toBe(0)
    expect(resize).toHaveBeenCalledOnce()
    expect(disconnected).toHaveBeenCalledOnce()
  } finally {
    stop()
    vi.unstubAllGlobals()
  }
})

it('follows successive pixel densities without retaining old or detached listeners', () => {
  const changes: EventTarget[] = []
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const events = new EventTarget()
    changes.push(events)
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: events.dispatchEvent.bind(events),
    } satisfies MediaQueryList
  })
  const resize = vi.fn()
  const stop = observeViewportDensity(resize)
  try {
    changes[0].dispatchEvent(new Event('change'))
    expect(resize).toHaveBeenCalledOnce()
    changes[0].dispatchEvent(new Event('change'))
    expect(resize).toHaveBeenCalledOnce()
    changes[1].dispatchEvent(new Event('change'))
    expect(resize).toHaveBeenCalledTimes(2)
    stop()
    changes[2].dispatchEvent(new Event('change'))
    expect(resize).toHaveBeenCalledTimes(2)
  } finally {
    stop()
  }
})
