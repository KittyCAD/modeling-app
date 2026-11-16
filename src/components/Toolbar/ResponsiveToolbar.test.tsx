import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ResponsiveToolbar } from '@src/components/Toolbar/ResponsiveToolbar'
import type { ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'
import type { ToolbarNode } from '@src/components/Toolbar/groups'

let available = 500
const callbacks = new Set<() => void>()
beforeEach(() => {
  available = 500
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void
      constructor(callback: ResizeObserverCallback) {
        this.callback = () => callback([], this)
        callbacks.add(this.callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback)
      }
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const probe = this.closest<HTMLElement>('[data-toolbar-measure]')
      const width = this.hasAttribute('data-responsive-toolbar')
        ? available
        : probe
          ? probe.dataset.toolbarMeasure?.startsWith('group:')
            ? 50
            : 40
          : 0
      return {
        width,
        height: 30,
        top: 0,
        left: 0,
        right: width,
        bottom: 30,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  callbacks.clear()
})
function resize(width: number) {
  available = width
  act(() => {
    for (const callback of callbacks) callback()
  })
}
function action(id: string): ToolbarViewItem {
  return {
    id,
    title: id,
    description: `Use ${id}`,
    status: 'available',
    icon: 'extrude',
    links: [],
    onClick: vi.fn(),
  }
}
function fixture() {
  const circle = action('Circle'),
    extrude = action('Extrude'),
    loft = action('Loft'),
    locked = { ...action('Locked'), disabled: true }
  const items: ToolbarNode[] = [
    {
      id: 'model',
      title: 'Modeling',
      children: [
        { id: 'sketch', title: 'Sketch', children: [circle] },
        { id: 'solid', title: 'Solids', children: [extrude, loft, locked] },
      ],
    },
  ]
  render(<ResponsiveToolbar items={items} platform="linux" mode="modeling" />)
  return { circle, extrude, loft, locked }
}
it('keeps the most recent tool after collapsing, expanding, and collapsing again', () => {
  const { loft } = fixture()
  fireEvent.click(screen.getByRole('button', { name: 'Loft' }))
  screen.getByRole('button', { name: 'Loft' }).focus()
  resize(140)
  expect(screen.getByRole('button', { name: 'Loft' })).toHaveFocus()
  expect(
    screen.queryByRole('button', { name: 'Extrude' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Loft' }))
  expect(loft.onClick).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Loft' })).toHaveFocus()
  resize(500)
  expect(screen.getByRole('button', { name: 'Loft' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Extrude' })).toBeInTheDocument()
  resize(140)
  expect(screen.getByRole('button', { name: 'Loft' })).toBeInTheDocument()
})
it('navigates nested groups by keyboard and invokes a leaf without allowing disabled commands', () => {
  const { loft, locked } = fixture()
  resize(65)
  const toggle = screen.getByRole('button', { name: /Modeling: open menu/ })
  fireEvent.click(toggle)
  const solids = screen.getByRole('menuitem', { name: 'Solids' })
  fireEvent.mouseEnter(solids)
  fireEvent.keyDown(solids, { key: 'ArrowRight' })
  const loftItem = screen.getByRole('menuitem', { name: /Loft/ })
  expect(screen.getByRole('menuitem', { name: /Extrude/ })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Extrude/ }), {
    key: 'ArrowDown',
  })
  expect(loftItem).toHaveFocus()
  fireEvent.keyDown(loftItem, { key: 'ArrowLeft' })
  expect(solids).toHaveFocus()
  fireEvent.keyDown(solids, { key: 'ArrowRight' })
  fireEvent.click(screen.getByRole('menuitem', { name: /Locked/ }))
  expect(locked.onClick).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitem', { name: /Loft/ }))
  expect(loft.onClick).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Loft' })).toBeInTheDocument()
  resize(140)
  expect(
    screen.getByRole('button', { name: /Solids: open menu/ })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Loft' })).toBeInTheDocument()
})
it('defers resize layout while a menu is open and restores focus on Escape', () => {
  fixture()
  resize(65)
  const toggle = screen.getByRole('button', { name: /Modeling: open menu/ })
  fireEvent.click(toggle)
  resize(500)
  expect(screen.getByRole('menuitem', { name: 'Solids' })).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Solids' }), {
    key: 'Escape',
  })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Circle' })).toHaveFocus()
  expect(
    within(screen.getByTestId('toolbar')).getByRole('button', {
      name: 'Extrude',
    })
  ).toBeInTheDocument()
})
