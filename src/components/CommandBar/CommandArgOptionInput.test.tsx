import type { CommandArgumentWithName } from '@src/lib/commandTypes'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const argumentsToSubmit: Record<string, unknown> = {}
  return { context: { argumentsToSubmit } }
})

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: { useState: () => mocks, send: vi.fn() },
  }),
}))

import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'

type OptionsArgument = CommandArgumentWithName<unknown> & {
  inputType: 'options'
}

function submitOptions() {
  const form = screen.getByRole('combobox').closest('form')
  expect(form).not.toBeNull()
  if (form) {
    fireEvent.submit(form)
  }
}

describe('command palette option values', () => {
  beforeEach(() => {
    mocks.context.argumentsToSubmit = {}
  })

  it('preserves an existing value when the argument has a display label', () => {
    mocks.context.argumentsToSubmit = { bodyType: 'SOLID' }
    const onSubmit = vi.fn()
    const arg: OptionsArgument = {
      name: 'bodyType',
      displayName: 'Output',
      inputType: 'options',
      required: false,
      options: [
        { name: 'Surface', value: 'SURFACE' },
        { name: 'Solid', value: 'SOLID' },
      ],
    }
    render(
      <CommandArgOptionInput
        arg={arg}
        argName="Output"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Solid')
    submitOptions()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('SOLID')
  })

  it('resets to the next argument value when two arguments share a label', () => {
    mocks.context.argumentsToSubmit = {
      holeType: 'countersink',
      holeBottom: 'drill',
    }
    const onSubmit = vi.fn()
    const head: OptionsArgument = {
      name: 'holeType',
      inputType: 'options',
      required: true,
      options: [
        { name: 'Simple', value: 'simple' },
        { name: 'Countersink', value: 'countersink' },
      ],
    }
    const bottom: OptionsArgument = {
      name: 'holeBottom',
      inputType: 'options',
      required: true,
      options: [
        { name: 'Flat', value: 'flat' },
        { name: 'Drill point', value: 'drill' },
      ],
    }
    const { rerender } = render(
      <CommandArgOptionInput
        arg={head}
        argName="Type"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    rerender(
      <CommandArgOptionInput
        arg={bottom}
        argName="Type"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    submitOptions()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('drill')
  })
})
