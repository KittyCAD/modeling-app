import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'

function TestMenu() {
  const targetRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={targetRef}>Open menu</button>
      <ContextMenu
        menuTargetElement={targetRef}
        data-testid="context-menu"
        items={[<ContextMenuItem key="reset">Reset view</ContextMenuItem>]}
      />
    </>
  )
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1000)
  vi.stubGlobal('innerHeight', 500)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 208, 440)
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test.each([
  { x: 10, y: 20, top: 20, left: 10 },
  { x: 10, y: 180, top: 60, left: 10 },
  { x: 980, y: 480, top: 60, left: 792 },
])('keeps the menu in the viewport when opened at ($x, $y)', async (point) => {
  render(<TestMenu />)
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Open menu' }), {
    clientX: point.x,
    clientY: point.y,
  })

  const menu = await screen.findByTestId('context-menu')
  await waitFor(() =>
    expect(menu.parentElement).toHaveStyle({
      top: `${point.top}px`,
      left: `${point.left}px`,
    })
  )
})

test('repositions an open menu when the viewport shrinks', async () => {
  vi.stubGlobal('innerHeight', 800)
  render(<TestMenu />)
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Open menu' }), {
    clientX: 10,
    clientY: 180,
  })

  const menu = await screen.findByTestId('context-menu')
  await waitFor(() => expect(menu.parentElement).toHaveStyle({ top: '180px' }))

  vi.stubGlobal('innerHeight', 500)
  fireEvent.resize(window)

  await waitFor(() => expect(menu.parentElement).toHaveStyle({ top: '60px' }))
})
