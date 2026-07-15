import CommandArgOptionInput from '@src/components/CommandBar/CommandArgOptionInput'
import type { CommandArgument } from '@src/lib/commandTypes'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assign, createActor, createMachine } from 'xstate'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      send: mocks.send,
      useState: () => ({
        context: { argumentsToSubmit: {} },
      }),
    },
  }),
}))

describe('CommandArgOptionInput', () => {
  it.each([
    { caseName: 'no option is available', options: [] },
    {
      caseName: 'the selected option is disabled',
      options: [{ name: 'Unavailable', value: 'unavailable', disabled: true }],
    },
  ])('does not submit when $caseName', ({ options }) => {
    const onSubmit = vi.fn()
    const arg = {
      inputType: 'options',
      required: true,
      options,
      machineActor: undefined,
    } as unknown as CommandArgument<unknown> & { inputType: 'options' }

    const { container } = render(
      <CommandArgOptionInput
        arg={arg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('selects an option that arrives after an initially empty result', () => {
    const onSubmit = vi.fn()
    const emptyArg = {
      inputType: 'options',
      required: true,
      options: [],
      machineActor: undefined,
    } as unknown as CommandArgument<unknown> & { inputType: 'options' }
    const availableArg = {
      ...emptyArg,
      options: [{ name: 'Available', value: 'available' }],
    }

    const { container, rerender } = render(
      <CommandArgOptionInput
        arg={emptyArg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    rerender(
      <CommandArgOptionInput
        arg={availableArg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(onSubmit).toHaveBeenCalledWith('available')
  })

  it('reacts to actor-backed options that arrive after mounting', async () => {
    const optionsActor = createActor(
      createMachine({
        types: {
          context: {} as {
            options: Array<{ name: string; value: string }>
          },
          events: {} as {
            type: 'set options'
            options: Array<{ name: string; value: string }>
          },
        },
        context: { options: [] },
        on: {
          'set options': {
            actions: assign({
              options: ({ event }) => event.options,
            }),
          },
        },
      })
    ).start()
    const onSubmit = vi.fn()
    const arg = {
      inputType: 'options',
      required: true,
      machineActor: optionsActor,
      options: (
        _commandContext: unknown,
        machineContext?: { options: Array<{ name: string; value: string }> }
      ) => machineContext?.options ?? [],
    } as unknown as CommandArgument<unknown> & { inputType: 'options' }

    const { container } = render(
      <CommandArgOptionInput
        arg={arg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    expect(screen.getByText('No results found')).toBeInTheDocument()

    act(() => {
      optionsActor.send({
        type: 'set options',
        options: [{ name: 'Available', value: 'available' }],
      })
    })

    await screen.findByRole('option', { name: 'Available' })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(onSubmit).toHaveBeenCalledWith('available')
    optionsActor.stop()
  })

  it('adopts the refreshed option object for the selected value', async () => {
    const onSubmit = vi.fn()
    const initialArg = {
      inputType: 'options',
      required: true,
      options: [{ name: 'Initial label', value: 'same-value' }],
      machineActor: undefined,
    } as unknown as CommandArgument<unknown> & { inputType: 'options' }
    const refreshedArg = {
      ...initialArg,
      options: [{ name: 'Refreshed label', value: 'same-value' }],
    }

    const { rerender } = render(
      <CommandArgOptionInput
        arg={initialArg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )
    rerender(
      <CommandArgOptionInput
        arg={refreshedArg}
        argName="project"
        stepBack={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Refreshed label' })
      ).toHaveAttribute('aria-selected', 'true')
    )
  })
})
