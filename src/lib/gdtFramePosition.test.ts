import type { Artifact, Expr } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
  getAverageBoundingBoxDimension,
  getDefaultGdtFramePlaneFromBoundingBox,
  getDefaultGdtFramePlaneFromNormal,
  getDefaultGdtFramePositionSignsFromNormal,
  getEngineEntityIdsForGdtSelections,
  getExistingGdtFontSize,
  getPlanarFaceEntityIdsForGdtSelections,
  withDefaultGdtFrameDefaults,
} from '@src/lib/gdtFramePosition'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const formatNumberLiteral = vi.fn().mockReturnValue('1.2cm')
const wasmInstance = {
  format_number_literal: formatNumberLiteral,
} as unknown as ModuleType

function testArtifact<T extends Artifact['type']>(
  artifact: { type: T } & Record<string, unknown>
): Extract<Artifact, { type: T }> {
  return artifact as Extract<Artifact, { type: T }>
}

const kclValue = (valueText: string): KclCommandValue => ({
  valueAst: {} as Expr,
  valueCalculated: valueText,
  valueText,
})

function testFramePosition(): KclCommandValue {
  return kclValue('[1, 2]')
}

function gdtProgramWithFontSizes(fontSizes: string[]) {
  let sourceCode = ''
  const body = fontSizes.map((fontSize) => {
    const expressionPrefix = `gdt::datum(face = capEnd001, name = "A", fontSize = `
    const expressionSuffix = ')'
    const expressionStart = sourceCode.length
    const fontSizeStart = expressionStart + expressionPrefix.length
    const fontSizeEnd = fontSizeStart + fontSize.length
    sourceCode += `${expressionPrefix}${fontSize}${expressionSuffix}\n`

    return {
      type: 'ExpressionStatement',
      expression: {
        type: 'CallExpressionKw',
        callee: {
          type: 'Name',
          path: [{ name: 'gdt' }],
          name: { name: 'datum' },
        },
        unlabeled: null,
        arguments: [
          {
            label: { name: 'fontSize' },
            arg: {
              type: 'Literal',
              value: { value: Number.parseFloat(fontSize), suffix: 'Mm' },
              raw: fontSize,
              start: fontSizeStart,
              end: fontSizeEnd,
            },
          },
        ],
      },
    }
  })

  return {
    ast: { body } as unknown as Parameters<typeof getExistingGdtFontSize>[0],
    sourceCode,
  }
}

