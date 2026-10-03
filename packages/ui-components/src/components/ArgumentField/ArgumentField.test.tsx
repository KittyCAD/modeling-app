import { ArgumentField } from '@kittycad/ui-components'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const selectionItems = [{ id: 'face-1', label: 'Face 1' }]

describe('ArgumentField', () => {
  test.each(['select', 'segmented'] as const)(
    '%s keeps false distinct from an omitted optional boolean',
    (controlStyle) => {
      const onChange = vi.fn()
      const props = {
        name: 'symmetric',
        inputType: 'boolean' as const,
        controlStyle,
        label: 'Symmetric',
        isRequired: false,
        onChange,
      }
      const { rerender } = render(
        <ArgumentField {...props} value={undefined} />
      )
      if (controlStyle === 'segmented') {
        fireEvent.click(screen.getByRole('button', { name: 'Off' }))
      } else {
        const option = screen.getByRole<HTMLOptionElement>('option', {
          name: 'False',
        })
        fireEvent.change(screen.getByRole('combobox'), {
          target: { value: option.value },
        })
      }
      expect(onChange).toHaveBeenLastCalledWith(false)
      rerender(<ArgumentField {...props} value={false} />)
      if (controlStyle === 'segmented') {
        fireEvent.click(screen.getByRole('button', { name: 'Off' }))
      } else {
        fireEvent.change(screen.getByRole('combobox'), {
          target: { value: '' },
        })
      }
      expect(onChange).toHaveBeenLastCalledWith(undefined)
    }
  )

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
      />
    )

    expect(screen.queryByText('Read only')).not.toBeInTheDocument()
    expect(screen.getByText('Face 1')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Select Objects' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Remove selection 1' })
    ).not.toBeInTheDocument()
  })

  test('can hide the label without losing the collector accessible name', () => {
    render(
      <ArgumentField
        name="profiles"
        inputType="selection"
        label="Profiles"
        isRequired
        hideLabel
        value={undefined}
        selectionItems={selectionItems}
        onChange={vi.fn()}
        onStartSelecting={vi.fn()}
      />
    )

    expect(screen.getByText('Face 1')).toBeVisible()
    expect(screen.queryByText('Profiles')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Select Profiles' })
    ).toBeVisible()
  })

  test('labels and reorders an ordered selection', () => {
    const onMoveSelection = vi.fn()
    render(
      <ArgumentField
        name="profiles"
        inputType="selection"
        label="Profiles"
        isRequired
        orderedSelection
        value={undefined}
        selectionItems={[
          {
            id: 'profile-1',
            label: 'Profile 1',
            canMoveUp: false,
            canMoveDown: true,
          },
          {
            id: 'profile-2',
            label: 'Profile 2',
            canMoveUp: true,
            canMoveDown: false,
          },
        ]}
        onChange={vi.fn()}
        onMoveSelection={onMoveSelection}
      />
    )

    expect(screen.getByText('Start')).toBeVisible()
    expect(screen.getByText('End')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Move selection 2 up' }))
    expect(onMoveSelection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'profile-2' }),
      'up'
    )
  })
})
