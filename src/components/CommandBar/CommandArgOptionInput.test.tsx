import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: { argumentsToSubmit: {} } }))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      useState: () => ({ context: mocks.context }),
    },
  }),
}))

import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'

it('filters identically named projects by library and submits the selected project ID', async () => {
  const onSubmit = vi.fn()
  await act(async () => {
    render(
      <CommandArgOptionInput
        arg={{
          inputType: 'options',
          required: true,
          options: [
            {
              name: 'Another project',
              description: 'Personal Cloud',
              value: 'other',
            },
            { name: 'Bracket', description: 'Local Projects', value: 'local' },
            {
              name: 'Bracket',
              description: 'Client Projects',
              value: 'client',
            },
            { name: 'Bracket', description: 'Personal Cloud', value: 'cloud' },
          ],
        }}
        argName="Project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
  })
  expect(screen.getAllByRole('option')).toHaveLength(4)
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'Client Projects' },
  })
  expect(screen.getAllByRole('option')).toHaveLength(1)
  const option = screen.getByRole('option', { name: 'Bracket Client Projects' })
  fireEvent.mouseDown(option)
  fireEvent.click(option)
  expect(onSubmit).toHaveBeenCalledWith('client')
})

it('keeps boolean choices distinct when their options are recalculated', async () => {
  const onSubmit = vi.fn()
  const arg = {
    inputType: 'options' as const,
    required: true,
    options: () => [
      { name: 'On', value: true },
      { name: 'Off', value: false },
    ],
  }
  const input = () => (
    <CommandArgOptionInput
      arg={arg}
      argName="value"
      stepBack={vi.fn()}
      onSubmit={onSubmit}
    />
  )
  const view = render(input())
  for (const label of ['On', 'Off', 'On']) {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: label } })
    mocks.context = { argumentsToSubmit: {} }
    view.rerender(input())
    const option = screen.getByRole('option', { name: label })
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    expect(onSubmit).toHaveBeenLastCalledWith(label === 'On')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['On', 'Off'])
  }
})
