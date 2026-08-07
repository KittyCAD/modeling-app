import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { getMeasurementEntities } from '@src/registry/extensions/engineScene/measurementUtils'
import { DrawingProjectionDebugPane } from '@src/registry/plugins/drawingProjectionDebug/DrawingProjectionDebugPane'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: vi.fn(),
}))

vi.mock('@src/registry/extensions/engineScene/measurementUtils', () => ({
  getMeasurementEntities: vi.fn(),
}))

function renderPane({
  selectedEntities = [{ id: 'body-123', kind: 'body' }],
  sendSceneCommand = vi.fn().mockResolvedValue({
    type: 'modeling_response',
    modeling_response: {
      type: 'compute_drawing_projection',
      curves: [],
    },
  }),
}: {
  selectedEntities?: Array<{
    id: string
    kind: 'body' | 'edge' | 'face' | 'other'
  }>
  sendSceneCommand?: ReturnType<typeof vi.fn>
} = {}) {
  vi.mocked(getMeasurementEntities).mockReturnValue(selectedEntities)
  vi.mocked(useModelingContext).mockReturnValue({
    state: {
      context: {
        selectionRanges: { graphSelections: [], otherSelections: [] },
        engineCommandManager: { sendSceneCommand },
      },
    },
  } as unknown as ReturnType<typeof useModelingContext>)

  render(<DrawingProjectionDebugPane />)

  return { sendSceneCommand }
}

describe('DrawingProjectionDebugPane', () => {
  it('shows command input for a selected body and sends the projection command', async () => {
    const { sendSceneCommand } = renderPane()

    expect(
      screen.getByTestId('drawing-projection-debug-input')
    ).toHaveTextContent('"type": "compute_drawing_projection"')
    expect(
      screen.getByTestId('drawing-projection-debug-input')
    ).toHaveTextContent('"object_id": "body-123"')

    fireEvent.click(screen.getByTestId('drawing-projection-debug-send'))

    await waitFor(() => expect(sendSceneCommand).toHaveBeenCalledTimes(1))
    expect(sendSceneCommand).toHaveBeenCalledWith({
      type: 'modeling_cmd_req',
      cmd_id: expect.any(String),
      cmd: {
        type: 'compute_drawing_projection',
        object_id: 'body-123',
        frame: {
          origin: { x: 0, y: 0, z: 0 },
          x_axis: { x: 1, y: 0, z: 0 },
          y_axis: { x: 0, y: 1, z: 0 },
        },
        hidden_lines: 'include_hidden',
        resolution: 19,
        tolerance: 0.00001,
      },
    })

    await waitFor(() =>
      expect(
        screen.getByTestId('drawing-projection-debug-status')
      ).toHaveTextContent('OK')
    )
    expect(
      screen.getByTestId('drawing-projection-debug-output')
    ).toHaveTextContent('"curves": []')
  })

  it('disables sending when the current selection is not a single body', () => {
    renderPane({
      selectedEntities: [
        { id: 'body-123', kind: 'body' },
        { id: 'edge-123', kind: 'edge' },
      ],
    })

    expect(screen.getByTestId('drawing-projection-debug-send')).toBeDisabled()
    expect(
      screen.getByTestId('drawing-projection-debug-input')
    ).toHaveTextContent('null')
  })
})
