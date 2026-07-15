import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import CommandBarArgument from '@src/components/CommandBar/CommandBarArgument'

const mocks = vi.hoisted(() => ({
  commandBarState: {
    context: {},
  },
  send: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: {
      send: mocks.send,
      useState: () => mocks.commandBarState,
    },
  }),
}))

vi.mock('@src/components/CommandBar/CommandBarHeaderFooter', () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>,
}))

vi.mock('@src/components/CommandBar/CommandBarDivider', () => ({
  default: () => null,
}))

vi.mock('@src/components/CommandBar/CommandBarBasicInput', () => ({
  default: ({ arg }: { arg: { defaultValue?: string; name: string } }) => (
    <input
      data-testid="uncontrolled-basic-input"
      defaultValue={arg.defaultValue}
      name={arg.name}
    />
  ),
}))

describe('CommandBarArgument', () => {
  it('remounts an uncontrolled input when switching commands', () => {
    mocks.commandBarState = {
      context: {
        selectedCommand: {
          groupId: 'projects',
          name: 'Create project',
        },
        currentArgument: {
          defaultValue: 'untitled',
          inputType: 'string',
          name: 'name',
        },
      },
    }

    const { rerender } = render(<CommandBarArgument stepBack={vi.fn()} />)
    const createProjectInput = screen.getByTestId('uncontrolled-basic-input')
    fireEvent.change(createProjectInput, {
      target: { value: 'typed create-project name' },
    })

    mocks.commandBarState = {
      context: {
        selectedCommand: {
          groupId: 'projects',
          name: 'Duplicate project',
        },
        currentArgument: {
          defaultValue: 'source-project-copy',
          inputType: 'string',
          name: 'newName',
        },
      },
    }
    rerender(<CommandBarArgument stepBack={vi.fn()} />)

    const duplicateProjectInput = screen.getByTestId('uncontrolled-basic-input')
    expect(duplicateProjectInput).not.toBe(createProjectInput)
    expect(duplicateProjectInput).toHaveValue('source-project-copy')
  })
})
