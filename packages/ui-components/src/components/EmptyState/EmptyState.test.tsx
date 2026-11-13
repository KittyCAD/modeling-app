import { EmptyState } from './EmptyState'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(cleanup)

it('renders caller-owned content and an actionable invitation', () => {
  const create = vi.fn()
  render(
    <EmptyState
      icon={<span>+</span>}
      action={<button onClick={create}>Create drawing</button>}
    >
      Start a drawing
    </EmptyState>
  )
  expect(screen.getByRole('heading', { name: 'Start a drawing' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Create drawing' }))
  expect(create).toHaveBeenCalledOnce()
})
