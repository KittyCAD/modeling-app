import type { ConnectionManager } from '@src/network/connectionManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  getAverageBoundingBoxDimension,
  getEngineEntityIdsForGdtSelections,
  withDefaultGdtFramePosition,
} from '@src/lib/gdtFramePosition'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { describe, expect, it, vi } from 'vitest'

describe('GD&T bounding box frame position defaults', () => {
  it('averages non-zero bounding box dimensions', () => {
    expect(getAverageBoundingBoxDimension({ x: 4, y: 0, z: 8 })).toBe(6)
    expect(getAverageBoundingBoxDimension({ x: 4, y: 4, z: 4 })).toBe(4)
    expect(getAverageBoundingBoxDimension({ x: 0, y: 0, z: 0 })).toBeUndefined()
  })

  it('gets engine entity ids from GD&T selections', () => {
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [0, 1, 0], pathToNode: [] },
          artifact: {
            type: 'cap',
            id: 'cap-1',
          } as any,
        },
        {
          codeRef: { range: [1, 2, 0], pathToNode: [] },
          artifact: {
            type: 'pattern',
            id: 'pattern-1',
            copyIds: ['copy-1'],
            copyFaceIds: ['copy-face-1'],
            copyEdgeIds: ['copy-edge-1', 'copy-face-1'],
          } as any,
        },
      ],
      otherSelections: [],
    }

    expect(getEngineEntityIdsForGdtSelections(selections)).toEqual([
      'cap-1',
      'copy-1',
      'copy-face-1',
      'copy-edge-1',
    ])
  })

  it('fills omitted framePosition from the selected bounding box', async () => {
    const sendSceneCommand = vi.fn().mockResolvedValue({
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'bounding_box',
            data: {
              center: { x: 0, y: 0, z: 0 },
              dimensions: { x: 4, y: 0, z: 8 },
            },
          },
        },
      },
    })

    const data = {
      name: 'A',
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: { type: 'cap', id: 'cap-1' } as any,
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFramePosition({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      outputUnit: 'cm',
      wasmInstance: {} as ModuleType,
    })

    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'bounding_box',
          entity_ids: ['cap-1'],
          output_unit: 'cm',
        }),
      })
    )
    expect(result.framePosition?.valueText).toBe('[6, 6]')
  })

  it('preserves an explicit framePosition', async () => {
    const sendSceneCommand = vi.fn()
    const framePosition = {
      valueAst: {} as any,
      valueCalculated: '[1, 2]',
      valueText: '[1, 2]',
    }
    const data = {
      name: 'A',
      framePosition,
      faces: { graphSelections: [], otherSelections: [] },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFramePosition({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(sendSceneCommand).not.toHaveBeenCalled()
    expect(result.framePosition).toBe(framePosition)
  })
})
