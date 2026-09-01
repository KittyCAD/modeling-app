import { AiPaneToggleButton } from '@src/lib/aiFirstCad/AiPaneToggleButton'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

it('toggles a visible AI side pane', () => {
  const onClick = vi.fn()
  render(
    <AiPaneToggleButton
      collapsed={false}
      label="Projects"
      onClick={onClick}
      side="left"
    />
  )

  const button = screen.getByRole('button', { name: 'Hide Projects' })
  expect(button).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
})

it('offers to show a collapsed AI side pane', () => {
  render(
    <AiPaneToggleButton
      collapsed={true}
      label="Canvas"
      onClick={() => {}}
      side="right"
    />
  )

  expect(screen.getByRole('button', { name: 'Show Canvas' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
})
