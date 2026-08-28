import { describe, expect, it, vi } from 'vitest'
import {
  createClickRecogniser,
  selectionModeFor,
} from '@src/features/selection/createClickRecogniser'

const pointer = (
  type: string,
  init: {
    clientX?: number
    clientY?: number
    button?: number
    pointerId?: number
  } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  return event as unknown as PointerEvent
}

function setup() {
  const element = document.createElement('div')
  const clicks: PointerEvent[] = []
  const dispose = createClickRecogniser(element, {
    onClick: (event) => clicks.push(event),
  })
  return { element, clicks, dispose }
}

describe('recognising a click on the scene', () => {
  it('reports a press and release in the same place', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 60 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 60 }))

    expect(clicks).toHaveLength(1)
  })

  it('allows a little movement, as a hand does', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 60 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 102, clientY: 61 }))

    expect(clicks).toHaveLength(1)
  })

  /**
   * The reason for the distance check: without it, the last frame of an orbit
   * selects whatever the pointer happened to end up over.
   */
  it('is not a click when the pointer travelled', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 60 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 180, clientY: 90 }))

    expect(clicks).toEqual([])
  })

  /** Right and middle belong to the camera under every convention. */
  it('ignores anything but the primary button', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(
      pointer('pointerdown', { clientX: 10, clientY: 10, button: 2 })
    )
    element.dispatchEvent(
      pointer('pointerup', { clientX: 10, clientY: 10, button: 2 })
    )

    expect(clicks).toEqual([])
  })

  it('forgets a press that was cancelled', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(pointer('pointercancel'))
    element.dispatchEvent(pointer('pointerup'))

    expect(clicks).toEqual([])
  })

  it('ignores a release from a different pointer', () => {
    const { element, clicks } = setup()

    element.dispatchEvent(pointer('pointerdown', { pointerId: 1 }))
    element.dispatchEvent(pointer('pointerup', { pointerId: 2 }))

    expect(clicks).toEqual([])
  })

  it('stops listening when disposed', () => {
    const { element, clicks, dispose } = setup()
    dispose()

    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(pointer('pointerup'))

    expect(clicks).toEqual([])
  })
})

describe('what the modifiers mean', () => {
  it('adds with shift and removes with alt', () => {
    expect(selectionModeFor({ shiftKey: false, altKey: false })).toBe('replace')
    expect(selectionModeFor({ shiftKey: true, altKey: false })).toBe('add')
    expect(selectionModeFor({ shiftKey: false, altKey: true })).toBe('remove')
  })

  it('lets remove win, since it is the more specific intent', () => {
    expect(selectionModeFor({ shiftKey: true, altKey: true })).toBe('remove')
  })
})
