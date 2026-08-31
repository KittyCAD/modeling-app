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
  Turn,
} from '@src/contracts/zookeeper'
import { zookeeperService } from '@src/contracts/zookeeper'
import { ZookeeperPanel } from '@src/features/zookeeper/ZookeeperPanel'

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
  open?: () => void
}) {
  const reason = signal<string | null>(options.reason ?? null)
  const conversations = new Map<string, Conversation>()
  if (options.conversation) {
    conversations.set(options.conversation.id, options.conversation)
  }

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      id: 'test.zookeeper',
      providesServices: [
        provideService(zookeeperService, {
          conversations: computed(() => conversations),
          active: computed(() => options.conversation?.id ?? null),
          available: computed(() => reason.value === null),
          unavailableReason: computed(() => reason.value),
          open: () => {
            options.open?.()
            return null
          },
          close: () => {},
          activate: () => {},
          conversation: (id) => conversations.get(id),
          holderOf: () => computed(() => null),
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
        <ZookeeperPanel />
      </AppProvider>,
      host as HTMLDivElement
    )
  })
  return host
}

function fakeConversation(options: {
  turns?: Turn[]
  connection?: ConversationConnection
  status?: 'idle' | 'streaming' | 'waiting' | 'failed'
  onSend?: (prompt: string) => void
  onInterrupt?: () => void
  onRevert?: (turnId: string) => void
}): Conversation {
  const transcript: Signal<readonly Turn[]> = signal(options.turns ?? [])
  return {
    id: 'c1',
    author: 'zookeeper:c1',
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
