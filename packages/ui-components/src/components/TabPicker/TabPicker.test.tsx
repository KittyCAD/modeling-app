import { TabPicker } from './TabPicker'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'

afterEach(cleanup)

it('chooses a portaled option without invoking tab keyboard navigation, then restores trigger focus', async () => {
  const tabNavigation = vi.fn()
  function Example() {
    const [value, setValue] = useState('code')
    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Simulate the parent tab strip keyboard listener.
      <div onKeyDown={tabNavigation}>
        <TabPicker
          label="Mode for notes"
          value={value}
          onChange={setValue}
          options={[
            { id: 'code', label: 'Code' },
            { id: 'preview', label: 'Preview' },
          ]}
        />
      </div>
    )
  }
  const { container } = render(<Example />)
  const trigger = screen.getByRole('button', { name: 'Mode for notes' })
  fireEvent.click(trigger)
  const preview = await screen.findByRole('button', { name: 'Preview' })
  expect(container).not.toContainElement(preview)
  fireEvent.keyDown(preview, { key: 'ArrowRight' })
  expect(tabNavigation).not.toHaveBeenCalled()
  fireEvent.click(preview)
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Preview' })
    ).not.toBeInTheDocument()
  )
  expect(trigger).toHaveTextContent('Preview')
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  const code = await screen.findByRole('button', { name: 'Code' })
  code.focus()
  fireEvent.keyDown(code, { key: 'Escape' })
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(trigger).toHaveTextContent('Preview')
})

it('shows a passive label for one available choice and caller-provided copy when none match', () => {
  const { rerender } = render(
    <TabPicker
      label="Renderer"
      value="code"
      options={[{ id: 'code', label: 'Code' }]}
      onChange={vi.fn()}
    />
  )
  expect(screen.getByText('Code')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  rerender(
    <TabPicker
      label="Renderer"
      value={undefined}
      options={[]}
      placeholder="Choose a renderer"
      onChange={vi.fn()}
    />
  )
  expect(screen.getByText('Choose a renderer')).toBeVisible()
})
