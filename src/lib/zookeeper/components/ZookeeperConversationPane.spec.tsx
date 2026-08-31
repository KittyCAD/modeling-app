import { signal } from '@preact/signals-core'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const conversationRender = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/zookeeper/components/ZookeeperConversation', () => ({
  ZookeeperConversation: (props: unknown) => {
    conversationRender(props)
    return null
  },
}))

vi.mock('@src/lib/zookeeper/components/ZookeeperConversationWelcome', () => ({
  ZookeeperConversationWelcome: () => <div>Welcome</div>,
}))

import type {
  QueuedMessage,
  ZookeeperConversationProps,
} from '@src/lib/zookeeper/components/ZookeeperConversation'
import { ZookeeperConversationPane } from '@src/lib/zookeeper/components/ZookeeperConversationPane'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import type {
  Conversation,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { ZookeeperManagerStates } from '@src/lib/zookeeper/zookeeperManagerMachine'

const completedConversation: Conversation = {
  exchanges: [
    {
      request: {
        type: 'user',
        content: 'make a cube 10mm',
      },
      responses: [
        {
          end_of_stream: {
            whole_response: 'Done.',
          },
        },
      ],
      deltasAggregated: 'Done.',
    },
  ],
}

const interruptedConversation: Conversation = {
  exchanges: [
    {
      request: {
        type: 'user',
        content: 'finish the bracket',
      },
      responses: [],
      deltasAggregated: '',
    },
  ],
}

type FakeSnapshot = {
  value: string
  context: {
    abruptlyClosed: boolean
    attachmentsLoadedForCurrentPrompt: boolean
    awaitingResponse: boolean
    accessDeniedCode?: 'payment_method_failed'
    closeReason?: string
    conversation?: Conversation
    conversationId?: string
    defaultMode?: string
    modeOptions?: MlCopilotModeOption[]
    setupFailed: boolean
  }
  matches: (state: unknown) => boolean
}

const createFakeActor = (
  context: Partial<FakeSnapshot['context']> = {},
  value: string = ZookeeperManagerStates.Ready
) => {
  let snapshot: FakeSnapshot
  const listeners = new Set<(next: FakeSnapshot) => void>()

  const makeSnapshot = (
    nextContext: Partial<FakeSnapshot['context']>,
    nextValue: string
  ): FakeSnapshot => ({
    value: nextValue,
    context: {
      abruptlyClosed: false,
      attachmentsLoadedForCurrentPrompt: true,
      awaitingResponse: false,
      setupFailed: false,
      ...nextContext,
    },
    matches: (state) => state === nextValue,
  })

  snapshot = makeSnapshot(context, value)

  const setSnapshot = (
    nextContext: Partial<FakeSnapshot['context']>,
    nextValue = snapshot.value
  ) => {
    snapshot = makeSnapshot({ ...snapshot.context, ...nextContext }, nextValue)
    for (const listener of listeners) {
      listener(snapshot)
    }
  }

  return {
    actor: {
      getSnapshot: () => snapshot,
      subscribe: (listener: (next: FakeSnapshot) => void) => {
        listeners.add(listener)
        return {
          unsubscribe: () => listeners.delete(listener),
        }
      },
      send: vi.fn(),
    },
    setSnapshot,
  }
}

const createFakeController = ({
  actorContext,
  actorValue,
  isClearingChat = false,
  isResumingInterruptedTurn = false,
  queue = [],
  showManualConnect = false,
}: {
  actorContext?: Partial<FakeSnapshot['context']>
  actorValue?: string
  isClearingChat?: boolean
  isResumingInterruptedTurn?: boolean
  queue?: QueuedMessage[]
  showManualConnect?: boolean
} = {}) => {
  const actor = createFakeActor(actorContext, actorValue)
  const queueSignal = signal<QueuedMessage[]>(queue)
  const clearingSignal = signal(isClearingChat)
  const resumingSignal = signal(isResumingInterruptedTurn)
  const manualConnectSignal = signal(showManualConnect)
  const methods = {
    cancel: vi.fn(),
    checkBillingAccess: vi.fn(),
    clearConversation: vi.fn(async () => undefined),
    dispose: vi.fn(),
    reconnect: vi.fn(),
    removeQueued: vi.fn(),
    resumeInterruptedTurn: vi.fn(),
    sendOrQueue: vi.fn(),
    steer: vi.fn(),
    updateAuthToken: vi.fn(),
  }
  const controller = {
    actor: actor.actor,
    isClearingChat: clearingSignal,
    isResumingInterruptedTurn: resumingSignal,
    projectPath: '/projects/cube',
    queue: queueSignal,
    showManualConnect: manualConnectSignal,
    ...methods,
  } as unknown as ZookeeperSessionController

  return {
    ...actor,
    ...methods,
    clearingSignal,
    controller,
    manualConnectSignal,
    queueSignal,
    resumingSignal,
  }
}

type PaneProps = Parameters<typeof ZookeeperConversationPane>[0]

const createPaneProps = (
  controller: ZookeeperSessionController,
  overrides: Partial<PaneProps> = {}
): PaneProps => ({
  controller,
  contextModeling: {
    selectionRanges: {
      graphSelections: [],
      otherSelections: [],
    },
  } as unknown as PaneProps['contextModeling'],
  settings: {
    app: {
      zookeeperMode: {
        project: undefined,
        user: undefined,
      },
    },
  } as PaneProps['settings'],
  theProject: {
    name: 'cube',
    path: '/projects/cube',
  } as unknown as PaneProps['theProject'],
  ...overrides,
})

const latestConversationProps = () => {
  const calls = conversationRender.mock.calls
  return calls[calls.length - 1][0] as ZookeeperConversationProps
}

const LocationProbe = () => {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

beforeEach(() => {
  conversationRender.mockClear()
})

describe('ZookeeperConversationPane', () => {
  test('maps actor state, controller signals, and visual context to the conversation', () => {
    const queuedMessage: QueuedMessage = {
      id: 'queued-message',
      text: 'add a fillet',
      mode: 'edit',
      attachments: [],
    }
    const modeOptions = [
      {
        id: 'edit',
        label: 'Edit',
        description: 'Edit the model',
        icon: 'sparkles',
        disabled: false,
      } as MlCopilotModeOption,
    ]
    const fake = createFakeController({
      actorContext: {
        attachmentsLoadedForCurrentPrompt: false,
        accessDeniedCode: 'payment_method_failed',
        awaitingResponse: true,
        closeReason: 'Connection lost.',
        conversation: completedConversation,
        conversationId: 'conversation-id',
        defaultMode: 'server-mode',
        modeOptions,
        setupFailed: true,
      },
      actorValue: ZookeeperManagerStates.Setup,
      isClearingChat: true,
      queue: [queuedMessage],
      showManualConnect: true,
    })

    render(
      <MemoryRouter>
        <ZookeeperConversationPane
          {...createPaneProps(fake.controller, {
            settings: {
              app: {
                zookeeperMode: {
                  project: 'project-mode',
                  user: 'user-mode',
                },
              },
            } as PaneProps['settings'],
            showMakeathonAnnouncement: true,
            user: {
              image: 'avatar.png',
            },
          })}
        />
      </MemoryRouter>
    )

    const props = latestConversationProps()
    expect(props.conversation).toBe(completedConversation)
    expect(props.isLoading).toBe(false)
    expect(props.isLoadingAttachments).toBe(true)
    expect(props.contexts).toEqual([
      {
        type: 'selections',
        data: {
          graphSelections: [],
          otherSelections: [],
        },
      },
    ])
    expect(props.needsReconnect).toBe(true)
    expect(props.connectionError).toBe('No internet connection.')
    expect(props.connectionFailed).toBe(true)
    expect(props.accessDeniedCode).toBe('payment_method_failed')
    expect(props.showManualConnect).toBe(true)
    expect(props.canClearChat).toBe(true)
    expect(props.isClearingChat).toBe(true)
    expect(props.loadingMessage).toBe('Connecting to Zookeeper...')
    expect(props.disabled).toBe(true)
    expect(props.hasPromptCompleted).toBe(false)
    expect(props.isProcessing).toBe(true)
    expect(props.queue).toEqual([queuedMessage])
    expect(props.initialMlCopilotMode).toBe('project-mode')
    expect(props.modeOptions).toBe(modeOptions)
    expect(props.modeScopeKey).toBe('/projects/cube')
    expect(props.userAvatarSrc).toBe('avatar.png')
    expect(props.showMakeathonAnnouncement).toBe(true)
  })

  test('stays reactive to actor state and controller signals', () => {
    const fake = createFakeController({
      actorContext: {
        conversation: completedConversation,
        conversationId: 'conversation-id',
      },
    })

    render(
      <MemoryRouter>
        <ZookeeperConversationPane {...createPaneProps(fake.controller)} />
      </MemoryRouter>
    )

    expect(latestConversationProps().needsReconnect).toBe(false)

    act(() => {
      fake.manualConnectSignal.value = true
      fake.queueSignal.value = [
        {
          id: 'queued-message',
          text: 'shell the part',
          attachments: [],
        },
      ]
      fake.setSnapshot({
        awaitingResponse: true,
        conversation: undefined,
      })
    })

    const props = latestConversationProps()
    expect(props.needsReconnect).toBe(true)
    expect(props.isLoading).toBe(true)
    expect(props.isProcessing).toBe(true)
    expect(props.queue).toEqual([
      {
        id: 'queued-message',
        text: 'shell the part',
        attachments: [],
      },
    ])
  })

  test('delegates conversation actions to the session controller', () => {
    const fake = createFakeController({
      actorContext: { conversation: completedConversation },
    })
    const onMlCopilotModeChange = vi.fn()
    render(
      <MemoryRouter>
        <ZookeeperConversationPane
          {...createPaneProps(fake.controller, { onMlCopilotModeChange })}
        />
      </MemoryRouter>
    )
    const props = latestConversationProps()
    const attachment = new File(['model'], 'model.kcl')

    props.onProcess('make a cylinder', 'edit', [attachment])
    props.onClickClearChat()
    props.onReconnect()
    props.onCheckBilling?.()
    props.onCancel()
    props.onResumeInterruptedTurn?.()
    props.onRemoveFromQueue('queued-message')
    props.onSteer('steered-message')
    props.onMlCopilotModeChange?.('ask')

    expect(fake.sendOrQueue).toHaveBeenCalledWith('make a cylinder', 'edit', [
      attachment,
    ])
    expect(fake.clearConversation).toHaveBeenCalledOnce()
    expect(fake.reconnect).toHaveBeenCalledOnce()
    expect(fake.checkBillingAccess).toHaveBeenCalledOnce()
    expect(fake.cancel).toHaveBeenCalledOnce()
    expect(fake.resumeInterruptedTurn).toHaveBeenCalledOnce()
    expect(fake.removeQueued).toHaveBeenCalledWith('queued-message')
    expect(fake.steer).toHaveBeenCalledWith('steered-message')
    expect(onMlCopilotModeChange).toHaveBeenCalledWith('ask')
  })

  test('checks billing access after returning from the billing page', () => {
    const fake = createFakeController({
      actorContext: {
        accessDeniedCode: 'payment_method_failed',
        setupFailed: true,
      },
    })
    render(
      <MemoryRouter>
        <ZookeeperConversationPane {...createPaneProps(fake.controller)} />
      </MemoryRouter>
    )

    latestConversationProps().onOpenBilling?.()
    window.dispatchEvent(new Event('focus'))

    expect(fake.checkBillingAccess).toHaveBeenCalledOnce()

    window.dispatchEvent(new Event('focus'))
    expect(fake.checkBillingAccess).toHaveBeenCalledOnce()
  })

  test('requires an explicit resume for an interrupted turn', () => {
    const fake = createFakeController({
      actorContext: {
        awaitingResponse: false,
        conversation: interruptedConversation,
      },
      actorValue: ZookeeperManagerStates.WaitForContinueCheck,
      isResumingInterruptedTurn: true,
    })
    render(
      <MemoryRouter>
        <ZookeeperConversationPane {...createPaneProps(fake.controller)} />
      </MemoryRouter>
    )

    const props = latestConversationProps()
    expect(props.interruptedTurnAwaitingResume).toBe(true)
    expect(props.isResumingInterruptedTurn).toBe(true)
    expect(props.disabled).toBe(true)
    expect(props.hasPromptCompleted).toBe(false)

    props.onResumeInterruptedTurn?.()
    expect(fake.resumeInterruptedTurn).toHaveBeenCalledOnce()
  })

  test('consumes the URL prompt and falls back through user and server modes', async () => {
    const fake = createFakeController({
      actorContext: {
        conversation: completedConversation,
        defaultMode: 'server-mode',
      },
    })
    render(
      <MemoryRouter
        initialEntries={[
          '/projects/cube?zookeeper-prompt=make+a+gear&ttc-prompt=legacy&keep=yes',
        ]}
      >
        <ZookeeperConversationPane
          {...createPaneProps(fake.controller, {
            settings: {
              app: {
                zookeeperMode: {
                  project: undefined,
                  user: 'user-mode',
                },
              },
            } as PaneProps['settings'],
          })}
        />
        <LocationProbe />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(latestConversationProps().defaultPrompt).toBe('make a gear')
      expect(screen.getByTestId('location-search')).toHaveTextContent(
        '?keep=yes'
      )
    })
    expect(latestConversationProps().initialMlCopilotMode).toBe('user-mode')
  })
})
