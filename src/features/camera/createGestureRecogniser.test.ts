import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CameraDriver,
  CameraGesture,
  CameraZoomRequest,
} from '@src/contracts/scene'
import { createGestureRecogniser } from '@src/features/camera/createGestureRecogniser'
import { cameraMouseGuards } from '@src/features/camera/mouseGuards'

const guards = cameraMouseGuards('MacIntel')

/**
 * A driver that records what it was asked to do.
 *
 * No engine, no socket, no pixel space: everything the recogniser does is true
 * of any renderer, so nothing about one is needed to test it.
 */
function createFakeDriver() {
  const readyValue = signal(true)
  const gestures: CameraGesture[] = []
  const zooms: CameraZoomRequest[] = []

  return {
    driver: {
      id: 'fake',
      ready: computed(() => readyValue.value),
      gesture: (gesture: CameraGesture) => gestures.push(gesture),
      zoom: (request: CameraZoomRequest) => zooms.push(request),
      setProjection: vi.fn(),
      standardView: vi.fn(),
      faceOn: vi.fn(),
      lookFrom: vi.fn(),
      zoomToFit: vi.fn(),
    } satisfies CameraDriver,
    gestures,
    zooms,
    readyValue,
  }
}

function createElement(rect = { left: 50, top: 20, width: 500, height: 250 }) {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect
  element.setPointerCapture = vi.fn()
  element.releasePointerCapture = vi.fn()
  element.hasPointerCapture = () => true
  return element
}

const pointer = (
  type: string,
  init: Partial<PointerEvent> & { clientX?: number; clientY?: number } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    buttons: init.buttons ?? 0,
    button: init.button ?? -1,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'mouse',
  })
  return event
}

const RIGHT = 2

describe('createGestureRecogniser', () => {
  let fake: ReturnType<typeof createFakeDriver>
  let element: HTMLElement
  let dispose: () => void

  const install = (orbit: 'spherical' | 'trackball' = 'spherical') =>
    createGestureRecogniser(element, {
      driver: () => fake.driver,
      guard: () => guards.zoo,
      orbit: () => orbit,
      pixelRatio: () => 2,
    })

  beforeEach(() => {
    fake = createFakeDriver()
    element = createElement()
    dispose = install()
  })

  it('reports a drag as start, moves, and end', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 100, clientY: 50 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, clientX: 120, clientY: 60 })
    )
    element.dispatchEvent(pointer('pointerup', { clientX: 130, clientY: 70 }))

    expect(fake.gestures.map((g) => `${g.phase}:${g.kind}`)).toEqual([
      'start:rotate',
      'move:rotate',
      'end:rotate',
    ])
  })

  it('reports the position in the element’s own pixels, with its size', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 300, clientY: 145 })
    )

    // Element-relative, and *not* mapped into any renderer's space: which space
    // that is depends on the renderer, so the size it was measured against
    // travels along instead.
    expect(fake.gestures[0].at).toEqual({
      x: 250,
      y: 125,
      viewport: { width: 500, height: 250 },
    })
  })

  it('does not rate-limit moves', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    for (let i = 0; i < 10; i += 1) {
      element.dispatchEvent(
        pointer('pointermove', { buttons: RIGHT, clientX: 100 + i })
      )
    }

    // A renderer in this process wants every frame. Throttling here would
    // impose the streamed engine's cost on one that does not have it.
    expect(fake.gestures.filter((g) => g.phase === 'move')).toHaveLength(10)
  })

  it('asks the guards what a gesture means', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: 1 }))
    expect(fake.gestures).toEqual([])

    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, shiftKey: true })
    )
    expect(fake.gestures[0].kind).toBe('pan')
  })

  it('drops everything while nothing is rendering', () => {
    fake.readyValue.value = false
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }))

    // A viewport with no renderer is not broken; it is a viewport with nothing
    // in it.
    expect(fake.gestures).toEqual([])
    expect(fake.zooms).toEqual([])
  })

  it('works with no driver at all', () => {
    dispose()
    dispose = createGestureRecogniser(element, {
      driver: () => undefined,
      guard: () => guards.zoo,
      orbit: () => 'spherical',
    })

    expect(() =>
      element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    ).not.toThrow()
  })

  it('captures the pointer so a drag can leave the element', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(element.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('ignores a move that belongs to another pointer', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, pointerId: 1 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, pointerId: 9 })
    )

    expect(fake.gestures.filter((g) => g.phase === 'move')).toEqual([])
  })

  it('ends a drag that was cancelled', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    element.dispatchEvent(pointer('pointercancel', { pointerId: 1 }))
    expect(fake.gestures.at(-1)?.phase).toBe('end')
  })

  it('sends a trackball orbit when that is the preference', () => {
    dispose()
    dispose = install('trackball')
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(fake.gestures[0].kind).toBe('rotatetrackball')
  })

  it('treats a touch as an orbit', () => {
    // Touch has no buttons or modifiers to read, so the guards cannot answer.
    element.dispatchEvent(
      pointer('pointerdown', { pointerType: 'touch', clientX: 300 })
    )
    expect(fake.gestures[0].kind).toBe('rotate')
  })

  it('zooms on a scroll, scaled by the device pixel ratio', () => {
    const wheel = new WheelEvent('wheel', { deltaY: 40, cancelable: true })
    element.dispatchEvent(wheel)

    expect(fake.zooms[0].magnitude).toBe(-20)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('closes off a drag interrupted by the viewport unmounting', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    dispose()

    // Otherwise a renderer keeps orbiting against a pointer that is gone.
    expect(fake.gestures.at(-1)?.phase).toBe('end')
  })

  it('stops listening once disposed', () => {
    dispose()
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(fake.gestures).toEqual([])
  })
})
