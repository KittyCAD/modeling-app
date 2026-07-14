import type { ClientErrorReport } from '@kittycad/lib'
import { resetReportedClientErrorsForTests } from '@src/lib/clientErrors'
import type { FileMeta } from '@src/lib/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type Conversation,
  type MlCopilotModeOption,
  ZookeeperConversationToMarkdown,
  type ZookeeperManagerContext,
  type ZookeeperManagerEvents,
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
  zookeeperManagerMachine,
  parseMlCopilotModesResult,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { S } from '@src/machines/utils'
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

type TestWebSocket = Pick<ZookeeperManagerContext, 'ws'>['ws'] & TestSocket
type SetupActorInput = {
  event: Extract<ZookeeperManagerEvents, { type: ZookeeperManagerStates.Setup }>
  context: ZookeeperManagerContext
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

describe('zookeeperManagerMachine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        type: ZookeeperManagerTransitions.AbruptClose,
      })

      await waitFor(actor, (state) => state.matches(S.Await))

      expect(actor.getSnapshot().context.conversation).toBe(
        completedConversation
      )
      expect(actor.getSnapshot().context.conversationId).toBe('conversation-id')
      expect(actor.getSnapshot().context.abruptlyClosed).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()

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
