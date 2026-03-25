import { expect, describe, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'
import {
  MlEphantConversationToMarkdown,
  type MlEphantManagerEvents,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
  type Conversation,
  type MlEphantManagerContext,
  mlEphantManagerMachine,
} from '@src/machines/mlEphantManagerMachine'
import type { FileMeta } from '@src/lib/types'

class TestSocket extends EventTarget {
  sentPayloads: string[] = []
  readyState = WebSocket.CLOSED

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

describe('mlEphantManagerMachine', () => {
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
        }),
      ])

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
