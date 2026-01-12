import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import Draggable from '@src/components/Draggable'

const createRect = (rect: Partial<DOMRect>): DOMRect => {
  const width = rect.width ?? 0
  const height = rect.height ?? 0
  const left = rect.left ?? 0
  const top = rect.top ?? 0
  return {
    x: rect.x ?? left,
    y: rect.y ?? top,
    width,
    height,
    top,
    left,
    right: rect.right ?? left + width,
    bottom: rect.bottom ?? top + height,
    toJSON: () => {},
  } satisfies DOMRect
}

const mockComputedStyle = (overrides?: Partial<CSSStyleDeclaration>) =>
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    marginBlockStart: '0px',
    marginBlockEnd: '0px',
    marginInlineStart: '0px',
    marginInlineEnd: '0px',
    ...overrides,
  } as CSSStyleDeclaration)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Draggable', () => {
  test('drags within container bounds without jumping', () => {
    const container = document.createElement('div')
    const containerRef = { current: container }
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 0, left: 0, width: 200, height: 200 })
    )
    mockComputedStyle()

    render(
      <Draggable containerRef={containerRef} data-testid="draggable">
        Drag me
      </Draggable>
    )

    const draggable = screen.getByTestId('draggable')
    vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 50, left: 60, width: 40, height: 30 })
    )

    fireEvent.mouseDown(draggable, {
      clientX: 70,
      clientY: 70,
      offsetX: 10,
      offsetY: 20,
    })
    fireEvent.mouseMove(document, { clientX: 70, clientY: 70 })

    expect(draggable.style.top).toBe('50px')
    expect(draggable.style.left).toBe('60px')

    fireEvent.mouseMove(document, { clientX: 500, clientY: 500 })

    expect(draggable.style.top).toBe('170px')
    expect(draggable.style.left).toBe('160px')
  })

  test('accounts for margins without jumping on first drag', () => {
    mockComputedStyle({
      marginBlockStart: '8px',
      marginBlockEnd: '4px',
      marginInlineStart: '6px',
      marginInlineEnd: '2px',
    })

    render(<Draggable data-testid="draggable">Drag me</Draggable>)

    const draggable = screen.getByTestId('draggable')
    vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 100, left: 120, width: 30, height: 20 })
    )
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 0, left: 0, width: 500, height: 500 })
    )

    fireEvent.mouseDown(draggable, {
      clientX: 130,
      clientY: 115,
      offsetX: 10,
      offsetY: 15,
    })
    // It should account for both the margin and the offset here
    expect(draggable.style.top).toBe(`${115 - 15 - 8}px`)
    fireEvent.mouseMove(document, { clientX: 130, clientY: 115 })

    expect(draggable.style.top).toBe('92px')
    expect(draggable.style.left).toBe('114px')
  })

  test('stops dragging on visibilitychange', () => {
    mockComputedStyle()
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 0, left: 0, width: 300, height: 300 })
    )

    render(<Draggable data-testid="draggable">Drag me</Draggable>)

    const draggable = screen.getByTestId('draggable')
    vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 20, left: 20, width: 40, height: 40 })
    )

    fireEvent.mouseDown(draggable, {
      clientX: 30,
      clientY: 30,
      offsetX: 10,
      offsetY: 10,
    })
    fireEvent.mouseMove(document, { clientX: 80, clientY: 80 })

    const settledTop = draggable.style.top
    const settledLeft = draggable.style.left

    fireEvent(document, new Event('visibilitychange'))
    fireEvent.mouseMove(document, { clientX: 140, clientY: 140 })

    expect(draggable.style.top).toBe(settledTop)
    expect(draggable.style.left).toBe(settledLeft)
  })

  test('stops dragging on mouseleave', () => {
    mockComputedStyle()
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 0, left: 0, width: 300, height: 300 })
    )

    render(<Draggable data-testid="draggable">Drag me</Draggable>)

    const draggable = screen.getByTestId('draggable')
    vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 20, left: 20, width: 40, height: 40 })
    )

    fireEvent.mouseDown(draggable, {
      clientX: 30,
      clientY: 30,
      offsetX: 10,
      offsetY: 10,
    })
    expect(draggable.style.top).toBe(`${30 - 10}px`)
    fireEvent.mouseMove(document, { clientX: 80, clientY: 80 })

    const settledTop = draggable.style.top
    const settledLeft = draggable.style.left

    fireEvent.mouseLeave(document)
    fireEvent.mouseMove(document, { clientX: 160, clientY: 160 })

    expect(draggable.style.top).toBe(settledTop)
    expect(draggable.style.left).toBe(settledLeft)
  })

  test('falls back to document.body when no containerRef is provided', () => {
    mockComputedStyle()
    const bodyRectSpy = vi
      .spyOn(document.body, 'getBoundingClientRect')
      .mockReturnValue(createRect({ top: 0, left: 0, width: 150, height: 150 }))

    render(<Draggable data-testid="draggable">Drag me</Draggable>)

    const draggable = screen.getByTestId('draggable')
    vi.spyOn(draggable, 'getBoundingClientRect').mockReturnValue(
      createRect({ top: 10, left: 10, width: 60, height: 60 })
    )

    fireEvent.mouseDown(draggable, {
      clientX: 20,
      clientY: 20,
      offsetX: 10,
      offsetY: 10,
    })
    expect(draggable.style.top).toBe(`${20 - 10}px`)
    fireEvent.mouseMove(document, { clientX: 400, clientY: 400 })

    expect(bodyRectSpy).toHaveBeenCalled()
    expect(draggable.style.top).toBe('90px')
    expect(draggable.style.left).toBe('90px')
  })
})
