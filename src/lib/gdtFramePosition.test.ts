import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
  getAverageBoundingBoxDimension,
  getEngineEntityIdsForGdtSelections,
  getExistingGdtFontSize,
  withDefaultGdtFramePosition,
} from '@src/lib/gdtFramePosition'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'
import { describe, expect, it, vi } from 'vitest'

const formatNumberLiteral = vi.fn().mockReturnValue('1.2cm')
const wasmInstance = {
  format_number_literal: formatNumberLiteral,
} as unknown as ModuleType

const artifact = (value: object) =>
  value as unknown as NonNullable<
    Selections['graphSelections'][number]['artifact']
  >

const kclValue = (valueText: string): KclCommandValue => ({
  valueAst: {} as unknown as KclCommandValue['valueAst'],
  valueCalculated: valueText,
  valueText,
})

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
          artifact: artifact({
            type: 'cap',
            id: 'cap-1',
          }),
        },
        {
          codeRef: { range: [1, 2, 0], pathToNode: [] },
          artifact: artifact({
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
            artifact: artifact({ type: 'cap', id: 'cap-1' }),
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
      wasmInstance,
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
    expect(result.fontSize?.valueText).toBe('1.2cm')
    expect(result.fontSize?.valueAst).toMatchObject({
      type: 'Literal',
      raw: '1.2cm',
    })
    expect(formatNumberLiteral).toHaveBeenCalledWith(1.2, '"Cm"', 4)
    expect(GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO).toBe(0.2)
  })

  it('preserves explicit framePosition and fontSize', async () => {
    const sendSceneCommand = vi.fn()
    const framePosition = kclValue('[1, 2]')
    const fontSize = kclValue('2mm')
    const data = {
      name: 'A',
      framePosition,
      fontSize,
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
    expect(result.fontSize).toBe(fontSize)
  })

  it('uses the last explicit GD&T fontSize already in the file', async () => {
    const sendSceneCommand = vi.fn()
    const { ast, sourceCode } = gdtProgramWithFontSizes(['2mm', '3mm'])
    const data = {
      name: 'B',
      framePosition: kclValue('[1, 2]'),
      faces: { graphSelections: [], otherSelections: [] },
    } as ModelingCommandSchema['GDT Datum']

    const result = await withDefaultGdtFramePosition({
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
