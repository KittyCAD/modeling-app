import { signal } from '@preact/signals'
import type { CameraDriver, CameraGesture } from '@src/contracts/scene'
import { createGestureRecogniser } from '@src/features/camera/createGestureRecogniser'
import { cameraMouseGuards } from '@src/features/camera/mouseGuards'
import { createContextMenuClickRecogniser } from '@src/lib/contextMenuClickRecogniser'
import { describe, expect, it, vi } from 'vitest'

const pointer = (
  type: string,
  init: { clientX?: number; clientY?: number; buttons?: number } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: type === 'pointerdown' ? 2 : 0,
    buttons: init.buttons ?? 0,
    clientX: init.clientX ?? 20,
    clientY: init.clientY ?? 30,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  return event
}

const contextMenu = () =>
  new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 20,
    clientY: 30,
  })

function setup() {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect
  element.setPointerCapture = vi.fn()
  element.releasePointerCapture = vi.fn()
  element.hasPointerCapture = () => true

  const gestures: CameraGesture[] = []
  const driver: CameraDriver = {
    id: 'test',
    ready: signal(true),
    gesture: (gesture) => gestures.push(gesture),
    zoom: vi.fn(),
    setProjection: vi.fn(),
    standardView: vi.fn(),
    faceOn: vi.fn(),
    lookFrom: vi.fn(),
    zoomToFit: vi.fn(),
  }
  const openMenu = vi.fn()
  const guards = cameraMouseGuards('MacIntel')

  const disposeCamera = createGestureRecogniser(element, {
    driver: () => driver,
    guard: () => guards.zoo,
    orbit: () => 'spherical',
  })
  const disposeMenu = createContextMenuClickRecogniser(element, {
    onClick: openMenu,
  })

  return {
    element,
    gestures,
    openMenu,
    dispose: () => {
      disposeMenu()
      disposeCamera()
    },
  }
}

describe('scene context menu and camera interaction', () => {
  it('keeps a right drag as camera input without opening the menu', () => {
    const scene = setup()
    scene.element.dispatchEvent(pointer('pointerdown', { buttons: 2 }))
    scene.element.dispatchEvent(contextMenu())
    scene.element.dispatchEvent(
      pointer('pointermove', { clientX: 50, clientY: 60, buttons: 2 })
    )
    scene.element.dispatchEvent(
      pointer('pointerup', { clientX: 50, clientY: 60 })
    )

    expect(scene.gestures.map((gesture) => gesture.phase)).toEqual([
      'start',
      'move',
      'end',
    ])
    expect(scene.openMenu).not.toHaveBeenCalled()
    scene.dispose()
  })

  it('opens after an unmoved right click finishes its camera gesture', () => {
    const scene = setup()
    scene.element.dispatchEvent(pointer('pointerdown', { buttons: 2 }))
    scene.element.dispatchEvent(contextMenu())
    scene.element.dispatchEvent(pointer('pointerup'))

    expect(scene.gestures.map((gesture) => gesture.phase)).toEqual([
      'start',
      'end',
    ])
    expect(scene.openMenu).toHaveBeenCalledOnce()
    scene.dispose()
  })
})
