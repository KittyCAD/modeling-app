import type { ClientErrorReport, MlCopilotServerMessage } from '@kittycad/lib'
import { resetReportedClientErrorsForTests } from '@src/lib/clientErrors'
import type { FileMeta } from '@src/lib/types'
import {
  type Conversation,
  createZookeeperCorrelation,
  type MlCopilotModeOption,
  ZookeeperConversationToMarkdown,
  type ZookeeperManagerContext,
  type ZookeeperManagerEvents,
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
  ZookeeperSetupErrors,
  zookeeperManagerMachine,
  NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS,
  parseMlCopilotModesResult,
  toZookeeperConversationUserRequest,
  ZOOKEEPER_HEARTBEAT_INTERVAL_MS,
  ZOOKEEPER_HEARTBEAT_TIMEOUT_MS,
  ZOOKEEPER_SETUP_ATTEMPT_TIMEOUT_MS,
  ZOOKEEPER_SETUP_INACTIVITY_TIMEOUT_MS,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { S } from '@src/machines/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

function stubClientErrorFetch() {
  resetReportedClientErrorsForTests()
  const reports: ClientErrorReport[] = []
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_input, init) => {
      if (typeof init?.body !== 'string') {
        throw new Error('Expected a client error report request body')
      }
      reports.push(JSON.parse(init.body))

      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  return { fetchMock, reports }
}

class TestSocket extends EventTarget {
  sentPayloads: string[] = []
  readyState: number = WebSocket.CLOSED

  send(payload: string) {
    this.sentPayloads.push(payload)
  }

  close = vi.fn()
}

class ControllableSetupWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: ControllableSetupWebSocket[] = []

  readonly url: string
  readonly sentPayloads: string[] = []
  binaryType: BinaryType = 'blob'
  readyState = ControllableSetupWebSocket.CONNECTING

  constructor(url: string) {
    super()
    this.url = url
    ControllableSetupWebSocket.instances.push(this)
  }

  send(payload: string) {
    this.sentPayloads.push(payload)
  }

  open() {
    this.readyState = ControllableSetupWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify(payload),
      })
    )
  }

  close = vi.fn(() => {
    this.closeWithCode(1000)
  })

  closeWithCode(code: number, reason = '') {
    if (this.readyState === ControllableSetupWebSocket.CLOSED) {
      return
    }
    this.readyState = ControllableSetupWebSocket.CLOSED
    const closeEvent = new Event('close')
    Object.defineProperties(closeEvent, {
      code: { value: code },
      reason: { value: reason },
      wasClean: { value: code === 1000 },
    })
    this.dispatchEvent(closeEvent)
  }
}

type TestWebSocket = Pick<ZookeeperManagerContext, 'ws'>['ws'] & TestSocket
type SetupActorInput = {
  event: Extract<ZookeeperManagerEvents, { type: ZookeeperManagerStates.Setup }>
  context: ZookeeperManagerContext
}

const completedConversationStartedAt = new Date('2026-07-15T12:00:00.000Z')

