import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { type Signal, computed, signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '@src/app/context'
import type {
  Conversation,
  ConversationConnection,
  StoredConversation,
  Turn,
} from '@src/contracts/zookeeper'
import { zookeeperService } from '@src/contracts/zookeeper'
import {
  ZookeeperHeaderActions,
  ZookeeperPanel,
} from '@src/features/zookeeper/ZookeeperPanel'

/**
 * The panel, rendered.
 *
 * Its four states cannot all be reached by running the app: three of them need a
 * signed-in account and a live service. They are all reachable here, driven by a
 * stub, which is the point — the states somebody only sees when something has
 * gone wrong are exactly the ones worth having a test for.
 */

let host: HTMLDivElement | null = null

function mount(options: {
  reason?: string | null
  conversation?: Conversation | null
  /** More than one, for the tab strip. The first is active. */
  conversations?: Conversation[]
  open?: () => void
  onActivate?: (id: string) => void
  onClose?: (id: string) => void
  /** Render the header button instead of the panel body. */
  header?: boolean
  /** Conversations on disk, for the resume list. */
  stored?: StoredConversation[]
}) {
  const reason = signal<string | null>(options.reason ?? null)
  const conversations = new Map<string, Conversation>()
  for (const each of options.conversations ?? []) {
    conversations.set(each.id, each)
  }
  if (options.conversation) {
    conversations.set(options.conversation.id, options.conversation)
  }
  const activeId =
    options.conversation?.id ?? options.conversations?.[0]?.id ?? null

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      id: 'test.zookeeper',
      providesServices: [
        provideService(zookeeperService, {
          conversations: computed(() => conversations),
          active: computed(() => activeId),
          available: computed(() => reason.value === null),
          unavailableReason: computed(() => reason.value),
          open: () => {
            options.open?.()
            return null
          },
          close: (id) => options.onClose?.(id),
          activate: (id) => options.onActivate?.(id),
          conversation: (id) => conversations.get(id),
          holderOf: () => computed(() => null),
          presence: computed(() => new Map()),
          stored: computed(() => options.stored ?? []),
          resume: () => null,
          forget: () => {},
        }),
      ],
      provides: [],
    }),
  ])

  host = document.createElement('div')
  document.body.appendChild(host)
  void act(() => {
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        {options.header === true ? (
          <ZookeeperHeaderActions />
        ) : (
          <ZookeeperPanel />
        )}
      </AppProvider>,
      host as HTMLDivElement
    )
  })
  return host
}

function fakeConversation(options: {
  id?: string
  turns?: Turn[]
  connection?: ConversationConnection
  status?: 'idle' | 'streaming' | 'waiting' | 'failed'
  onSend?: (prompt: string) => void
  onInterrupt?: () => void
  onRevert?: (turnId: string) => void
}): Conversation {
  const transcript: Signal<readonly Turn[]> = signal(options.turns ?? [])
  const id = options.id ?? 'c1'
  return {
    id,
    author: `zookeeper:${id}`,
    transcript: computed(() => transcript.value),
    status: computed(() => options.status ?? 'idle'),
    conflicts: computed(() => []),
    connection: computed(
      () =>
        options.connection ?? {
          status: 'connected' as const,
          error: null,
          superseded: false,
        }
    ),
    send: async (prompt) => options.onSend?.(prompt),
    interrupt: () => options.onInterrupt?.(),
    revert: (turnId) => options.onRevert?.(turnId),
    dispose: () => {},
  }
}

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  id: 'turn-1',
  prompt: 'make the bracket thicker',
  response: 'Increased the thickness.',
  at: 0,
  status: 'complete',
  paths: [],
  conflicts: [],
  waiting: [],
  ...overrides,
})

afterEach(() => {
  if (host) {
    render(null, host)
    host.remove()
    host = null
  }
})

