import { Tabs, type TabItem } from '@src/components/Tabs'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(cleanup)

it('supports controlled tabs without close actions and preserves inactive panel state', () => {
  const first = Symbol('preview')
  const second = Symbol('preview')
  const items: TabItem<symbol>[] = [
    {
      id: first,
      label: 'Preview',
      title: 'First preview',
      renderPanel: () => (
        <input aria-label="First input" defaultValue="first" />
      ),
    },
    {
      id: second,
      label: 'Preview',
      title: 'Second preview',
      renderPanel: () => (
        <input aria-label="Second input" defaultValue="second" />
      ),
    },
  ]
  function Example() {
    const [selectedId, setSelectedId] = useState<symbol>(first)
    return (
      <Tabs
        label="Previews"
        items={items}
        selectedId={selectedId}
        onChange={setSelectedId}
      />
    )
  }
  render(<Example />)
  expect(screen.getByRole('tablist', { name: 'Previews' })).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: 'First input' })
  fireEvent.change(input, { target: { value: 'unsaved' } })
  const tabs = screen.getAllByRole('tab', { name: 'Preview' })
  act(() => tabs[0].focus())
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
  expect(tabs[1]).toHaveFocus()
  expect(screen.getByRole('textbox', { name: 'Second input' })).toBeVisible()
  expect(input).toBeInTheDocument()
  expect(input).not.toBeVisible()
  fireEvent.keyDown(tabs[1], { key: 'Delete' })
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' })
  expect(screen.getByRole('textbox', { name: 'First input' })).toBe(input)
  expect(input).toHaveValue('unsaved')
})

it('places prefix and postfix controls outside the tab list and its selection behavior', () => {
  const change = vi.fn()
  const picker = vi.fn()
  const add = vi.fn()
  render(
    <Tabs
      label="Documents"
      selectedId="one"
      onChange={change}
      prefix={
        <button type="button" onClick={picker}>
          Files
        </button>
      }
      postfix={
        <button type="button" onClick={add}>
          Add
        </button>
      }
      items={[{ id: 'one', label: 'One', renderPanel: () => <p>Document</p> }]}
    />
  )
  const list = screen.getByRole('tablist', { name: 'Documents' })
  const prefix = screen.getByRole('button', { name: 'Files' })
  const postfix = screen.getByRole('button', { name: 'Add' })
  expect(list).not.toContainElement(prefix)
  expect(list).not.toContainElement(postfix)
  expect(
    prefix.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    list.compareDocumentPosition(postfix) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  fireEvent.click(prefix)
  fireEvent.click(postfix)
  expect(picker).toHaveBeenCalledOnce()
  expect(add).toHaveBeenCalledOnce()
  expect(change).not.toHaveBeenCalled()
})

it('keeps strip actions available when there are no tabs', () => {
  const add = vi.fn()
  render(
    <Tabs
      label="Documents"
      items={[]}
      selectedId={null}
      onChange={vi.fn()}
      prefix={<button type="button">Files</button>}
      postfix={
        <button type="button" onClick={add}>
          Add
        </button>
      }
      emptyState={<p>No documents.</p>}
    />
  )
  expect(screen.getByText('No documents.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Files' })).toBeVisible()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(add).toHaveBeenCalledOnce()
})