describe('GD&T frame defaults', () => {
  beforeEach(() => {
    formatNumberLiteral.mockClear()
    formatNumberLiteral.mockReturnValue('1.2cm')
  })

  it('averages non-zero bounding box dimensions', () => {
    expect(getAverageBoundingBoxDimension({ x: 4, y: 0, z: 8 })).toBe(6)
    expect(getAverageBoundingBoxDimension({ x: 4, y: 4, z: 4 })).toBe(4)
    expect(getAverageBoundingBoxDimension({ x: 0, y: 0, z: 0 })).toBeUndefined()
  })

  it('infers perpendicular frame planes from face normals', () => {
    expect(getDefaultGdtFramePlaneFromNormal({ x: 0, y: 0, z: 1 })).toBe('XZ')
    expect(getDefaultGdtFramePlaneFromNormal({ x: 0, y: -1, z: 0 })).toBe('XY')
    expect(getDefaultGdtFramePlaneFromNormal({ x: 1, y: 0, z: 0 })).toBe('XY')
    expect(
      getDefaultGdtFramePlaneFromNormal({ x: 1, y: 1, z: 0 })
    ).toBeUndefined()
  })

  it('infers framePosition signs from face normals', () => {
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 0, y: 0, z: 1 })
    ).toEqual([1, 1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 0, y: 0, z: -1 })
    ).toEqual([1, -1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 1, y: 0, z: 0 })
    ).toEqual([1, 1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: -1, y: 0, z: 0 })
    ).toEqual([-1, 1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 0, y: 1, z: 0 })
    ).toEqual([1, 1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 0, y: -1, z: 0 })
    ).toEqual([1, -1])
    expect(
      getDefaultGdtFramePositionSignsFromNormal({ x: 1, y: 1, z: 0 })
    ).toBeUndefined()
  })

  it('infers perpendicular frame planes from bounding box thin axes', () => {
    expect(getDefaultGdtFramePlaneFromBoundingBox({ x: 8, y: 4, z: 0 })).toBe(
      'XZ'
    )
    expect(getDefaultGdtFramePlaneFromBoundingBox({ x: 8, y: 0, z: 4 })).toBe(
      'XY'
    )
    expect(getDefaultGdtFramePlaneFromBoundingBox({ x: 0, y: 8, z: 4 })).toBe(
      'XY'
    )
    expect(
      getDefaultGdtFramePlaneFromBoundingBox({ x: 4, y: 4, z: 4 })
    ).toBeUndefined()
  })

  it('gets engine entity ids from GD&T selections', () => {
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [0, 1, 0], pathToNode: [] },
          artifact: testArtifact({
            type: 'cap',
            id: 'cap-1',
          }),
        },
        {
          codeRef: { range: [1, 2, 0], pathToNode: [] },
          artifact: testArtifact({
            type: 'pattern',
            id: 'pattern-1',
            copyIds: ['copy-1'],
            copyFaceIds: ['copy-face-1'],
            copyEdgeIds: ['copy-edge-1', 'copy-face-1'],
          }),
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

  it('gets planar face ids from GD&T selections', () => {
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: { range: [0, 1, 0], pathToNode: [] },
          artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
        },
        {
          codeRef: { range: [1, 2, 0], pathToNode: [] },
          engineEntityId: 'selected-wall-face',
          artifact: testArtifact({ type: 'wall', id: 'wall-1' }),
        },
        {
          codeRef: { range: [2, 3, 0], pathToNode: [] },
          artifact: testArtifact({
            type: 'edgeCut',
            id: 'edge-cut-1',
            surfaceId: 'edge-cut-surface-1',
          }),
        },
        {
          codeRef: { range: [3, 4, 0], pathToNode: [] },
          artifact: testArtifact({
            type: 'pattern',
            id: 'pattern-1',
            copyIds: ['copy-1'],
            copyFaceIds: ['copy-face-1'],
            copyEdgeIds: ['copy-edge-1'],
          }),
        },
      ],
      otherSelections: [],
    }

    expect(getPlanarFaceEntityIdsForGdtSelections(selections)).toEqual([
      'cap-1',
      'selected-wall-face',
      'edge-cut-surface-1',
      'edge-cut-1',
      'copy-face-1',
    ])
  })

  it('fills omitted framePosition from the selected bounding box and fontSize from the model bounding box', async () => {
    formatNumberLiteral.mockReturnValue('5.25cm')
    const sendSceneCommand = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'face_is_planar',
              data: {},
            },
          },
        },
      })
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'bounding_box',
              data: {
                center: { x: 0, y: 0, z: 0 },
                dimensions: { x: 100, y: 50, z: 0 },
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
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      outputUnit: 'cm',
      wasmInstance,
    })

    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'bounding_box',
          entity_ids: ['cap-1'],
          output_unit: 'cm',
        }),
      })
    )
    expect(sendSceneCommand).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'bounding_box',
          entity_ids: [],
          output_unit: 'cm',
        }),
      })
    )
    expect(result.framePosition?.valueText).toBe('[6, 6]')
    expect(result.fontSize?.valueText).toBe('5.25cm')
    expect(result.fontSize?.valueAst).toMatchObject({
      type: 'Literal',
      raw: '5.25cm',
    })
    expect(formatNumberLiteral).toHaveBeenCalledWith(5.25, '"Cm"', 4)
    expect(GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO).toBe(0.07)
  })

  it('uses only the model bounding box when only fontSize is omitted', async () => {
    formatNumberLiteral.mockReturnValue('7mm')
    const sendSceneCommand = vi.fn().mockResolvedValueOnce({
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'bounding_box',
            data: {
              center: { x: 0, y: 0, z: 0 },
              dimensions: { x: 80, y: 120, z: 100 },
            },
          },
        },
      },
    })

    const data = {
      name: 'A',
      framePosition: testFramePosition(),
      framePlane: 'XZ',
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance,
    })

    expect(sendSceneCommand).toHaveBeenCalledOnce()
    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'bounding_box',
          entity_ids: [],
          output_unit: 'mm',
        }),
      })
    )
    expect(result.fontSize?.valueText).toBe('7mm')
    expect(formatNumberLiteral).toHaveBeenCalledWith(7, '"Mm"', 4)
  })

  it('signs omitted framePosition from the selected face normal', async () => {
    const sendSceneCommand = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'face_is_planar',
              data: {
                origin: { x: 0, y: 0, z: 0 },
                x_axis: { x: 1, y: 0, z: 0 },
                y_axis: { x: 0, y: 1, z: 0 },
                z_axis: { x: 0, y: 0, z: -1 },
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
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
      fontSize: kclValue('2mm'),
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(result.framePlane).toBe('XZ')
    expect(result.framePosition?.valueText).toBe('[6, -6]')
  })

  it('uses normal framePosition signs even when framePlane is explicit', async () => {
    const sendSceneCommand = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'face_is_planar',
              data: {
                origin: { x: 0, y: 0, z: 0 },
                x_axis: { x: 0, y: 1, z: 0 },
                y_axis: { x: 0, y: 0, z: 1 },
                z_axis: { x: -1, y: 0, z: 0 },
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
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
      framePlane: 'YZ',
      fontSize: kclValue('2mm'),
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(result.framePlane).toBe('YZ')
    expect(result.framePosition?.valueText).toBe('[-6, 6]')
  })

  it('fills omitted framePlane from a planar face normal', async () => {
    const sendSceneCommand = vi.fn().mockResolvedValue({
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'face_is_planar',
            data: {
              origin: { x: 0, y: 0, z: 0 },
              x_axis: { x: 1, y: 0, z: 0 },
              y_axis: { x: 0, y: 1, z: 0 },
              z_axis: { x: 0, y: 0, z: 1 },
            },
          },
        },
      },
    })

    const data = {
      name: 'A',
      framePosition: testFramePosition(),
      fontSize: kclValue('2mm'),
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(sendSceneCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: expect.objectContaining({
          type: 'face_is_planar',
          object_id: 'cap-1',
        }),
      })
    )
    expect(result.framePlane).toBe('XZ')
  })

  it('falls back to bounding box framePlane inference when normals are unavailable', async () => {
    const sendSceneCommand = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'face_is_planar',
              data: {},
            },
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'bounding_box',
              data: {
                center: { x: 0, y: 0, z: 0 },
                dimensions: { x: 8, y: 4, z: 0 },
              },
            },
          },
        },
      })

    const data = {
      name: 'A',
      framePosition: testFramePosition(),
      fontSize: kclValue('2mm'),
      faces: {
        graphSelections: [
          {
            codeRef: { range: [0, 1, 0], pathToNode: [] },
            artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
          },
        ],
        otherSelections: [],
      },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(result.framePlane).toBe('XZ')
  })

  it('preserves explicit frame defaults and fontSize', async () => {
    const sendSceneCommand = vi.fn()
    const framePosition = testFramePosition()
    const fontSize = kclValue('2mm')
    const data = {
      name: 'A',
      framePosition,
      framePlane: 'YZ',
      fontSize,
      faces: { graphSelections: [], otherSelections: [] },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      wasmInstance: {} as ModuleType,
    })

    expect(sendSceneCommand).not.toHaveBeenCalled()
    expect(result.framePosition).toBe(framePosition)
    expect(result.framePlane).toBe('YZ')
    expect(result.fontSize).toBe(fontSize)
  })

  it('uses the last explicit GD&T fontSize already in the file', async () => {
    const sendSceneCommand = vi.fn()
    const { ast, sourceCode } = gdtProgramWithFontSizes(['2mm', '3mm'])
    const data = {
      name: 'B',
      framePosition: testFramePosition(),
      framePlane: 'YZ',
      faces: { graphSelections: [], otherSelections: [] },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFrameDefaults({
      data,
      engineCommandManager: {
        sendSceneCommand,
      } as unknown as ConnectionManager,
      ast,
      sourceCode,
      wasmInstance: {} as ModuleType,
    })

    expect(sendSceneCommand).not.toHaveBeenCalled()
    expect(result.fontSize?.valueText).toBe('3mm')
  })

  it('finds existing GD&T fontSize values in source order', () => {
    const { ast, sourceCode } = gdtProgramWithFontSizes(['2mm', '4mm'])

    expect(getExistingGdtFontSize(ast, sourceCode)?.valueText).toBe('4mm')
  })
})
