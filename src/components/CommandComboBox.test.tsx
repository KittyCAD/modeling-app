import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { COMMAND_PALETTE_USAGE_STORAGE_KEY } from '@src/lib/commandPaletteUsage'
import type { Command } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ commands: { send: mocks.send } }),
}))

import CommandComboBox from '@src/components/CommandComboBox'

function command(id: string, displayName: string): Command {
  return {
    id,
    name: id,
    groupId: 'test',
    displayName,
    scopes: GLOBAL_COMMAND_SCOPES,
    needsReview: false,
    onSubmit: () => {},
  }
}

function searchForReset() {
  fireEvent.change(screen.getByTestId('cmd-bar-search'), {
    target: { value: 'reset' },
  })
}

beforeEach(() => {
  mocks.send.mockClear()
  globalThis.localStorage.removeItem(COMMAND_PALETTE_USAGE_STORAGE_KEY)
})

test('promotes a selected search result after remounting', () => {
  const resetLayout = command('reset-layout', 'Reset layout')
  const resetView = command('reset-view', 'Reset view')
  const options = [resetLayout, resetView]

  const firstRender = render(<CommandComboBox options={options} />)
  searchForReset()

  expect(screen.getAllByRole('option')[0]).toHaveTextContent('Reset layout')

  fireEvent.click(screen.getByRole('option', { name: 'Reset view' }))

  expect(mocks.send).toHaveBeenCalledWith({
    type: 'Select command',
    data: { command: resetView },
  })
  expect(
    globalThis.localStorage.getItem(COMMAND_PALETTE_USAGE_STORAGE_KEY)
  ).not.toBeNull()

  firstRender.unmount()

  render(<CommandComboBox options={options} />)
  searchForReset()

  expect(screen.getAllByRole('option')[0]).toHaveTextContent('Reset view')
})
