import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders with the default semantic attributes', () => {
    render(<Button>Create project</Button>)

    const button = screen.getByRole('button', { name: 'Create project' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-tone', 'primary')
    expect(button).toHaveAttribute('data-emphasis', 'solid')
  })

  it('fires click handlers and renders visuals', () => {
    const onClick = vi.fn()

    render(
      <Button
        onClick={onClick}
        leadingVisual={<span>+</span>}
        trailingVisual={<span>{'>'}</span>}
      >
        Add panel
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Add panel' })
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('>')).toBeInTheDocument()
  })

  it('marks full-width buttons for layout styling', () => {
    render(<Button fullWidth>Export</Button>)

    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute(
      'data-full-width',
      'true'
    )
  })
})
