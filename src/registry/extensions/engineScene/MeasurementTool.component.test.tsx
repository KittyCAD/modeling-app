import type { ModelingCmd } from '@kittycad/lib'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useModelingContext = vi.hoisted(() => vi.fn())
vi.mock('@src/hooks/useModelingContext', () => ({ useModelingContext }))
vi.mock('@kittycad/ui-components', () => ({
  CopyTextButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Draggable: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import {
  MeasurementStatusBarItem,
  MeasurementTool,
} from '@src/registry/extensions/engineScene/MeasurementTool'
import { measurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'

function response(type: string, data: unknown) {
  return {
    resp: { type: 'modeling', data: { modeling_response: { type, data } } },
  }
}
function setup(count: number, failSecond = false) {
  const selected: Selections = {
    graphSelections: Array.from({ length: count }, (_, index) => ({
      entityRef: { type: 'edge', side_faces: [`face-${index}`], index: 3 },
      engineTopologyFallback: {
        parentId: 'pump-body',
        primitiveIndex: index + 10,
      },
    })),
    otherSelections: [],
  }
  const commands: ModelingCmd[] = []
  const sendSceneCommand = ({ cmd }: { cmd: ModelingCmd }) => {
    commands.push(cmd)
    if (cmd.type === 'solid3d_get_edge_uuid') {
      if (failSecond && cmd.edge_index === 11)
        return Promise.resolve(
          new Error('Selected edge could not be resolved.')
        )
      return Promise.resolve(
        response(cmd.type, { edge_id: `edge-${cmd.edge_index}` })
      )
    }
    if (cmd.type === 'edge_get_length')
      return Promise.resolve(response(cmd.type, { length: 42 }))
    if (cmd.type === 'entity_get_distance')
      return Promise.resolve(
        response(cmd.type, { min_distance: 5, max_distance: 5 })
      )
    return Promise.resolve(new Error('Unexpected command'))
  }
  useModelingContext.mockReturnValue({
    state: {
      matches: (value: string) => value === 'idle',
      context: {
        engineCommandManager: { sendSceneCommand },
        kclManager: {
          artifactGraph: new Map(),
          fileSettings: { defaultLengthUnit: 'mm' },
        },
        selectionRanges: selected,
        store: {},
      },
    },
  })
  return commands
}

beforeEach(() => {
  measurementToolService.close()
  measurementToolService.lastDistanceMode.value = null
})

describe('Face API measurement wiring', () => {
  it.each([MeasurementTool, MeasurementStatusBarItem])(
    'resolves a reference-only edge before measuring its length (%s)',
    async (Component) => {
      const commands = setup(1)
      render(<Component />)
      if (Component === MeasurementTool) await screen.findByText('42')
      else await screen.findByRole('button', { name: /Measure:.*42/ })
      expect(commands).toEqual([
        {
          type: 'solid3d_get_edge_uuid',
          object_id: 'pump-body',
          edge_index: 10,
        },
        { type: 'edge_get_length', edge_id: 'edge-10' },
      ])
    }
  )

  it('resolves two edges and measures supported axis distance', async () => {
    const commands = setup(2)
    render(<MeasurementTool />)
    await screen.findByText('5')
    expect(commands).toEqual([
      { type: 'solid3d_get_edge_uuid', object_id: 'pump-body', edge_index: 10 },
      { type: 'solid3d_get_edge_uuid', object_id: 'pump-body', edge_index: 11 },
      {
        type: 'entity_get_distance',
        entity_id1: 'edge-10',
        entity_id2: 'edge-11',
        distance_type: { type: 'on_axis', axis: 'x' },
      },
    ])
  })

  it('shows a resolution failure without measuring the remaining edge', async () => {
    const commands = setup(2, true)
    render(<MeasurementTool />)
    await screen.findByText('Selected edge could not be resolved.')
    await waitFor(() => expect(commands).toHaveLength(2))
    expect(commands.every((cmd) => cmd.type === 'solid3d_get_edge_uuid')).toBe(
      true
    )
    expect(screen.queryByText('No selection.')).not.toBeInTheDocument()
  })
})
