import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EngineConnection,
  EngineConnectionState,
  SceneCommand,
} from '@src/contracts/engine'
import { createCameraInteraction } from '@src/features/engineScene/camera/createCameraInteraction'
import { cameraMouseGuards } from '@src/features/engineScene/camera/mouseGuards'

const guards = cameraMouseGuards('MacIntel')

function createFakeConnection() {
  const status = signal<EngineConnectionState['status']>('connected')
  const sent: SceneCommand[] = []

  const connection = {
    state: computed(() => ({
      status: status.value,
      stage: null,
      error: null,
      pingMs: 12,
      apiCallId: null,
    })),
    viewportSize: computed(() => ({ width: 1000, height: 500 })),
    fireCommand: (cmd: SceneCommand) => {
      sent.push(cmd)
    },
  } as unknown as EngineConnection

  return { connection, sent, status }
}

/**
 * A stand-in for the video element.
 *
 * jsdom has no layout, so `getBoundingClientRect` is stubbed: the mapping from
 * element pixels to stream pixels is the whole point of the coordinate code, and
 * a zero-sized rect would test nothing.
 */
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

describe('createCameraInteraction', () => {
  let fake: ReturnType<typeof createFakeConnection>
  let element: HTMLElement
  let dispose: () => void

  const install = (orbit: 'spherical' | 'trackball' = 'spherical') =>
    createCameraInteraction(element, {
      connection: fake.connection,
      guard: () => guards.zoo,
      orbit: () => orbit,
      pixelRatio: () => 2,
    })

  beforeEach(() => {
    vi.useFakeTimers()
    fake = createFakeConnection()
    element = createElement()
    dispose = install()
  })

  it('starts a drag with the interaction the guards chose', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 300, clientY: 145 })
    )

    expect(fake.sent).toEqual([
      {
        type: 'camera_drag_start',
        interaction: 'rotate',
        // (300-50)/500 * 1000 = 500, (145-20)/250 * 500 = 250.
        window: { x: 500, y: 250 },
      },
    ])
  })

  it('maps element pixels onto the stream’s pixels', () => {
    // The panel is almost never the size the engine renders at, so a click in
    // the middle of the element has to arrive as the middle of the frame.
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 550, clientY: 270 })
    )

    expect(fake.sent[0].window).toEqual({ x: 1000, y: 500 })
  })

  it('captures the pointer so a drag can leave the element', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(element.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('ignores a gesture the guards do not recognise', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: 1 }))
    expect(fake.sent).toEqual([])
  })

  it('does nothing while the engine is not connected', () => {
    fake.status.value = 'offline'
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(fake.sent).toEqual([])
  })

  it('throttles moves, and still reports the last position', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 100, clientY: 50 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, clientX: 110, clientY: 50 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, clientX: 120, clientY: 50 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, clientX: 130, clientY: 50 })
    )

    const moves = () =>
      fake.sent.filter((cmd) => cmd.type === 'camera_drag_move')
    // The engine re-renders and re-streams a frame per move, so a burst is
    // collapsed rather than queued behind the pointer.
    expect(moves()).toHaveLength(1)

    vi.advanceTimersByTime(100)
    // The trailing edge lands where the pointer actually finished.
    expect(moves()).toHaveLength(2)
    expect(moves()[1].window).toEqual({ x: 160, y: 60 })
  })

  it('ends a drag where the pointer was released', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, clientX: 100, clientY: 50 })
    )
    element.dispatchEvent(
      pointer('pointerup', { clientX: 300, clientY: 145, pointerId: 1 })
    )

    const end = fake.sent.at(-1)
    expect(end?.type).toBe('camera_drag_end')
    expect(end?.interaction).toBe('rotate')
    expect(end?.window).toEqual({ x: 500, y: 250 })
  })

  it('ends a drag that was cancelled', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    element.dispatchEvent(pointer('pointercancel', { pointerId: 1 }))
    expect(fake.sent.at(-1)?.type).toBe('camera_drag_end')
  })

  it('ignores a move that belongs to another pointer', () => {
    element.dispatchEvent(
      pointer('pointerdown', { buttons: RIGHT, pointerId: 1 })
    )
    element.dispatchEvent(
      pointer('pointermove', { buttons: RIGHT, pointerId: 9 })
    )
    vi.advanceTimersByTime(200)

    expect(fake.sent.filter((cmd) => cmd.type === 'camera_drag_move')).toEqual(
      []
    )
  })

  it('ignores a move when nothing is being dragged', () => {
    element.dispatchEvent(pointer('pointermove', { buttons: RIGHT }))
    vi.advanceTimersByTime(200)
    expect(fake.sent).toEqual([])
  })

  it('sends a trackball orbit when that is the preference', () => {
    dispose()
    dispose = install('trackball')
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(fake.sent[0].interaction).toBe('rotatetrackball')
  })

  it('treats a touch as an orbit', () => {
    // Touch has no buttons or modifiers to read, so the guards cannot answer.
    element.dispatchEvent(
      pointer('pointerdown', {
        pointerType: 'touch',
        clientX: 300,
        clientY: 145,
      })
    )
    expect(fake.sent[0]).toMatchObject({
      type: 'camera_drag_start',
      interaction: 'rotate',
    })
  })

  it('zooms on a scroll, scaled by the device pixel ratio', () => {
    const wheel = new WheelEvent('wheel', { deltaY: 40, cancelable: true })
    element.dispatchEvent(wheel)

    expect(fake.sent).toEqual([{ type: 'default_camera_zoom', magnitude: -20 }])
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('closes off a drag interrupted by the viewport unmounting', () => {
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    dispose()

    // Otherwise the engine keeps orbiting against a pointer that is gone.
    expect(fake.sent.at(-1)?.type).toBe('camera_drag_end')
  })

  it('stops listening once disposed', () => {
    dispose()
    element.dispatchEvent(pointer('pointerdown', { buttons: RIGHT }))
    expect(fake.sent).toEqual([])
  })
})
