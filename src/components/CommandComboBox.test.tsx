import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

test('promotes a selected search result after remounting, including keyboard order', async () => {
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
  const input = screen.getByTestId('cmd-bar-search')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'End' })
  await waitFor(() =>
    expect(
      screen.getByRole('option', { name: 'Reset layout' })
    ).toHaveAttribute('id', input.getAttribute('aria-activedescendant'))
  )
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(mocks.send).toHaveBeenLastCalledWith({
    type: 'Select command',
    data: { command: resetLayout },
  })
})

test('keyboard selection follows filtered order and skips disabled commands', async () => {
  const options = Array.from({ length: 100 }, (_, index) =>
    command(`command-${index}`, `Command ${String(index).padStart(3, '0')}`)
  )
  const resetView = command('reset-view', 'Reset view')
  const resetLayout = command('reset-layout', 'Reset layout')
  resetLayout.disabled = true
  options.push(resetView, resetLayout)
  render(<CommandComboBox options={options} />)
  const input = screen.getByTestId('cmd-bar-search')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'End' })
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Reset view' })).toHaveAttribute(
      'id',
      input.getAttribute('aria-activedescendant')
    )
  )

  searchForReset()
  expect(screen.getAllByRole('option')).toHaveLength(2)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(mocks.send).toHaveBeenCalledWith({
    type: 'Select command',
    data: { command: resetView },
  })
})
