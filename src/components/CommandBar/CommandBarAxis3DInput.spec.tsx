import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CommandBarAxis3DInput from '@src/components/CommandBar/CommandBarAxis3DInput'
import type { KclManager } from '@src/lang/KclManager'
import type { Axis3DCommandValue, CommandArgument } from '@src/lib/commandTypes'

const mocks = vi.hoisted(() => ({
  argumentsToSubmit: {},
  commandSend: vi.fn(),
}))

vi.mock('@xstate/react', () => ({
  useSelector: () => undefined,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      send: mocks.commandSend,
      useState: () => ({
        context: {
          argumentsToSubmit: mocks.argumentsToSubmit,
        },
      }),
    },
  }),
}))

vi.mock('@src/components/CommandBar/CommandArgOptionInput', () => ({
  default: ({ arg }: { arg: CommandArgument<unknown> }) => (
    <div>
      <div>options-input</div>
      {'options' in arg &&
        typeof arg.options !== 'function' &&
        arg.options.map((option) => <div key={option.name}>{option.name}</div>)}
    </div>
  ),
}))

vi.mock('@src/components/CommandBar/CommandBarVector3DInput', () => ({
  default: ({ arg }: { arg: CommandArgument<unknown> }) => (
    <div>
      <div>vector-input</div>
      {'defaultValue' in arg && <div>{String(arg.defaultValue)}</div>}
    </div>
  ),
}))

const axisArg = {
  name: 'axis',
  inputType: 'axis3d',
  required: true,
  description:
    'Choose a default axis (`X`, `Y`, or `Z`) or switch to Vector for a custom 3D vector.',
  defaultValue: 'Z',
  vectorDefaultValue: '[0, 0, 1]',
  options: [
    { name: 'X-axis', value: 'X' },
    { name: 'Y-axis', value: 'Y' },
    { name: 'Z-axis', isCurrent: true, value: 'Z' },
  ],
  valueSummary: (value) =>
    typeof value === 'string' ? value : value.valueText,
} satisfies CommandArgument<Axis3DCommandValue> & {
  inputType: 'axis3d'
  name: string
}

describe('CommandBarAxis3DInput', () => {
  it('starts in default-axis mode for default axis values', () => {
    mocks.argumentsToSubmit = {
      axis: {
        valueAst: { type: 'Name', name: 'Y' },
        valueText: 'Y',
        valueCalculated: 'NAN',
      },
    }

    render(
      <CommandBarAxis3DInput
        arg={axisArg}
        stepBack={vi.fn()}
        onSubmit={vi.fn()}
        executingEditor={{} as KclManager}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Default axis' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('options-input')).toBeInTheDocument()
    expect(screen.getByText('Y-axis')).toBeInTheDocument()
    expect(screen.getByText(/Choose a default axis/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Vector' }))
    expect(screen.getByText('vector-input')).toBeInTheDocument()
    expect(screen.getByText('[0, 1, 0]')).toBeInTheDocument()
  })

  it('starts in vector mode for vector KCL values', () => {
    mocks.argumentsToSubmit = {
      axis: {
        valueAst: { type: 'ArrayExpression', elements: [] },
        valueText: '[1, 0, 0]',
        valueCalculated: '[1, 0, 0]',
      },
    }

    render(
      <CommandBarAxis3DInput
        arg={axisArg}
        stepBack={vi.fn()}
        onSubmit={vi.fn()}
        executingEditor={{} as KclManager}
      />
    )

    expect(screen.getByRole('button', { name: 'Vector' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText('vector-input')).toBeInTheDocument()
    expect(screen.getByText('[1, 0, 0]')).toBeInTheDocument()
  })
})