describe('createZookeeperCorrelation', () => {
  it('creates a unique correlation ID and includes the Engine API call ID', () => {
    const first = createZookeeperCorrelation('engine-api-call-id')
    const second = createZookeeperCorrelation('engine-api-call-id')

    expect(first.correlation_id).not.toBe(second.correlation_id)
    expect(first.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(first.engine_api_call_id).toBe('engine-api-call-id')
  })

  it('omits the Engine API call ID before an Engine session exists', () => {
    expect(createZookeeperCorrelation(undefined)).not.toHaveProperty(
      'engine_api_call_id'
    )
  })
})

describe('toZookeeperConversationUserRequest', () => {
  it('keeps display metadata without retaining project or attachment bytes', () => {
    const currentFiles = {
      'main.kcl': [1, 2, 3],
      'reference.step': [4, 5, 6],
    }
    const attachmentData = [7, 8, 9]
    const wireRequest = {
      type: 'user' as const,
      content: 'Use the attached reference',
      current_files: currentFiles,
      additional_files: [
        {
          name: 'reference.png',
          mimetype: 'image/png',
          data: attachmentData,
          data_ref: 'attachments/reference.png',
          metadata: { source: 'upload' },
        },
      ],
      mode: 'custom-mode',
      active_file: 'main.kcl',
      project_name: 'memory-test',
      correlation_id: 'correlation-id',
      engine_api_call_id: 'engine-api-call-id',
    }

    const conversationRequest = toZookeeperConversationUserRequest(wireRequest)

    expect(conversationRequest).toStrictEqual({
      type: 'user',
      content: 'Use the attached reference',
      additional_files: [
        {
          name: 'reference.png',
          mimetype: 'image/png',
        },
      ],
      mode: 'custom-mode',
      active_file: 'main.kcl',
      project_name: 'memory-test',
      correlation_id: 'correlation-id',
      engine_api_call_id: 'engine-api-call-id',
    })
    expect(conversationRequest).not.toHaveProperty('current_files')
    expect(conversationRequest.additional_files?.[0]).not.toHaveProperty('data')

    expect(wireRequest.current_files).toBe(currentFiles)
    expect(wireRequest.additional_files[0]?.data).toBe(attachmentData)
  })

  it('drops malformed attachment metadata without dropping the request', () => {
    const malformedRequest = {
      type: 'user',
      content: 'Keep this prompt',
      current_files: {
        'main.kcl': [1, 2, 3],
      },
      additional_files: [
        null,
        {},
        { name: 1, mimetype: 'image/png' },
        { name: 'missing-mimetype.png', mimetype: null },
        {
          name: 'valid.png',
          mimetype: 'image/png',
          data: [4, 5, 6],
        },
      ],
    } as unknown as Parameters<typeof toZookeeperConversationUserRequest>[0]

    expect(toZookeeperConversationUserRequest(malformedRequest)).toStrictEqual({
      type: 'user',
      content: 'Keep this prompt',
      additional_files: [
        {
          name: 'valid.png',
          mimetype: 'image/png',
        },
      ],
    })

    for (const additionalFiles of [null, { name: 'not-an-array' }]) {
      const request = {
        type: 'user',
        content: 'Keep this prompt too',
        additional_files: additionalFiles,
      } as unknown as Parameters<typeof toZookeeperConversationUserRequest>[0]

      expect(toZookeeperConversationUserRequest(request)).toStrictEqual({
        type: 'user',
        content: 'Keep this prompt too',
      })
    }
  })
})

const completedConversation: Conversation = {
  exchanges: [
    {
      deltasAggregated: '',
      request: {
        type: 'user',
        content: 'make me a sandwich',
      },
      responses: [
        {
          end_of_stream: {
            whole_response: 'sandwich complete',
          },
        },
      ],
      startedAt: completedConversationStartedAt,
    },
  ],
}

describe('zookeeperManagerMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ControllableSetupWebSocket.instances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('parseMlCopilotModesResult', () => {
    const modes = [
      {
        id: 'standard',
        label: 'Standard',
        description: 'Faster reasoning. Best for quick edits and simple tasks.',
        icon: 'stopwatch',
      },
      {
        id: 'deep',
        label: 'Deep',
        description: 'More thorough reasoning. Best for complex designs.',
        icon: 'brain',
      },
    ]
    const parsedModes = modes.map((mode) => ({ ...mode, disabled: false }))

    it('parses the modes_response envelope from the API', () => {
      expect(
        parseMlCopilotModesResult({
          modes_response: { default_mode: 'standard', modes },
        })
      ).toStrictEqual({ defaultMode: 'standard', modeOptions: parsedModes })
    })

    it('preserves disabled mode availability and defaults missing values to enabled', () => {
      expect(
        parseMlCopilotModesResult({
          modes_response: {
            default_mode: 'deep',
            modes: [{ ...modes[0], disabled: true }, modes[1]],
          },
        })
      ).toStrictEqual({
        defaultMode: 'deep',
        modeOptions: [
          { ...modes[0], disabled: true },
          { ...modes[1], disabled: false },
        ],
      })
    })

    it('returns null for unrelated payloads', () => {
      expect(parseMlCopilotModesResult({ something_else: true })).toBeNull()
    })

    it('keeps the response but exposes no options when every mode entry fails validation', () => {
      expect(
        parseMlCopilotModesResult({
          modes_response: {
            default_mode: 'standard',
            modes: [
              {
                id: 'standard',
                label: 'Standard',
                description: 'Faster reasoning.',
                icon: 'not-a-real-icon',
              },
            ],
          },
        })
      ).toStrictEqual({ defaultMode: 'standard', modeOptions: [] })
    })
  })

  describe('ModesReceive', () => {
    it('updates mode metadata before the machine reaches ready', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const modeOptions: MlCopilotModeOption[] = [
        {
          id: 'standard',
          label: 'Standard',
          description: 'Faster reasoning.',
          icon: 'stopwatch',
          disabled: false,
        },
      ]
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: { exchanges: [] },
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerTransitions.ModesReceive,
        defaultMode: 'standard',
        modeOptions,
      })

      expect(actor.getSnapshot().context.defaultMode).toBe('standard')
      expect(actor.getSnapshot().context.modeOptions).toStrictEqual(modeOptions)

      actor.stop()
    })
  })

  describe('Setup', () => {
    beforeEach(() => {
      stubClientErrorFetch()
    })

    it('does not retain project or attachment bytes from replayed requests', async () => {
      vi.stubGlobal('WebSocket', ControllableSetupWebSocket)
      const actor = createActor(zookeeperManagerMachine, {
        input: {
          apiToken: 'token',
        },
      }).start()

      try {
        actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: vi.fn(),
          conversationId: 'conversation-id',
        })

        const socket = ControllableSetupWebSocket.instances[0]
        socket.open()
        await vi.waitFor(() => {
          expect(socket.sentPayloads).toContain(
            JSON.stringify({ type: 'list_modes' })
          )
        })

        const replayedRequest = {
          type: 'user',
          content: 'Use this reference',
          current_files: {
            'main.kcl': [1, 2, 3],
          },
          additional_files: [
            {
              name: 'reference.png',
              mimetype: 'image/png',
              data: [4, 5, 6],
              metadata: { source: 'upload' },
            },
          ],
          correlation_id: 'correlation-id',
        }
        const replayedToolOutput = {
          tool_output: {
            result: {
              type: 'edit_kcl_code',
              status_code: 200,
              outputs: {
                'main.kcl': 'cube() |> fillet(radius = 2)',
              },
            },
          },
        } satisfies MlCopilotServerMessage
        const replayedProjectUpdate = {
          project_updated: {
            files: {
              'main.kcl': 'cube() |> fillet(radius = 2)',
            },
          },
        }
        const replayedEndOfStream = {
          end_of_stream: {
            whole_response: 'Done.',
          },
        }
        const malformedReplayedRequest = {
          type: 'user',
          content: 'Keep this older prompt',
          additional_files: null,
        }
        const malformedReplayEndOfStream = {
          end_of_stream: {
            whole_response: 'Also done.',
          },
        }
        const encodeReplayMessage = (message: unknown) =>
          Array.from(new TextEncoder().encode(JSON.stringify(message)))
        socket.receive({
          replay: {
            messages: [
              encodeReplayMessage(replayedRequest),
              encodeReplayMessage(replayedToolOutput),
              encodeReplayMessage(replayedProjectUpdate),
              encodeReplayMessage(replayedEndOfStream),
              encodeReplayMessage(malformedReplayedRequest),
              encodeReplayMessage(malformedReplayEndOfStream),
            ],
          },
        })
        socket.receive({
          conversation_id: {
            conversation_id: 'conversation-id',
          },
        })

        await waitFor(actor, (state) =>
          state.matches(ZookeeperManagerStates.WaitForContinueCheck)
        )

        const request =
          actor.getSnapshot().context.conversation?.exchanges[0]?.request
        expect(request).toStrictEqual({
          type: 'user',
          content: 'Use this reference',
          additional_files: [
            {
              name: 'reference.png',
              mimetype: 'image/png',
            },
          ],
          correlation_id: 'correlation-id',
        })
        expect(request).not.toHaveProperty('current_files')
        expect(request?.additional_files?.[0]).not.toHaveProperty('data')
        expect(
          actor.getSnapshot().context.conversation?.exchanges[0]?.responses
        ).toStrictEqual([replayedEndOfStream])
        expect(
          actor.getSnapshot().context.conversation?.exchanges[1]
        ).toStrictEqual({
          request: {
            type: 'user',
            content: 'Keep this older prompt',
          },
          responses: [malformedReplayEndOfStream],
          deltasAggregated: 'Also done.',
          startedAt: undefined,
        })
      } finally {
        actor.stop()
      }
    })

    it('stops retrying and exposes a recoverable failure after repeated setup errors', async () => {
      const { fetchMock, reports } = stubClientErrorFetch()
      let setupAttempts = 0
      let shouldFail = true
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(() => {
            setupAttempts += 1
            return shouldFail
              ? Promise.reject('setup failed')
              : Promise.resolve({
                  conversation: { exchanges: [] },
                  conversationId: 'conversation-id',
                })
          }),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })

      await waitFor(
        actor,
        (state) => state.matches(S.Await) && state.context.setupFailed
      )

      expect(setupAttempts).toBe(NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS)
      expect(actor.getSnapshot().context).toMatchObject({
        abruptlyClosed: true,
        setupAttempt: NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS,
        setupFailed: true,
        conversationId: 'conversation-id',
      })
      expect(actor.getSnapshot().context.closeReason).toContain(
        `${NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS} attempts`
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        code: 'zookeeper_setup_error',
        error_name: 'Error',
        message: 'setup failed',
      })
      expect(JSON.parse(reports[0]?.stack ?? '{}')).toMatchObject({
        terminal: true,
        setupAttempt: NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS,
        conversationId: 'conversation-id',
      })

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })

      await waitFor(
        actor,
        (state) => state.matches(S.Await) && state.context.setupFailed
      )

      expect(setupAttempts).toBe(NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS * 2)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(reports).toHaveLength(2)

      shouldFail = false
      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      expect(setupAttempts).toBe(NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS * 2 + 1)
      expect(actor.getSnapshot().context).toMatchObject({
        abruptlyClosed: false,
        setupAttempt: 0,
        setupFailed: false,
        conversationId: 'conversation-id',
      })

      actor.stop()
    })

    it('times out setup attempts instead of waiting forever', async () => {
      const { fetchMock, reports } = stubClientErrorFetch()
      vi.useFakeTimers()
      let setupAttempts = 0
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(() => {
            setupAttempts += 1
            return new Promise(() => {})
          }),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      try {
        actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: vi.fn(),
          conversationId: 'conversation-id',
        })

        for (
          let attempt = 0;
          attempt < NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS;
          attempt += 1
        ) {
          await vi.advanceTimersByTimeAsync(
            ZOOKEEPER_SETUP_INACTIVITY_TIMEOUT_MS
          )
        }

        expect(setupAttempts).toBe(NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS)
        expect(actor.getSnapshot().matches(S.Await)).toBe(true)
        expect(actor.getSnapshot().context.setupFailed).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({
          code: 'zookeeper_setup_error',
          error_name: 'Error',
          message: `Zookeeper couldn't load this conversation after ${NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS} attempts.`,
        })
      } finally {
        actor.stop()
        vi.useRealTimers()
      }
    })

    it('keeps a saved conversation id until the user explicitly clears it', async () => {
      const { fetchMock, reports } = stubClientErrorFetch()
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(() => Promise.reject(ZookeeperSetupErrors.ConversationNotFound)),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'saved-conversation-id',
      })

      await waitFor(
        actor,
        (state) => state.matches(S.Await) && state.context.setupFailed
      )

      expect(actor.getSnapshot().context.conversationId).toBe(
        'saved-conversation-id'
      )
      expect(actor.getSnapshot().context.closeReason).toContain(
        'load this conversation'
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        code: 'zookeeper_setup_error',
        error_name: 'Error',
        message: ZookeeperSetupErrors.ConversationNotFound,
      })

      actor.stop()
    })

    it('enforces the hard attempt deadline despite ongoing progress', async () => {
      const { fetchMock, reports } = stubClientErrorFetch()
      vi.useFakeTimers()
      let setupAttempts = 0
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(() => {
            setupAttempts += 1
            return new Promise(() => {})
          }),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      try {
        actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: vi.fn(),
          conversationId: 'conversation-id',
        })

        for (
          let attempt = 0;
          attempt < NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS;
          attempt += 1
        ) {
          const progressInterval = ZOOKEEPER_SETUP_INACTIVITY_TIMEOUT_MS - 1
          const progressEventsBeforeHardDeadline = Math.floor(
            ZOOKEEPER_SETUP_ATTEMPT_TIMEOUT_MS / progressInterval
          )
          for (
            let progressEvent = 0;
            progressEvent < progressEventsBeforeHardDeadline;
            progressEvent += 1
          ) {
            await vi.advanceTimersByTimeAsync(progressInterval)
            actor.send({ type: ZookeeperManagerTransitions.SetupProgress })
          }
          await vi.advanceTimersByTimeAsync(
            ZOOKEEPER_SETUP_ATTEMPT_TIMEOUT_MS -
              progressInterval * progressEventsBeforeHardDeadline
          )
        }

        expect(setupAttempts).toBe(NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS)
        expect(actor.getSnapshot().matches(S.Await)).toBe(true)
        expect(actor.getSnapshot().context.setupFailed).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(reports).toHaveLength(1)
      } finally {
        actor.stop()
        vi.useRealTimers()
      }
    })

    it('recovers if a responsive websocket later stops responding', async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', ControllableSetupWebSocket)
      const actor = createActor(zookeeperManagerMachine, {
        input: {
          apiToken: 'token',
        },
      }).start()

      try {
        actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: vi.fn(),
          conversationId: 'conversation-id',
        })

        const socket = ControllableSetupWebSocket.instances[0]
        socket.open()
        await vi.waitFor(() => {
          expect(socket.sentPayloads).toContain(
            JSON.stringify({ type: 'list_modes' })
          )
        })

        for (let heartbeat = 0; heartbeat < 3; heartbeat += 1) {
          await vi.advanceTimersByTimeAsync(20_000)
          socket.receive({ pong: {} })
        }
        await vi.advanceTimersByTimeAsync(20_000)
        socket.receive({
          conversation_id: {
            conversation_id: 'conversation-id',
          },
        })

        await vi.waitFor(() => {
          expect(
            actor
              .getSnapshot()
              .matches(ZookeeperManagerStates.WaitForContinueCheck)
          ).toBe(true)
        })

        expect(ControllableSetupWebSocket.instances).toHaveLength(1)
        expect(actor.getSnapshot().context.setupAttempt).toBe(0)

        await vi.advanceTimersByTimeAsync(ZOOKEEPER_HEARTBEAT_INTERVAL_MS)
        vi.setSystemTime(Date.now() + ZOOKEEPER_HEARTBEAT_TIMEOUT_MS * 2)
        await vi.advanceTimersByTimeAsync(ZOOKEEPER_HEARTBEAT_INTERVAL_MS)

        expect(
          actor
            .getSnapshot()
            .matches(ZookeeperManagerStates.WaitForContinueCheck)
        ).toBe(true)

        socket.receive({ pong: {} })
        await vi.advanceTimersByTimeAsync(
          ZOOKEEPER_HEARTBEAT_TIMEOUT_MS + ZOOKEEPER_HEARTBEAT_INTERVAL_MS * 2
        )

        expect(actor.getSnapshot().matches(S.Await)).toBe(true)
        expect(actor.getSnapshot().context).toMatchObject({
          abruptlyClosed: true,
          closeReason: 'Zookeeper connection timed out.',
        })
        expect(socket.close).toHaveBeenCalledOnce()
      } finally {
        actor.stop()
        vi.useRealTimers()
      }
    })
  })

  describe('ContinueCheck', () => {
    it('sends continue requests when the last exchange was interrupted', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const interruptedConversation: Conversation = {
        exchanges: [
          {
            request: {
              type: 'user',
              content: 'make me a sandwich',
            },
            responses: [
              {
                reasoning: {
                  type: 'text',
                  content: 'still working',
                },
              },
            ],
            deltasAggregated: '',
          },
        ],
      }
      const projectFiles: FileMeta[] = [
        {
          type: 'kcl',
          relPath: 'main.kcl',
          absPath: '/tmp/main.kcl',
          fileContents: 'cube()',
          execStateFileNamesIndex: 0,
        },
        {
          type: 'other',
          relPath: 'notes.txt',
          data: new Blob(['notes']),
        },
      ]
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: interruptedConversation,
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles,
        activeFile: 'newFile.kcl',
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Ready)
      )

      expect(actor.getSnapshot().context.awaitingResponse).toBe(true)
      expect(actor.getSnapshot().context.projectNameCurrentlyOpened).toBe(
        'zoo-project'
      )
      expect(ws.sentPayloads).toStrictEqual([
        JSON.stringify({
          type: 'system',
          command: 'continue',
        }),
        JSON.stringify({
          type: 'project_context',
          project_name: 'zoo-project',
          current_files: {
            'main.kcl': Array.from(new TextEncoder().encode('cube()')),
            'notes.txt': Array.from(new TextEncoder().encode('notes')),
          },
          active_file: 'newFile.kcl',
        }),
      ])

      actor.stop()
    })
  })

  describe('MessageSend', () => {
    it('sends full wire bytes but retains only conversation metadata', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: { exchanges: [] },
            conversationId: 'conversation-id',
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      try {
        actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: vi.fn(),
          conversationId: 'conversation-id',
        })
        await waitFor(actor, (state) =>
          state.matches(ZookeeperManagerStates.WaitForContinueCheck)
        )

        actor.send({
          type: ZookeeperManagerStates.ContinueCheck,
          projectName: 'memory-test',
          projectFiles: [],
          activeFile: 'main.kcl',
        })
        await waitFor(actor, (state) =>
          state.matches(ZookeeperManagerStates.Ready)
        )

        const projectFileBytes = Array.from(new TextEncoder().encode('cube()'))
        const attachmentBytes = new Uint8Array([7, 8, 9])
        const messageSendEvent = {
          type: ZookeeperManagerTransitions.MessageSend,
          prompt: 'Use the attached reference',
          projectForPromptOutput: { name: 'memory-test' },
          applicationProjectDirectory: '/projects',
          fileSelectedDuringPrompting: {
            entry: {
              path: '/projects/memory-test/main.kcl',
              name: 'main.kcl',
              children: null,
            },
            content: 'cube()',
          },
          projectFiles: [
            {
              type: 'kcl',
              relPath: 'main.kcl',
              absPath: '/projects/memory-test/main.kcl',
              fileContents: 'cube()',
              execStateFileNamesIndex: 0,
            },
          ],
          selections: null,
          artifactGraph: new Map(),
          kclManager: {},
          engineCommandManager: { apiCallId: 'engine-api-call-id' },
          wasmInstance: {},
          mode: 'custom-mode',
          additionalFiles: [
            {
              name: 'reference.png',
              type: 'image/png',
              arrayBuffer: async () => attachmentBytes.slice().buffer,
            },
          ],
        } as unknown as Extract<
          ZookeeperManagerEvents,
          { type: ZookeeperManagerTransitions.MessageSend }
        >

        actor.send(messageSendEvent)
        await waitFor(actor, (state) => state.context.awaitingResponse)

        expect(ws.sentPayloads).toHaveLength(1)
        const wireRequest = JSON.parse(ws.sentPayloads[0])
        expect(wireRequest).toMatchObject({
          type: 'user',
          content: 'Use the attached reference',
          project_name: 'memory-test',
          active_file: 'main.kcl',
          mode: 'custom-mode',
          engine_api_call_id: 'engine-api-call-id',
          current_files: {
            'main.kcl': projectFileBytes,
          },
          additional_files: [
            {
              name: 'reference.png',
              mimetype: 'image/png',
              data: Array.from(attachmentBytes),
            },
          ],
        })

        const conversationRequest =
          actor.getSnapshot().context.conversation?.exchanges[0]?.request
        expect(conversationRequest).toMatchObject({
          type: 'user',
          content: 'Use the attached reference',
          project_name: 'memory-test',
          active_file: 'main.kcl',
          mode: 'custom-mode',
          engine_api_call_id: 'engine-api-call-id',
          additional_files: [
            {
              name: 'reference.png',
              mimetype: 'image/png',
            },
          ],
        })
        expect(conversationRequest).not.toHaveProperty('current_files')
        expect(conversationRequest?.additional_files?.[0]).not.toHaveProperty(
          'data'
        )
      } finally {
        actor.stop()
      }
    })
  })

  describe('ResponseReceive', () => {
    const createReadyActor = async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: { exchanges: [] },
            conversationId: 'conversation-id',
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })
      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'memory-test',
        projectFiles: [],
        activeFile: 'main.kcl',
      })
      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Ready)
      )

      return actor
    }

    it('drops project snapshots and consumed tool outputs without mutating older snapshots', async () => {
      const actor = await createReadyActor()
      const observedToolOutputs: MlCopilotServerMessage[] = []
      const subscription = actor.subscribe((snapshot) => {
        const lastExchange = snapshot.context.conversation?.exchanges.at(-1)
        const lastResponse = lastExchange?.responses.at(-1)
        if (lastResponse && 'tool_output' in lastResponse) {
          observedToolOutputs.push(lastResponse)
        }
      })
      const filesResponse = {
        files: {
          files: [
            {
              name: 'preview.png',
              mimetype: 'image/png',
              data: [1, 2, 3],
            },
          ],
        },
      } satisfies MlCopilotServerMessage
      const projectUpdatedResponse = {
        project_updated: {
          files: {
            'main.kcl': 'large project snapshot',
          },
        },
      } satisfies MlCopilotServerMessage
      const toolOutputResponse = {
        tool_output: {
          result: {
            type: 'edit_kcl_code',
            status_code: 200,
            outputs: {
              'main.kcl': 'updated project snapshot',
            },
          },
        },
      } satisfies MlCopilotServerMessage
      const endOfStreamResponse = {
        end_of_stream: {
          whole_response: 'Done.',
        },
      } satisfies MlCopilotServerMessage

      try {
        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: filesResponse,
        })

        const snapshotBeforeProjectUpdate =
          actor.getSnapshot().context.conversation
        expect(
          snapshotBeforeProjectUpdate?.exchanges[0]?.responses
        ).toStrictEqual([filesResponse])
        expect(actor.getSnapshot().context.lastMessageType).toBe('files')

        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: projectUpdatedResponse,
        })

        expect(
          snapshotBeforeProjectUpdate?.exchanges[0]?.responses
        ).toStrictEqual([filesResponse])
        expect(
          actor.getSnapshot().context.conversation?.exchanges[0]?.responses
        ).toStrictEqual([filesResponse])

        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: toolOutputResponse,
        })

        const snapshotWithToolOutput = actor.getSnapshot().context.conversation
        expect(snapshotWithToolOutput?.exchanges[0]?.responses).toStrictEqual([
          filesResponse,
          toolOutputResponse,
        ])
        expect(observedToolOutputs).toStrictEqual([toolOutputResponse])

        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: endOfStreamResponse,
        })

        expect(snapshotWithToolOutput?.exchanges[0]?.responses).toStrictEqual([
          filesResponse,
          toolOutputResponse,
        ])
        expect(
          actor.getSnapshot().context.conversation?.exchanges[0]?.responses
        ).toStrictEqual([filesResponse, endOfStreamResponse])
        expect(observedToolOutputs).toStrictEqual([toolOutputResponse])
      } finally {
        subscription.unsubscribe()
        actor.stop()
      }
    })

    it('releases a tool output before recording a terminal error', async () => {
      const actor = await createReadyActor()
      const reasoningResponse = {
        reasoning: {
          type: 'text',
          content: 'Working on it.',
        },
      } satisfies MlCopilotServerMessage
      const toolOutputResponse = {
        tool_output: {
          result: {
            type: 'edit_kcl_code',
            status_code: 200,
            outputs: {
              'main.kcl': 'updated project snapshot',
            },
          },
        },
      } satisfies MlCopilotServerMessage
      const errorResponse = {
        error: {
          detail: 'The stream failed.',
        },
      } satisfies MlCopilotServerMessage

      try {
        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: reasoningResponse,
        })
        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: toolOutputResponse,
        })

        expect(
          actor.getSnapshot().context.conversation?.exchanges[0]?.responses
        ).toStrictEqual([reasoningResponse, toolOutputResponse])

        actor.send({
          type: ZookeeperManagerTransitions.ResponseReceive,
          response: errorResponse,
        })

        expect(
          actor.getSnapshot().context.conversation?.exchanges
        ).toStrictEqual([
          {
            responses: [reasoningResponse],
            deltasAggregated: '',
          },
          {
            responses: [errorResponse],
            deltasAggregated: '',
          },
        ])
      } finally {
        actor.stop()
      }
    })
  })

  describe('ConversationClose', () => {
    it('stops setup without retrying when the browser goes offline', async () => {
      let setupAttempts = 0
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(() => {
            setupAttempts += 1
            return new Promise(() => {})
          }),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })
      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Setup)
      )

      actor.send({
        type: ZookeeperManagerTransitions.NetworkOffline,
      })
      await waitFor(actor, (state) => state.matches(S.Await))

      expect(setupAttempts).toBe(1)
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(true)
      expect(actor.getSnapshot().context.setupFailed).toBe(false)
      expect(actor.getSnapshot().context.closeReason).toBe(
        'No internet connection.'
      )

      actor.stop()
    })

    it('closes a live socket and preserves the conversation when the browser goes offline', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      ws.readyState = WebSocket.OPEN
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: completedConversation,
            conversationId: 'conversation-id',
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })
      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })
      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Ready)
      )

      actor.send({
        type: ZookeeperManagerTransitions.NetworkOffline,
      })
      await waitFor(actor, (state) => state.matches(S.Await))

      expect(ws.close).toHaveBeenCalledOnce()
      expect(actor.getSnapshot().context.conversation).toBe(
        completedConversation
      )
      expect(actor.getSnapshot().context.conversationId).toBe('conversation-id')
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(true)
      expect(actor.getSnapshot().context.closeReason).toBe(
        'No internet connection.'
      )

      actor.stop()
    })

    it('clears conversation state on an intentional close', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      ws.readyState = WebSocket.OPEN
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            ws,
            conversation: completedConversation,
            conversationId: 'conversation-id',
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Ready)
      )

      actor.send({
        type: ZookeeperManagerTransitions.ConversationClose,
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(ws.close).toHaveBeenCalled()
      expect(actor.getSnapshot().context.conversation).toBeUndefined()
      expect(actor.getSnapshot().context.conversationId).toBeUndefined()
      expect(actor.getSnapshot().context.ws).toBeUndefined()
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(false)

      actor.stop()
    })

    it('keeps recoverable context after an abrupt close', async () => {
      const { fetchMock } = stubClientErrorFetch()
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      let setupContext: ZookeeperManagerContext | undefined
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async ({ input }) => {
            setupContext = input.context
            return {
              ws,
              conversation: completedConversation,
              conversationId: 'conversation-id',
            }
          }),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.Ready)
      )

      actor.send({
        type: ZookeeperManagerTransitions.AbruptClose,
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(actor.getSnapshot().context.conversation).toBe(
        completedConversation
      )
      expect(actor.getSnapshot().context.conversationId).toBe('conversation-id')
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
        conversationId: 'conversation-id',
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      expect(setupContext?.cachedSetup?.activeExchangeStartedAt).toBe(
        completedConversationStartedAt
      )

      actor.stop()
    })
  })

  describe('client-side actor errors', () => {
    it('reports local actor invocation failures', async () => {
      const { fetchMock, reports } = stubClientErrorFetch()
      const machine = zookeeperManagerMachine.provide({
        actors: {
          [ZookeeperManagerStates.Setup]: fromPromise<
            Partial<ZookeeperManagerContext>,
            SetupActorInput
          >(async () => ({
            conversation: { exchanges: [] },
            conversationId: 'conversation-id',
          })),
        },
      })
      const actor = createActor(machine, {
        input: {
          apiToken: '',
        },
      }).start()

      actor.send({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(ZookeeperManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(reports).toHaveLength(1)
      const report = reports[0]
      if (!report) {
        throw new Error('Expected a client error report')
      }
      expect(report).toMatchObject({
        code: 'zookeeper_actor_error',
        error_name: 'Error',
        message: 'WebSocket not present',
      })
      if (typeof report.stack !== 'string') {
        throw new Error('Expected client error report stack')
      }
      expect(JSON.parse(report.stack)).toMatchObject({
        source: 'ZookeeperManagerMachine',
        conversationId: 'conversation-id',
      })

      actor.stop()
    })
  })

  describe('ZookeeperConversationToMarkdown', () => {
    it('has undefined conversation, return empty string', async () => {
      const output = ZookeeperConversationToMarkdown(undefined)
      expect(output.length).toBe(0)
    })
    it('has conversation, return non-empty string', async () => {
      const conversation: Conversation = {
        exchanges: [
          {
            deltasAggregated: '',
            request: {
              type: 'user',
              content: 'make me a sandwich',
            },
            responses: [
              {
                reasoning: {
                  type: 'updated_kcl_file',
                  file_name: 'main.kcl',
                  content: '// updated_kcl_file',
                },
              },
              {
                reasoning: {
                  type: 'kcl_code_error',
                  error: 'nonsense computation',
                },
              },
              {
                reasoning: {
                  type: 'generated_kcl_code',
                  code: '// code',
                },
              },
              {
                reasoning: {
                  type: 'design_plan',
                  steps: [
                    {
                      filepath_to_edit: 'main.kcl',
                      edit_instructions: 'instruction 1',
                    },
                    {
                      filepath_to_edit: 'main.kcl',
                      edit_instructions: 'instruction 2',
                    },
                    {
                      filepath_to_edit: 'main.kcl',
                      edit_instructions: 'instruction n',
                    },
                  ],
                },
              },
              {
                end_of_stream: {
                  whole_response: '// whole_response',
                },
              },
            ],
          },
        ],
      }
      const output = ZookeeperConversationToMarkdown(conversation)

      // All text is valid markdown so checking the validity is no-op.
      // All we can check is _some_ content made it through to the other side,
      // and that all code paths have been taken via the test.
      expect(output.length).toBeGreaterThan(0)
    })

    // Motivated by https://github.com/KittyCAD/modeling-app/issues/9912
    it('error is a end-of-stream signal as well, showing the full response', async () => {
      const conversation: Conversation = {
        exchanges: [
          {
            deltasAggregated: '',
            request: {
              type: 'user',
              content: 'make me a sandwich',
            },
            responses: [
              {
                reasoning: {
                  type: 'text',
                  content: 'jordan was here',
                },
              },
              {
                error: {
                  detail: 'interrupted',
                },
              },
              {
                end_of_stream: {
                  whole_response: '// whole_response',
                },
              },
            ],
          },
        ],
      }
      const output = ZookeeperConversationToMarkdown(conversation)

      expect(output).toContain('jordan was here')
      expect(output).toContain('interrupted')
      expect(output).toContain('whole_response')
    })
  })
})
