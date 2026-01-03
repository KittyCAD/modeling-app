import { expect, describe, it } from 'vitest'
import {
  MlEphantConversationToMarkdown,
  type Conversation,
} from '@src/machines/mlEphantManagerMachine'

describe('mlEphantManagerMachine', () => {
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
  })
})
