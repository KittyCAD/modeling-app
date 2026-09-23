import { signal } from '@preact/signals-core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ZookeeperConversationPicker } from '@src/lib/zookeeper/components/ZookeeperConversationPicker'
import type { ZookeeperConversationDetails } from '@src/lib/zookeeper/conversationDetails'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'

function setup({ ids = ['older-id', 'current-id'], switching = false } = {}) {
  const loadConversationDetails = vi
    .fn<ZookeeperSessionController['loadConversationDetails']>()
    .mockResolvedValue({
      'older-id': {
        first_prompt: 'Make a mounting bracket',
        created_at: '2026-09-21T12:00:00Z',
      },
      'current-id': {
        first_prompt: 'Add rounded corners',
        created_at: '2026-09-23T12:00:00Z',
      },
    })
  const controller = {
    conversationIds: signal(ids),
    currentConversationId: signal(ids.at(-1)),
    isClearingChat: signal(switching),
    loadConversationDetails,
  } as unknown as ZookeeperSessionController
  const onSelect = vi.fn()
  const onNewChat = vi.fn()
  const view = render(
    <ZookeeperConversationPicker
      controller={controller}
      onSelect={onSelect}
      onNewChat={onNewChat}
    />
  )
  return { ...view, controller, loadConversationDetails, onSelect, onNewChat }
}

describe('Zookeeper conversation picker', () => {
  it('loads labels lazily, marks the current chat, and selects saved IDs', async () => {
    const { loadConversationDetails, onSelect, onNewChat } = setup()
    expect(loadConversationDetails).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose conversation' }))
    const older = await screen.findByRole('menuitem', {
      name: /Make a mounting bracket/,
    })
    expect(
      screen.getByRole('menuitem', { name: /Add rounded corners/ })
    ).toHaveAttribute('aria-current', 'true')
    fireEvent.click(older)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('older-id')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('keeps IDs selectable if labels fail and supports retry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadConversationDetails, onSelect } = setup()
    loadConversationDetails.mockRejectedValueOnce(new Error('Offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose conversation' }))
    await screen.findByText('Could not load chat labels.')
    expect(
      screen.getByRole('menuitem', { name: 'Chat older-id' })
    ).toBeEnabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Make a mounting bracket/ })
    )
    expect(onSelect).toHaveBeenCalledWith('older-id')
    error.mockRestore()
  })

  it('does not remove unavailable conversations from the menu', async () => {
    const { loadConversationDetails } = setup()
    loadConversationDetails.mockResolvedValue({})
    fireEvent.click(screen.getByRole('button', { name: 'Choose conversation' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Loading chat labels...')
      ).not.toBeInTheDocument()
    )
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('opens, selects, and dismisses the menu from the keyboard', async () => {
    const { onSelect } = setup()
    const trigger = screen.getByRole('button', { name: 'Choose conversation' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    await screen.findByRole('menuitem', { name: /Make a mounting bracket/ })
    fireEvent.keyDown(menu, { key: 'End' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('older-id')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('cancels label loading on unmount', async () => {
    const { loadConversationDetails, unmount } = setup()
    let resolve!: (details: ZookeeperConversationDetails) => void
    loadConversationDetails.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose conversation' }))
    const abortSignal = loadConversationDetails.mock.calls[0][0]
    unmount()
    expect(abortSignal.aborted).toBe(true)
    resolve({})
  })

  it.each([
    { ids: [], switching: false },
    { ids: ['current-id'], switching: true },
  ])(
    'disables the controls when no saved chats exist or a switch is pending: %j',
    (options) => {
      setup(options)
      expect(
        screen.getByRole('button', { name: 'Choose conversation' })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled()
    }
  )
})
