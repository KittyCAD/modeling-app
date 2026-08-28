import { type Signal, signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAX_EXTENT,
  DEFAULT_MIN_EXTENT,
  inlineResizeHandlers,
} from '@src/features/layout/inlineResize'

/**
 * A handle that reports the listeners attached to it.
 *
 * The drag listens on the handle rather than the window, so a test has to be
 * able to replay a move through the same route a browser would.
 */
function createHandle() {
  const element = document.createElement('div')
  element.setPointerCapture = vi.fn()
  element.releasePointerCapture = vi.fn()
  return element
}

const pointerEvent = (
  type: string,
  init: { clientX?: number; button?: number } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    button: init.button ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event as unknown as PointerEvent
}

const key = (name: string, shiftKey = false) =>
  new KeyboardEvent('keydown', { key: name, shiftKey, cancelable: true })

function drag(
  extent: Signal<number>,
  options: Parameters<typeof inlineResizeHandlers>[1],
  from: number,
  to: number[]
) {
  const handle = createHandle()
  const resize = inlineResizeHandlers(extent, options)

  const down = pointerEvent('pointerdown', { clientX: from })
  Object.defineProperty(down, 'currentTarget', { value: handle })
  resize.onPointerDown(down)

  for (const clientX of to) {
    handle.dispatchEvent(pointerEvent('pointermove', { clientX }))
  }
  handle.dispatchEvent(pointerEvent('pointerup'))
  return handle
}

describe('inline resize handlers', () => {
  it('moves the extent with the pointer', () => {
    const extent = signal(300)
    drag(extent, { direction: 1 }, 100, [140])
    expect(extent.value).toBe(340)
  })

  it('inverts for a panel on the other side of its handle', () => {
    const extent = signal(300)
    drag(extent, { direction: -1 }, 100, [140])
    expect(extent.value).toBe(260)
  })

  /**
   * Every move is measured from where the drag started, not from the last frame.
   * Accumulating deltas drifts, and a clamped frame would lose the difference
   * permanently — drag past the maximum and back, and the edge would no longer
   * be under the pointer.
   */
  it('keeps the edge under the pointer after clamping', () => {
    const extent = signal(300)
    // Out past the maximum, then back to 20px right of where the drag began.
    drag(extent, { direction: 1, min: 200, max: 400 }, 100, [900, 120])
    expect(extent.value).toBe(320)
  })

  it('clamps to the given bounds', () => {
    const extent = signal(300)
    drag(extent, { direction: 1, min: 220, max: 380 }, 0, [-500])
    expect(extent.value).toBe(220)

    drag(extent, { direction: 1, min: 220, max: 380 }, 0, [500])
    expect(extent.value).toBe(380)
  })

  it('falls back to the rail defaults', () => {
    const extent = signal(300)
    drag(extent, { direction: 1 }, 0, [-5000])
    expect(extent.value).toBe(DEFAULT_MIN_EXTENT)

    drag(extent, { direction: 1 }, 0, [5000])
    expect(extent.value).toBe(DEFAULT_MAX_EXTENT)
  })

  it('stops following once the pointer is up', () => {
    const extent = signal(300)
    const handle = drag(extent, { direction: 1 }, 100, [140])

    handle.dispatchEvent(pointerEvent('pointermove', { clientX: 400 }))
    expect(extent.value).toBe(340)
  })

  it('ignores a drag from any button but the primary', () => {
    const extent = signal(300)
    const handle = createHandle()
    const resize = inlineResizeHandlers(extent, { direction: 1 })

    const down = pointerEvent('pointerdown', { clientX: 100, button: 2 })
    Object.defineProperty(down, 'currentTarget', { value: handle })
    resize.onPointerDown(down)

    handle.dispatchEvent(pointerEvent('pointermove', { clientX: 400 }))
    expect(extent.value).toBe(300)
  })

  it('nudges with the arrow keys, and further with shift', () => {
    const extent = signal(300)
    const resize = inlineResizeHandlers(extent, { direction: 1 })

    resize.onKeyDown(key('ArrowRight'))
    expect(extent.value).toBe(312)

    resize.onKeyDown(key('ArrowLeft'))
    expect(extent.value).toBe(300)

    resize.onKeyDown(key('ArrowRight', true))
    expect(extent.value).toBe(340)
  })

  it('nudges the other way for an inline-end panel', () => {
    const extent = signal(300)
    const resize = inlineResizeHandlers(extent, { direction: -1 })

    resize.onKeyDown(key('ArrowRight'))
    expect(extent.value).toBe(288)
  })

  it('leaves other keys to whatever else wanted them', () => {
    const extent = signal(300)
    const resize = inlineResizeHandlers(extent, { direction: 1 })

    const event = key('Enter')
    resize.onKeyDown(event)
    expect(extent.value).toBe(300)
    expect(event.defaultPrevented).toBe(false)
  })
})
