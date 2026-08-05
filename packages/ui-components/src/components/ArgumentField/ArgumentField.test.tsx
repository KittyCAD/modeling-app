import { ArgumentField } from '@kittycad/ui-components'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const selectionItems = [{ id: 'face-1', label: 'Face 1' }]

describe('ArgumentField', () => {
  test('starts selection only after explicit activation', () => {
    const onStartSelecting = vi.fn()
    const props = {
      name: 'objects',
      inputType: 'selectionMixed' as const,
      label: 'Objects',
      isRequired: true,
      value: undefined,
      selectionItems,
      onChange: vi.fn(),
      onStartSelecting,
    }

    const { rerender } = render(<ArgumentField {...props} />)
    const collector = screen.getByRole('button', { name: 'Select Objects' })

    fireEvent.focus(collector)
    expect(onStartSelecting).not.toHaveBeenCalled()

    fireEvent.click(collector)
    expect(onStartSelecting).toHaveBeenCalledTimes(1)

    rerender(
      <ArgumentField {...props} isSelecting currentSelectionLabel="1 face" />
    )

    expect(collector).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Selecting: 1 face')).toHaveAttribute(
      'aria-live',
      'polite'
    )
  })

  test('keeps captured selections visible without redundant read-only copy', () => {
    render(
      <ArgumentField
        name="objects"
        inputType="selectionMixed"
        label="Objects"
        isRequired
        disabled
        value={undefined}
        selectionItems={selectionItems}
        onChange={vi.fn()}
        onStartSelecting={vi.fn()}
        onRemoveSelection={vi.fn()}
        onClearSelection={vi.fn()}
      />
    )

    expect(screen.queryByText('Read only')).not.toBeInTheDocument()
    expect(screen.getByText('Face 1')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Select Objects' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Clear' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove selection 1' })
    ).not.toBeInTheDocument()
  })

  test('renders a compact selection as a single geometry row', () => {
    render(
      <ArgumentField
        name="profiles"
        inputType="selection"
        label="Profiles"
        isRequired
        compactSelection
        hideLabel
        value={undefined}
        selectionItems={selectionItems}
        onChange={vi.fn()}
        onStartSelecting={vi.fn()}
      />
    )

    expect(screen.getByText('Face 1')).toBeVisible()
    expect(screen.queryByText('Profiles')).not.toBeInTheDocument()
    expect(screen.queryByText('Captured')).not.toBeInTheDocument()
    expect(screen.queryByText(/Click to change/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select Profiles' })
    ).toBeVisible()
  })
})
