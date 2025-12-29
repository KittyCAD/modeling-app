import { err } from '@src/lib/trap'
import { join } from 'path'
import fs from 'node:fs'

import { expect, describe, it } from 'vitest'
import { MlEphantConversationToMarkdown } from './mlEphantManagerMachine'

describe('mlEphantManagerMachine', () => {
  describe('MlEphantConversationToMarkdown', () => {
    it('has undefined conversation, return empty string', async () => {
      const output = MlEphantConversationToMarkdown(undefined)
      expect(output.length).toBe(0)
    })
    it('has conversation, return non-empty string', async () => {
      const conversation = {
        exchanges: [
          {
            request: {
              content: 'make me a sandwich',
            },
            responses: [
              {
                reasoning: {
                  type: 'created_kcl_file',
                  content: '// created_kcl_file',
                },
              },
              {
                reasoning: {
                  error: 'nonsense computation',
                },
              },
              {
                reasoning: {
                  code: '// code',
                },
              },
              {
                reasoning: {
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
                  completed_at: new Date().toISOString(),
                  started_at: new Date().toISOString(),
                  whole_response: '// whole_response',
                  conversation_id: 'xxxxxxxxxxxxxxxxxxxxxxxx',
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
