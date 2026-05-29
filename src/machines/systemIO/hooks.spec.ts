import { collectMlEphantToolOutputRequests } from '@src/machines/systemIO/hooks'
import { describe, expect, it } from 'vitest'

describe('System IO hooks', () => {
  it('collects tool outputs even when the exchange has already ended', () => {
    const requests = collectMlEphantToolOutputRequests([
      {
        responses: [
          {
            reasoning: {
              type: 'deleted_kcl_file',
              file_name: 'old.kcl',
            },
          },
          {
            tool_output: {
              result: {
                status_code: 200,
                type: 'edit_kcl_code',
                project_name: 'demo-project',
                outputs: {
                  'main.kcl': 'boxLength = 120',
                },
              },
            },
          },
          {
            end_of_stream: {},
          },
        ],
      },
    ] as Parameters<typeof collectMlEphantToolOutputRequests>[0])

    expect(requests).toEqual([
      {
        toolOutput: {
          status_code: 200,
          type: 'edit_kcl_code',
          project_name: 'demo-project',
          outputs: {
            'main.kcl': 'boxLength = 120',
          },
        },
        filesToDelete: [{ requestedFileName: 'old.kcl' }],
      },
    ])
  })
})
