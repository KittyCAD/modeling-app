import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileMeta } from '@src/lib/types'

const mockClientErrors = vi.hoisted(() => ({
  reportClientError: vi.fn(async () => undefined),
}))

vi.mock('@src/lib/clientErrors', () => ({
  errorToMessage: (error: unknown, fallback = 'Unknown client error') => {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return fallback
  },
  reportClientError: mockClientErrors.reportClientError,
}))

import {
  type Conversation,
  type MlCopilotModeOption,
  MlEphantConversationToMarkdown,
  type MlEphantManagerContext,
  type MlEphantManagerEvents,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
  mlEphantManagerMachine,
  parseMlCopilotModesResult,
} from '@src/machines/mlEphantManagerMachine'
import { S } from '@src/machines/utils'
import { createActor, fromPromise, waitFor } from 'xstate'

class TestSocket extends EventTarget {
  sentPayloads: string[] = []
  readyState: number = WebSocket.CLOSED

  send(payload: string) {
    this.sentPayloads.push(payload)
  }

  close = vi.fn()
}

type TestWebSocket = Pick<MlEphantManagerContext, 'ws'>['ws'] & TestSocket
type SetupActorInput = {
  event: Extract<MlEphantManagerEvents, { type: MlEphantManagerStates.Setup }>
  context: MlEphantManagerContext
}

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
    },
  ],
}

describe('mlEphantManagerMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('parses the modes_response envelope from the API', () => {
      expect(
        parseMlCopilotModesResult({
          modes_response: { default_mode: 'standard', modes },
        })
      ).toStrictEqual({ defaultMode: 'standard', modeOptions: modes })
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
        },
      ]
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerTransitions.ModesReceive,
        defaultMode: 'standard',
        modeOptions,
      })

      expect(actor.getSnapshot().context.defaultMode).toBe('standard')
      expect(actor.getSnapshot().context.modeOptions).toStrictEqual(modeOptions)

      actor.stop()
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
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles,
        activeFile: 'newFile.kcl',
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.Ready)
      )

      expect(actor.getSnapshot().context.awaitingResponse).toBe(true)
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

  describe('ConversationClose', () => {
    it('clears conversation state on an intentional close', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      ws.readyState = WebSocket.OPEN
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.Ready)
      )

      actor.send({
        type: MlEphantManagerTransitions.ConversationClose,
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
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.Ready)
      )

      actor.send({
        type: MlEphantManagerTransitions.AbruptClose,
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(actor.getSnapshot().context.conversation).toBe(
        completedConversation
      )
      expect(actor.getSnapshot().context.conversationId).toBe('conversation-id')
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(true)
      expect(mockClientErrors.reportClientError).not.toHaveBeenCalled()

      actor.stop()
    })
  })

  describe('ResponseReceive', () => {
    it('does not report server error responses as client errors', async () => {
      const ws: TestWebSocket = new TestSocket() as TestWebSocket
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.Ready)
      )

      actor.send({
        type: MlEphantManagerTransitions.ResponseReceive,
        response: {
          error: {
            detail: 'Zookeeper backend failed',
          },
        },
      })

      await waitFor(
        actor,
        (state) => state.context.conversation?.exchanges.length === 1
      )

      expect(mockClientErrors.reportClientError).not.toHaveBeenCalled()
      expect(actor.getSnapshot().context.awaitingResponse).toBe(false)

      actor.stop()
    })
  })

  describe('client-side actor errors', () => {
    it('reports local actor invocation failures', async () => {
      const machine = mlEphantManagerMachine.provide({
        actors: {
          [MlEphantManagerStates.Setup]: fromPromise<
            Partial<MlEphantManagerContext>,
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
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: vi.fn(),
      })

      await waitFor(actor, (state) =>
        state.matches(MlEphantManagerStates.WaitForContinueCheck)
      )

      actor.send({
        type: MlEphantManagerStates.ContinueCheck,
        projectName: 'zoo-project',
        projectFiles: [],
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(mockClientErrors.reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'zookeeper_actor_error',
          message: 'WebSocket not present',
          dedupeKey: expect.stringContaining(
            'MlEphantManagerMachine:actor-error'
          ),
          extra: expect.objectContaining({
            source: 'MlEphantManagerMachine',
            conversationId: 'conversation-id',
          }),
        })
      )

      actor.stop()
    })
  })

  describe('MlEphantConversationToMarkdown', () => {
    it('has undefined conversation, return empty string', async () => {
      const output = MlEphantConversationToMarkdown(undefined)
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
      const output = MlEphantConversationToMarkdown(conversation)

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
      const output = MlEphantConversationToMarkdown(conversation)

      expect(output).toContain('jordan was here')
      expect(output).toContain('interrupted')
      expect(output).toContain('whole_response')
    })
  })
})
