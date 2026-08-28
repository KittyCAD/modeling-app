import { createRef, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContextMenu,
  type ContextMenuController,
  type ContextMenuOpenRequest,
  fitContextMenuPosition,
} from './contextMenu'

let host: HTMLDivElement | null = null

function mount(node: preact.ComponentChild) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => render(node, host as HTMLDivElement))
  return host
}

function secondaryClick(element: Element, x = 40, y = 60) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  })
  act(() => {
    element.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  if (host) {
    render(null, host)
  }
  host?.remove()
  host = null
})

describe('ContextMenu', () => {
  it('opens at a secondary click and runs the selected item', () => {
    const selected = vi.fn()
    const element = mount(
      <ContextMenu
        label="Test actions"
        sections={[
          {
            id: 'actions',
            items: [{ id: 'fit', label: 'Zoom to fit', onSelect: selected }],
          },
        ]}
        target={(props) => <button {...props}>Model</button>}
      />
    )

    const event = secondaryClick(element.querySelector('button') as Element)
    expect(event.defaultPrevented).toBe(true)
    expect(element.querySelector('[role="menu"]')).not.toBeNull()

    act(() => {
      ;(element.querySelector('[role="menuitem"]') as HTMLButtonElement).click()
    })
    expect(selected).toHaveBeenCalledOnce()
    expect(element.querySelector('[role="menu"]')).toBeNull()
  })

  it('resolves contextual sections at the moment it opens', () => {
    const sections = vi.fn((_request: ContextMenuOpenRequest) => [
      { id: 'file', items: [{ id: 'delete', label: 'Delete' }] },
    ])
    const element = mount(
      <ContextMenu
        label="File actions"
        sections={sections}
        target={(props) => <button {...props}>main.kcl</button>}
      />
    )

    secondaryClick(element.querySelector('button') as Element, 12, 24)
    expect(sections).toHaveBeenCalledOnce()
    expect(sections.mock.calls[0]?.[0].clientX).toBe(12)
  })

  it('can be opened after a target-specific gesture recognizer accepts', () => {
    const controller = createRef<ContextMenuController>()
    const element = mount(
      <ContextMenu
        controllerRef={controller}
        label="Scene actions"
        sections={[
          { id: 'view', items: [{ id: 'fit', label: 'Zoom to fit' }] },
        ]}
        target={(props) => <button {...props}>Scene</button>}
      />
    )
    const target = element.querySelector('button') as HTMLButtonElement

    act(() => {
      controller.current?.open({ clientX: 80, clientY: 90, target })
    })

    expect(element.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('skips disabled entries during keyboard navigation', () => {
    const disabled = vi.fn()
    const selected = vi.fn()
    const element = mount(
      <ContextMenu
        label="Actions"
        sections={[
          {
            id: 'actions',
            items: [
              {
                id: 'off',
                label: 'Unavailable',
                disabled: true,
                onSelect: disabled,
              },
              { id: 'on', label: 'Available', onSelect: selected },
            ],
          },
        ]}
        target={(props) => <button {...props}>Target</button>}
      />
    )

    secondaryClick(element.querySelector('button') as Element)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    expect(disabled).not.toHaveBeenCalled()
    expect(selected).toHaveBeenCalledOnce()
  })

  it('opens with disabled-only contents so unavailability stays visible', () => {
    const element = mount(
      <ContextMenu
        label="Actions"
        sections={[
          {
            id: 'actions',
            items: [{ id: 'fit', label: 'Zoom to fit', disabled: true }],
          },
        ]}
        target={(props) => <button {...props}>Target</button>}
      />
    )

    secondaryClick(element.querySelector('button') as Element)
    expect(
      (element.querySelector('[role="menuitem"]') as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('uses the outside layer only to dismiss', () => {
    const selected = vi.fn()
    const element = mount(
      <ContextMenu
        label="Actions"
        sections={[
          {
            id: 'actions',
            items: [{ id: 'fit', label: 'Zoom to fit', onSelect: selected }],
          },
        ]}
        target={(props) => <button {...props}>Target</button>}
      />
    )

    secondaryClick(element.querySelector('button') as Element)
    act(() => {
      ;(
        element.querySelector(
          '[aria-label="Dismiss context menu"]'
        ) as HTMLButtonElement
      ).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(element.querySelector('[role="menu"]')).toBeNull()
    expect(selected).not.toHaveBeenCalled()
  })
})

describe('fitContextMenuPosition', () => {
  it('moves an overflowing menu back inside the viewport', () => {
    expect(
      fitContextMenuPosition(
        { x: 290, y: 190 },
        { width: 100, height: 80 },
        { width: 300, height: 200 }
      )
    ).toEqual({ x: 196, y: 116 })
  })
})
