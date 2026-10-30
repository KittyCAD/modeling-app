import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineOperationRow } from './InlineOperationRow'

describe('inline editor controls', () => {
  it('keeps feature selection and double-click editing on the main row', () => {
    const reveal = vi.fn()
    const edit = vi.fn()
    render(
      <InlineOperationRow
        icon="extrude"
        label="mountingPlate"
        detail="Extrude"
        onClick={reveal}
        onDoubleClick={edit}
      />
    )
    const row = screen.getByRole('button', { name: 'mountingPlate Extrude' })
    fireEvent.click(row)
    fireEvent.doubleClick(row)
    expect(reveal).toHaveBeenCalledOnce()
    expect(edit).toHaveBeenCalledOnce()
  })
  it('keeps visibility and source disclosure independent from feature editing', () => {
    const select = vi.fn()
    const visibility = vi.fn()
    const toggleCode = vi.fn()
    render(
      <InlineOperationRow
        icon="plane"
        label="Front plane"
        detail="XZ"
        onClick={select}
        visibility={{ visible: false, onVisibilityChange: visibility }}
        disclosure={{ expanded: true, onToggle: toggleCode }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Front plane' }))
    const code = screen.getByRole('button', { name: 'Hide Front plane code' })
    expect(code.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(code)
    expect(visibility).toHaveBeenCalledOnce()
    expect(toggleCode).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
  })
})
