import type { MlCopilotFile, MlCopilotServerMessage } from '@kittycad/lib'
import { ResponsesCard } from '@src/components/ExchangeCard'
import { ExportDownloadFiles, Thinking } from '@src/components/Thinking'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('export download files', () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => 'blob:export-download')
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('keeps export downloads out of the reasoning view', () => {
    const exportFile: MlCopilotFile = {
      name: 'model.step',
      mimetype: 'application/step',
      data: [1, 2, 3],
      metadata: { export_format: 'step' },
    }

    render(
      <Thinking
        thoughts={[{ files: { files: [exportFile] } }]}
        isDone={false}
        onlyShowImmediateThought={false}
      />
    )

    expect(screen.queryByText('model.step')).not.toBeInTheDocument()
    expect(screen.queryByText('Zookeeper File')).not.toBeInTheDocument()
  })

  test('keeps non-export files in reasoning when a message is mixed', () => {
    const exportFile: MlCopilotFile = {
      name: 'model.step',
      mimetype: 'application/step',
      data: [1, 2, 3],
      metadata: { export_format: 'step' },
    }
    const snapshotFile: MlCopilotFile = {
      name: 'snapshot.png',
      mimetype: 'image/png',
      data: [1, 2, 3],
    }

    render(
      <Thinking
        thoughts={[{ files: { files: [snapshotFile, exportFile] } }]}
        isDone={false}
        onlyShowImmediateThought={false}
      />
    )

    expect(screen.getByText('snapshot.png')).toBeInTheDocument()
    expect(screen.queryByText('model.step')).not.toBeInTheDocument()
  })

  test('renders an export download without reasoning decoration', () => {
    const exportFile: MlCopilotFile = {
      name: 'model.stl',
      mimetype: 'model/stl',
      data: [1, 2, 3],
      metadata: { export_format: 'stl' },
    }

    render(<ExportDownloadFiles files={[exportFile]} />)

    expect(screen.getByTestId('ml-response-download-files')).toHaveTextContent(
      'model.stl'
    )
    expect(screen.queryByText('Zookeeper File')).not.toBeInTheDocument()
  })

  test('shows exported files with the final response', () => {
    const items: MlCopilotServerMessage[] = [
      {
        files: {
          files: [
            {
              name: 'model.step',
              mimetype: 'application/step',
              data: [1, 2, 3],
              metadata: { export_format: 'step' },
            },
          ],
        },
      },
    ]

    render(
      <ResponsesCard
        items={items}
        deltasAggregated="Exported successfully. The download is ready here."
        isLastResponse={true}
        onClickClearChat={vi.fn()}
      />
    )

    const responseBubble = screen.getByTestId('ml-response-chat-bubble')
    expect(responseBubble).toHaveTextContent(
      'Exported successfully. The download is ready here.'
    )
    expect(within(responseBubble).getByText('model.step')).toBeInTheDocument()
    expect(screen.queryByText('Zookeeper File')).not.toBeInTheDocument()
  })

  test('shows an export streamed after the final response without reloading', () => {
    const items: MlCopilotServerMessage[] = [
      {
        end_of_stream: {
          whole_response: 'Exported successfully. The download is ready here.',
        },
      },
    ]
    const responseCard = () => (
      <ResponsesCard
        items={items}
        deltasAggregated="Exported successfully. The download is ready here."
        isLastResponse={true}
        onClickClearChat={vi.fn()}
      />
    )
    const { rerender } = render(responseCard())

    expect(screen.queryByText('model.step')).not.toBeInTheDocument()

    // The manager appends streamed messages to the existing responses array
    // while replacing the conversation wrapper that triggers this rerender.
    items.push({
      files: {
        files: [
          {
            name: 'model.step',
            mimetype: 'application/step',
            data: [1, 2, 3],
            metadata: { export_format: 'step' },
          },
        ],
      },
    })
    rerender(responseCard())

    expect(screen.getByText('model.step')).toBeInTheDocument()
  })
})