describe('ZookeeperPanel', () => {
  it('says why it is unavailable rather than showing a dead prompt', () => {
    const view = mount({ reason: 'Sign in to use Zookeeper.' })

    expect(view.textContent).toContain('Not available')
    expect(view.textContent).toContain('Sign in to use Zookeeper.')
    expect(view.querySelector('textarea')).toBeNull()
  })

  it('offers to start a conversation when there is none', () => {
    const open = vi.fn()
    const view = mount({ conversation: null, open })

    const button = view.querySelector('button')
    expect(button?.textContent).toContain('Start a conversation')

    void act(() => {
      button?.click()
    })
    expect(open).toHaveBeenCalled()
  })

  it('shows the composer once a conversation is open', () => {
    const view = mount({ conversation: fakeConversation({}) })

    const input = view.querySelector('textarea')
    expect(input).not.toBeNull()
    expect(input?.disabled).toBe(false)
    expect(view.textContent).toContain('Describe the change you want')
  })

  /**
   * A prompt typed into a panel whose socket is not up would go nowhere, so the
   * input is disabled and the state is named.
   */
  it('refuses to send while the socket is still coming up', () => {
    const view = mount({
      conversation: fakeConversation({
        connection: { status: 'connecting', error: null, superseded: false },
      }),
    })

    expect(view.textContent).toContain('Connecting')
    expect(view.querySelector('textarea')?.disabled).toBe(true)
  })

  it('reports why the socket failed', () => {
    const view = mount({
      conversation: fakeConversation({
        connection: {
          status: 'failed',
          error: 'The connection closed.',
          superseded: false,
        },
      }),
    })

    expect(view.textContent).toContain('The connection closed.')
    expect(view.querySelector('textarea')?.disabled).toBe(true)
  })

  /** Retrying is the wrong instinct here, so the panel says so. */
  it('says reconnecting will not help a superseded conversation', () => {
    const view = mount({
      conversation: fakeConversation({
        connection: {
          status: 'failed',
          error: 'This conversation was opened somewhere else.',
          superseded: true,
        },
      }),
    })

    expect(view.textContent).toContain('open somewhere else')
    expect(view.textContent).toContain('reconnecting will not help')
  })

  it('sends what was typed', () => {
    const onSend = vi.fn()
    const view = mount({ conversation: fakeConversation({ onSend }) })

    const input = view.querySelector('textarea')
    expect(input).not.toBeNull()
    if (!input) return
    void act(() => {
      input.value = 'make it wider'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const send = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Send')
    )
    void act(() => {
      send?.click()
    })

    expect(onSend).toHaveBeenCalledWith('make it wider')
  })

  it('offers to stop a turn that is streaming', () => {
    const onInterrupt = vi.fn()
    const view = mount({
      conversation: fakeConversation({
        status: 'streaming',
        turns: [turn({ status: 'streaming' })],
        onInterrupt,
      }),
    })

    expect(view.textContent).toContain('Working')
    const stop = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stop')
    )
    void act(() => {
      stop?.click()
    })

    expect(onInterrupt).toHaveBeenCalled()
  })

  /**
   * The part `main`'s pane cannot show at all: what the turn actually did. It
   * writes whole files to disk and has nothing to report afterwards.
   */
  it('lists the files a turn changed, with a way to undo just that turn', () => {
    const onRevert = vi.fn()
    const view = mount({
      conversation: fakeConversation({
        turns: [turn({ paths: ['main.kcl', 'bracket.kcl'] })],
        onRevert,
      }),
    })

    expect(view.textContent).toContain('make the bracket thicker')
    expect(view.textContent).toContain('Increased the thickness.')
    expect(view.textContent).toContain('main.kcl')
    expect(view.textContent).toContain('bracket.kcl')

    const revert = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Revert')
    )
    void act(() => {
      revert?.click()
    })

    expect(onRevert).toHaveBeenCalledWith('turn-1')
  })

  it('names the file a turn could not change', () => {
    const view = mount({
      conversation: fakeConversation({
        turns: [
          turn({
            conflicts: [{ path: 'main.kcl', reason: 'overlapping', edits: [] }],
          }),
        ],
      }),
    })

    expect(view.textContent).toContain('Could not change')
    expect(view.textContent).toContain('main.kcl')
    expect(view.textContent).toContain('you edited it first')
  })

  it('names the file a turn is waiting on', () => {
    const view = mount({
      conversation: fakeConversation({
        status: 'waiting',
        turns: [turn({ status: 'waiting', waiting: ['main.kcl'] })],
      }),
    })

    expect(view.textContent).toContain('Waiting for main.kcl')
    expect(view.textContent).toContain('another conversation is editing it')
  })

  it('shows no tab strip for a single conversation', () => {
    const view = mount({ conversation: fakeConversation({}) })

    expect(view.querySelector('[role="tablist"]')).toBeNull()
  })

  /**
   * The strip appears when "Zookeeper" stops being one thing, which is also when
   * the waiting message starts naming them — so the labels match it.
   */
  it('shows a tab per conversation once there are two', () => {
    const view = mount({
      conversations: [
        fakeConversation({ id: 'a' }),
        fakeConversation({ id: 'b' }),
      ],
    })

    const tabs = [...view.querySelectorAll('[role="tab"]')]
    expect(tabs).toHaveLength(2)
    expect(tabs[0].textContent).toContain('Zookeeper (1)')
    expect(tabs[1].textContent).toContain('Zookeeper (2)')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
  })

  it('switches conversation when a tab is clicked', () => {
    const onActivate = vi.fn()
    const view = mount({
      conversations: [
        fakeConversation({ id: 'a' }),
        fakeConversation({ id: 'b' }),
      ],
      onActivate,
    })

    const tabs = [...view.querySelectorAll('[role="tab"]')]
    void act(() => {
      ;(tabs[1] as HTMLElement).click()
    })

    expect(onActivate).toHaveBeenCalledWith('b')
  })

  it('closes the conversation whose close button was pressed', () => {
    const onClose = vi.fn()
    const view = mount({
      conversations: [
        fakeConversation({ id: 'a' }),
        fakeConversation({ id: 'b' }),
      ],
      onClose,
    })

    const close = [...view.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.includes('Close Zookeeper (2)')
    )
    void act(() => {
      close?.click()
    })

    expect(onClose).toHaveBeenCalledWith('b')
  })

  /** A conversation working while you look at another one is worth seeing. */
  it('marks a background conversation that is busy', () => {
    const view = mount({
      conversations: [
        fakeConversation({ id: 'a' }),
        fakeConversation({ id: 'b', status: 'streaming' }),
      ],
    })

    const marks = [...view.querySelectorAll('.zds-zoo__tabMark')]
    expect(marks).toHaveLength(1)
    expect(marks[0].getAttribute('data-status')).toBe('streaming')
  })

  it('opens another conversation from the header', () => {
    const open = vi.fn()
    const view = mount({ header: true, open })

    void act(() => {
      view.querySelector('button')?.click()
    })

    expect(open).toHaveBeenCalled()
  })

  it('disables the header button while unavailable', () => {
    const view = mount({ header: true, reason: 'Sign in to use Zookeeper.' })

    expect(view.querySelector('button')?.disabled).toBe(true)
  })

  /**
   * The point of writing transcripts to disk: one you cannot get back to is only
   * an audit trail.
   */
  it('lists earlier conversations, titled by their first prompt', () => {
    const view = mount({
      conversation: null,
      stored: [
        {
          id: 'old',
          remoteId: 'r1',
          createdAt: 1,
          turns: [turn({ prompt: 'add a fillet' })],
        },
      ],
    })

    expect(view.textContent).toContain('Earlier conversations')
    expect(view.textContent).toContain('add a fillet')
    expect(view.textContent).toContain('1 turn')
  })

  it('shows no earlier-conversation list when there is nothing stored', () => {
    const view = mount({ conversation: null, stored: [] })

    expect(view.textContent).not.toContain('Earlier conversations')
  })

  /**
   * Said plainly rather than offered as a button that would do something weaker
   * than it claims: the change history those edits were applied against died
   * with the session.
   */
  it('says an earlier session’s edits can no longer be reverted', () => {
    const view = mount({
      conversation: null,
      stored: [{ id: 'old', remoteId: null, createdAt: 1, turns: [turn()] }],
    })

    expect(view.textContent).toContain('can no longer be reverted')
  })

  it('marks a failed turn', () => {
    const view = mount({
      conversation: fakeConversation({
        status: 'failed',
        turns: [turn({ status: 'failed' })],
      }),
    })

    expect(view.textContent).toContain('That turn failed')
  })
})
