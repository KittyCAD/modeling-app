import { createContextMenuClickRecogniser } from '@src/lib/contextMenuClickRecogniser'
import { describe, expect, it, vi } from 'vitest'

const pointer = (
  type: string,
  init: {
    clientX?: number
    clientY?: number
    pointerId?: number
    pointerType?: string
  } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 20,
    clientY: init.clientY ?? 30,
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'mouse',
  })
  return event
}

const contextMenu = (clientX = 20, clientY = 30) =>
  new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX,
    clientY,
  })

function setup() {
  const element = document.createElement('div')
  const onClick = vi.fn()
  const dispose = createContextMenuClickRecogniser(element, { onClick })
  return { element, onClick, dispose }
}

describe('createContextMenuClickRecogniser', () => {
  it('waits for release when contextmenu arrives before pointerup', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    const menu = contextMenu(24, 34)
    element.dispatchEvent(menu)

    expect(menu.defaultPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()

    element.dispatchEvent(pointer('pointerup', { clientX: 24, clientY: 34 }))
    expect(onClick).toHaveBeenCalledWith({ clientX: 24, clientY: 34 })
  })

  it('opens when contextmenu arrives after an un-moved release', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(pointer('pointerup'))
    element.dispatchEvent(contextMenu(26, 36))

    expect(onClick).toHaveBeenCalledWith({ clientX: 26, clientY: 36 })
  })

  it('does not open after a drag when contextmenu arrives early', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(contextMenu())
    element.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 50 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 40, clientY: 50 }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not open after a drag when contextmenu arrives late', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 50 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 40, clientY: 50 }))
    element.dispatchEvent(contextMenu(40, 50))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('allows movement within the click slop', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(contextMenu())
    element.dispatchEvent(pointer('pointermove', { clientX: 23, clientY: 32 }))
    element.dispatchEvent(pointer('pointerup', { clientX: 23, clientY: 32 }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('drops a cancelled pointer', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(pointer('pointerdown'))
    element.dispatchEvent(contextMenu())
    element.dispatchEvent(pointer('pointercancel'))
    element.dispatchEvent(pointer('pointerup'))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('opens keyboard-originated contextmenu events immediately', () => {
    const { element, onClick } = setup()
    element.dispatchEvent(contextMenu(0, 0))
    expect(onClick).toHaveBeenCalledWith({ clientX: 0, clientY: 0 })
  })

  it('stops listening when disposed', () => {
    const { element, onClick, dispose } = setup()
    dispose()
    element.dispatchEvent(contextMenu())
    expect(onClick).not.toHaveBeenCalled()
  })
})
