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
import type {
  ZookeeperSessionController,
  ZookeeperSessionView,
} from '@src/lib/zookeeper/registry/controller'
import type {
  Conversation,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/zookeeperManagerMachine'

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

const defaultView = (): ZookeeperSessionView => ({
  attachmentFetches: {},
  canClearChat: false,
  connectionFailed: false,
  disabled: false,
  hasPromptCompleted: true,
  interruptedTurnAwaitingResume: false,
  isClearingChat: false,
  isLoading: true,
  isLoadingAttachments: false,
  isProcessing: false,
  isResumingInterruptedTurn: false,
  needsReconnect: false,
  queue: [],
  showManualConnect: false,
})

const createFakeController = (
  viewOverrides: Partial<ZookeeperSessionView> = {}
) => {
  const view = signal<ZookeeperSessionView>({
    ...defaultView(),
    ...viewOverrides,
  })
  const methods = {
    cancel: vi.fn(),
    checkBillingAccess: vi.fn(),
    clearConversation: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    fetchAttachment: vi.fn(),
    getConversationExport: vi.fn(() => ({ fileName: '', markdown: '' })),
    reconnect: vi.fn(),
    removeQueued: vi.fn(),
    resumeInterruptedTurn: vi.fn(),
    sendOrQueue: vi.fn(),
    steer: vi.fn(),
    updateAuthToken: vi.fn(),
  }
  const controller = {
    projectPath: '/projects/cube',
    view,
    ...methods,
  } satisfies ZookeeperSessionController

  return {
    ...methods,
    controller,
    view,
  }
}

type PaneProps = Parameters<typeof ZookeeperConversationPane>[0]

const createPaneProps = (
  controller: ZookeeperSessionController,
  overrides: Partial<PaneProps> = {}
): PaneProps => ({
  controller,
  selectionRanges: {
    graphSelections: [],
    otherSelections: [],
  },
  zookeeperMode: {
    project: undefined,
    user: undefined,
  } as PaneProps['zookeeperMode'],
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
  test('maps the controller view and visual context to the conversation', () => {
    const attachmentFetches = {
      'prompt:0:0': { status: 'loading' as const },
    }
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
      accessDeniedCode: 'payment_method_failed',
      attachmentFetches,
      canClearChat: true,
      connectionError: 'No internet connection.',
      connectionFailed: true,
      conversation: completedConversation,
      defaultMode: 'server-mode',
      disabled: true,
      hasPromptCompleted: false,
      isClearingChat: true,
      isLoading: false,
      isLoadingAttachments: true,
      isProcessing: true,
      loadingMessage: 'Connecting to Zookeeper...',
      modeOptions,
      needsReconnect: true,
      queue: [queuedMessage],
      showManualConnect: true,
    })

    render(
      <MemoryRouter>
        <ZookeeperConversationPane
          {...createPaneProps(fake.controller, {
            zookeeperMode: {
              project: 'project-mode',
              user: 'user-mode',
            } as PaneProps['zookeeperMode'],
            userAvatarSrc: 'avatar.png',
          })}
        />
      </MemoryRouter>
    )

    const props = latestConversationProps()
    expect(props.conversation).toBe(completedConversation)
    expect(props.attachmentFetches).toBe(attachmentFetches)
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
  })

  test('stays reactive to controller view changes', () => {
    const fake = createFakeController({
      conversation: completedConversation,
      isLoading: false,
    })

    render(
      <MemoryRouter>
        <ZookeeperConversationPane {...createPaneProps(fake.controller)} />
      </MemoryRouter>
    )

    expect(latestConversationProps().needsReconnect).toBe(false)

    act(() => {
      fake.view.value = {
        ...fake.view.value,
        conversation: undefined,
        isLoading: true,
        isProcessing: true,
        needsReconnect: true,
        queue: [
          {
            id: 'queued-message',
            text: 'shell the part',
            attachments: [],
          },
        ],
        showManualConnect: true,
      }
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
      conversation: completedConversation,
      isLoading: false,
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
    const attachmentRef = {
      prompt_id: '00000000-0000-4000-8000-000000000001',
      seq: 3,
      index: 1,
      content_hash:
        'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }

    props.onProcess('make a cylinder', 'edit', [attachment])
    props.onFetchAttachment?.(attachmentRef)
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
    expect(fake.fetchAttachment).toHaveBeenCalledWith(attachmentRef)
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
      accessDeniedCode: 'payment_method_failed',
      connectionFailed: true,
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
      conversation: interruptedConversation,
      disabled: true,
      hasPromptCompleted: false,
      interruptedTurnAwaitingResume: true,
      isLoading: false,
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
      conversation: completedConversation,
      defaultMode: 'server-mode',
      isLoading: false,
    })
    render(
      <MemoryRouter
        initialEntries={[
          '/projects/cube?zookeeper-prompt=make+a+gear&ttc-prompt=legacy&keep=yes',
        ]}
      >
        <ZookeeperConversationPane
          {...createPaneProps(fake.controller, {
            zookeeperMode: {
              project: undefined,
              user: 'user-mode',
            } as PaneProps['zookeeperMode'],
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
