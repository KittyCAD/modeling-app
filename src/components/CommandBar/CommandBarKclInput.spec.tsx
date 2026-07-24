import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'

import CommandBarKclInput from '@src/components/CommandBar/CommandBarKclInput'
import type { KclManager } from '@src/lang/KclManager'
import type { CommandArgument } from '@src/lib/commandTypes'

const mocks = vi.hoisted(() => ({
  commandSend: vi.fn(),
  wasmPromise: Promise.resolve({}),
}))

vi.mock('@xstate/react', () => ({
  useSelector: () => undefined,
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    context: {
      selectionRanges: {
        graphSelections: [],
        otherSelections: [],
      },
    },
  }),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      send: mocks.commandSend,
      useState: () => ({
        context: {
          argumentsToSubmit: {},
        },
      }),
    },
    settings: {
      useSettings: () => ({
        app: {
          theme: {
            current: 'light',
          },
        },
      }),
    },
    wasmPromise: mocks.wasmPromise,
  }),
}))

vi.mock('@src/lib/hotkeyWrapper', () => ({
  default: vi.fn(),
}))

vi.mock('@src/lib/useCalculateKclExpression', () => ({
  useCalculateKclExpression: () => ({
    calcResult: '1',
    isExecuting: false,
    isNewVariableNameUnique: true,
    newVariableInsertIndex: 0,
    newVariableName: '',
    prevVariables: [],
    setNewVariableName: vi.fn(),
    valueNode: {
      type: 'Literal',
      value: 1,
    },
  }),
}))

describe('CommandBarKclInput', () => {
  it('renders argument descriptions', async () => {
    const arg = {
      name: 'value',
      inputType: 'kcl',
      required: true,
      defaultValue: '1',
      description: 'Enter a KCL expression.',
    } satisfies CommandArgument<unknown> & {
      inputType: 'kcl'
      name: string
    }

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <CommandBarKclInput
            arg={arg}
            stepBack={vi.fn()}
            onSubmit={vi.fn()}
            executingEditor={
              {
                ast: {},
                astSignal: { value: {} },
                codeSignal: { value: '' },
                rustContext: {},
                variablesSignal: { value: {} },
              } as KclManager
            }
          />
        </Suspense>
      )
      await mocks.wasmPromise
    })

    expect(
      await screen.findByText('Enter a KCL expression.')
    ).toBeInTheDocument()
  })
})
