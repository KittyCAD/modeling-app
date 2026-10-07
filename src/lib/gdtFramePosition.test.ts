import type { Artifact, Expr } from '@src/lang/wasm'
import {
  createBinaryExpression,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
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
  getOutsideDistanceSetback,
  getPlanarFaceEntityIdsForGdtSelections,
  withDefaultGdtFrameDefaults,
} from '@src/lib/gdtFramePosition'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
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

  describe('distance placement', () => {
    beforeEach(() => {
      formatNumberLiteral.mockImplementation(
        (value, suffix) =>
          `${value}${JSON.parse(suffix).toLowerCase().replace('inch', 'in')}`
      )
    })
    const objects: Selections = {
      graphSelections: [
        {
          codeRef: { range: [0, 1, 0], pathToNode: [] },
          artifact: testArtifact({ type: 'cap', id: 'cap-1' }),
        },
      ],
      otherSelections: [],
    }

    it.each(['XY', 'XZ', 'YZ'])(
      'places the dimension beyond the nearer side of the part in %s',
      (plane) => {
        const point = (x: number, y: number) =>
          plane === 'XY'
            ? { x, y, z: 0 }
            : plane === 'XZ'
              ? { x, y: 0, z: y }
              : { x: 0, y: x, z: y }
        const bounds = { center: point(50, 0), dimensions: point(100, 100) }
        for (const y of [-40, 40]) {
          const a = point(20, y),
            b = point(80, y)
          const offset = getOutsideDistanceSetback(a, b, plane, bounds)
          expect(offset).toBe(y < 0 ? -21.25 : 21.25)
          // Both the dimension line (0.8 * offset) and leader ends clear the box.
          expect(Math.abs(y + 0.8 * (offset ?? 0))).toBeGreaterThan(50)
          expect(Math.abs(y + (offset ?? 0))).toBeGreaterThan(50)
          expect(getOutsideDistanceSetback(b, a, plane, bounds)).toBe(offset)
        }
      }
    )

    it('keeps Z-edge placement on the same outside side when endpoints are reversed', () => {
      const bounds = {
        center: { x: 0, y: 0, z: 0 },
        dimensions: { x: 100, y: 0, z: 100 },
      }
      const a = { x: -45, y: 0, z: -10 },
        b = { x: -45, y: 0, z: 10 }
      expect(getOutsideDistanceSetback(a, b, 'XZ', bounds)).toBe(15)
      expect(getOutsideDistanceSetback(b, a, 'XZ', bounds)).toBe(-15)
      expect(a.x - 0.8 * 15).toBeLessThan(-50)
    })

    it('clears the whole projected box for an oblique measurement', () => {
      const bounds = {
        center: { x: 0, y: 0, z: 0 },
        dimensions: { x: 100, y: 100, z: 0 },
      }
      const a = { x: -10, y: -30, z: 0 },
        b = { x: 10, y: -10, z: 0 }
      const offset = getOutsideDistanceSetback(a, b, 'XY', bounds)
      expect(offset).toBeLessThan(0)
      const featureProjection = (a.y - a.x) / Math.SQRT2
      expect(featureProjection + 0.8 * (offset ?? 0)).toBeLessThan(
        -100 / Math.SQRT2
      )
    })

    it('uses the translated part center and declines unavailable measurement geometry', () => {
      const bounds = {
        center: { x: 500, y: 200, z: 0 },
        dimensions: { x: 100, y: 100, z: 0 },
      }
      const a = { x: 480, y: 160, z: 0 },
        b = { x: 520, y: 160, z: 0 }
      expect(getOutsideDistanceSetback(a, b, 'XY', bounds)).toBe(-21.25)
      expect(getOutsideDistanceSetback(a, a, 'XY', bounds)).toBeUndefined()
      expect(
        getOutsideDistanceSetback(a, b, 'customPlane', bounds)
      ).toBeUndefined()
    })

    it.each(['mm', 'in', 'ft'] as const)(
      'writes a simplified outward setback in %s and uses the owning body bounds',
      async (outputUnit) => {
        const selections: Selections = {
          graphSelections: [],
          otherSelections: ['left', 'right'].map((entityId) => ({
            type: 'enginePrimitive',
            primitiveType: 'edge',
            entityId,
            primitiveIndex: 0,
            parentEntityId: 'part',
          })),
        }
        const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
          if (cmd.type !== 'bounding_box') throw new Error('Unexpected command')
          const id = cmd.entity_ids[0]
          const center = {
            x: id === 'left' ? 20 : id === 'right' ? 80 : 50,
            y: id === 'part' ? 0 : -40,
            z: 0,
          }
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'bounding_box',
                  data: {
                    center,
                    dimensions:
                      id === 'part'
                        ? { x: 100, y: 100, z: 0 }
                        : { x: 4, y: 4, z: 0 },
                  },
                },
              },
            },
          }
        })
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: selections,
            framePlane: 'XY',
            fontSize: kclValue('1mm'),
          },
          distance: true,
          outputUnit,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePosition?.valueText).toBe(
          `[0${outputUnit}, -21.25${outputUnit}]`
        )
        expect(sendSceneCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'bounding_box',
              entity_ids: ['part'],
              output_unit: outputUnit,
            }),
          })
        )
        expect(
          sendSceneCommand.mock.calls.every(
            ([{ cmd }]) =>
              cmd.type !== 'bounding_box' || cmd.entity_ids.length > 0
          )
        ).toBe(true)
      }
    )

    it.each(
      ['XY', 'XZ', 'YZ'].flatMap((plane) =>
        (['mm', 'ft'] as const).flatMap((unit) =>
          [false, true].flatMap((missingBounds) =>
            ['arc', 'nurbs'].map((curveType) => ({
              plane,
              unit,
              missingBounds,
              curveType,
            }))
          )
        )
      )
    )(
      'uses $curveType circle centers rather than rim seams in $plane/$unit (missing bounds: $missingBounds)',
      async ({ plane, unit, missingBounds, curveType }) => {
        const scale = unit === 'ft' ? 304.8 : 1
        const point = (x: number, y: number) =>
          plane === 'XY'
            ? { x, y, z: 0 }
            : plane === 'XZ'
              ? { x, y: 0, z: y }
              : { x: 0, y: x, z: y }
        const selections: Selections = {
          graphSelections: ['left', 'right'].map((engineEntityId) => ({
            engineEntityId,
            entityRef: { type: 'edge', side_faces: [] },
            engineTopologyFallback: { parentId: 'part', primitiveIndex: 0 },
          })),
          otherSelections: [],
        }
        const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
          const x = cmd.curve_id === 'left' ? 20 : 80
          let data
          switch (cmd.type) {
            case 'curve_get_type':
              data = { curve_type: curveType }
              break
            case 'curve_get_end_points':
              // Full circle's seam is above the body center, but its center
              // is below it. The engine's edge bbox only contains this seam.
              data = {
                start: point(x * scale, 10 * scale),
                end: point(x * scale, 10 * scale),
              }
              break
            case 'curve_get_control_points':
              data = {
                control_points: [
                  [0, 50],
                  [50, 50],
                  [50, 0],
                  [50, -50],
                  [0, -50],
                  [-50, -50],
                  [-50, 0],
                  [-50, 50],
                  [0, 50],
                ].map(([dx, dy]) =>
                  point((x + dx) * scale, (-40 + dy) * scale)
                ),
              }
              break
            case 'bounding_box': {
              const id = cmd.entity_ids[0]
              if (id !== 'part' && missingBounds)
                throw new Error('No edge bounds')
              data =
                id === 'part' || !id
                  ? { center: point(50, 0), dimensions: point(100, 100) }
                  : {
                      center: point(
                        id === 'left' ? 20 : id === 'right' ? 80 : 50,
                        10
                      ),
                      dimensions: point(
                        cmd.entity_ids.length === 2 ? 60 : 0,
                        0
                      ),
                    }
              break
            }
            default:
              throw new Error('Unexpected command')
          }
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: { modeling_response: { type: cmd.type, data } },
            },
          }
        })
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: selections,
            framePlane: plane,
            fontSize: kclValue(`1${unit}`),
          },
          distance: true,
          outputUnit: unit,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePosition?.valueText).toBe(
          `[0${unit}, -21.25${unit}]`
        )
      }
    )

    it('places a short Z-edge on the negative side even when its bbox query fails', async () => {
      const selections: Selections = {
        graphSelections: [
          {
            engineEntityId: 'vertical',
            entityRef: { type: 'edge', side_faces: [] },
            engineTopologyFallback: { parentId: 'part', primitiveIndex: 0 },
          },
        ],
        otherSelections: [],
      }
      const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
        if (cmd.type === 'bounding_box' && cmd.entity_ids[0] === 'vertical')
          throw new Error('No edge bounds')
        const response =
          cmd.type === 'curve_get_end_points'
            ? {
                type: cmd.type,
                data: {
                  start: { x: 49, y: 0, z: -1 },
                  end: { x: 49, y: 0, z: 1 },
                },
              }
            : {
                type: 'bounding_box',
                data: {
                  center: { x: 0, y: 0, z: 0 },
                  dimensions: { x: 100, y: 0, z: 100 },
                },
              }
        return {
          success: true,
          resp: { type: 'modeling', data: { modeling_response: response } },
        }
      })
      const result = await withDefaultGdtFrameDefaults<
        ModelingCommandSchema['GDT Distance']
      >({
        data: {
          objects: selections,
          framePlane: 'XZ',
          fontSize: kclValue('1mm'),
        },
        distance: true,
        engineCommandManager: {
          sendSceneCommand,
        } as unknown as ConnectionManager,
        wasmInstance,
      })
      expect(result.framePosition?.valueText).toBe('[0mm, -10mm]')
    })

    it('converts engine endpoints from mm before placing a Z-edge dimension in feet', async () => {
      const selections: Selections = {
        graphSelections: [
          {
            engineEntityId: 'vertical',
            entityRef: { type: 'edge', side_faces: [] },
            engineTopologyFallback: { parentId: 'part', primitiveIndex: 0 },
          },
        ],
        otherSelections: [],
      }
      const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
        const response =
          cmd.type === 'curve_get_end_points'
            ? {
                type: cmd.type,
                data: {
                  start: { x: -45 * 304.8, y: 0, z: -10 * 304.8 },
                  end: { x: -45 * 304.8, y: 0, z: 10 * 304.8 },
                },
              }
            : {
                type: 'bounding_box',
                data: {
                  center: { x: 0, y: 0, z: 0 },
                  dimensions: { x: 100, y: 0, z: 100 },
                },
              }
        return {
          success: true,
          resp: { type: 'modeling', data: { modeling_response: response } },
        }
      })
      const result = await withDefaultGdtFrameDefaults<
        ModelingCommandSchema['GDT Distance']
      >({
        data: {
          objects: selections,
          framePlane: 'XZ',
          fontSize: kclValue('1ft'),
        },
        distance: true,
        outputUnit: 'ft',
        engineCommandManager: {
          sendSceneCommand,
        } as unknown as ConnectionManager,
        wasmInstance,
      })
      expect(result.framePosition?.valueText).toBe('[0ft, 15ft]')
    })

    it.each(['mm', 'cm', 'in'] as const)(
      'centers the label and scales its setback with the model in %s',
      async (outputUnit) => {
        formatNumberLiteral.mockImplementation(
          (value, suffix) =>
            `${value}${JSON.parse(suffix).toLowerCase().replace('inch', 'in')}`
        )
        const sendSceneCommand = vi.fn().mockResolvedValue({
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
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects,
            framePlane: 'XY',
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          outputUnit,
          wasmInstance,
        })
        expect(result.fontSize?.valueText).toBe(`5.25${outputUnit}`)
        expect(result.framePosition?.valueText).toBe(
          `[0${outputUnit}, 75${outputUnit}]`
        )
        expect(result.framePosition?.valueAst).toMatchObject({
          type: 'ArrayExpression',
          elements: [
            {
              type: 'Literal',
              value: {
                value: 0,
                suffix:
                  outputUnit === 'in'
                    ? 'Inch'
                    : outputUnit === 'cm'
                      ? 'Cm'
                      : 'Mm',
              },
            },
            {
              type: 'Literal',
              value: { value: 75 },
            },
          ],
        })
      }
    )

    it.each(['failed', 'empty', 'missing selections'])(
      'uses a physical fallback when geometry is %s',
      async (scenario) => {
        const sendSceneCommand = vi.fn().mockResolvedValue({
          success: true,
          resp: {
            type: 'modeling',
            data: {
              modeling_response: {
                type: 'bounding_box',
                data: { dimensions: { x: 0, y: 0, z: 0 } },
              },
            },
          },
        })
        if (scenario === 'failed') {
          sendSceneCommand.mockRejectedValue(new Error('No bounding box'))
        }
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects:
              scenario === 'missing selections'
                ? { graphSelections: [], otherSelections: [] }
                : objects,
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          outputUnit: 'in',
          wasmInstance,
        })
        expect(result.framePosition?.valueText).toBe('[0in, 20mm]')
        expect(result.fontSize).toBeUndefined()
        expect(result.framePlane).toBe('XY')
      }
    )

    it('uses bounds independently of the font expression and face-normal signs', async () => {
      const valueAst = createBinaryExpression([
        createLocalName('textHeight'),
        '+',
        createLiteral(1, wasmInstance, 'Mm'),
      ])
      const fontSize = { ...kclValue('textHeight + 1mm'), valueAst }
      const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => ({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response:
              cmd.type === 'face_is_planar'
                ? {
                    type: 'face_is_planar',
                    data: { z_axis: { x: 0, y: 0, z: -1 } },
                  }
                : {
                    type: 'bounding_box',
                    data: { dimensions: { x: 40, y: 10, z: 0 } },
                  },
          },
        },
      }))
      const result = await withDefaultGdtFrameDefaults<
        ModelingCommandSchema['GDT Distance']
      >({
        data: { objects, fontSize },
        distance: true,
        engineCommandManager: {
          sendSceneCommand,
        } as unknown as ConnectionManager,
        wasmInstance,
      })
      expect(result.framePosition?.valueText).toBe('[0mm, 25mm]')
      expect(result.framePosition?.valueAst).toMatchObject({
        elements: [
          { value: { value: 0 } },
          { type: 'Literal', value: { value: 25, suffix: 'Mm' } },
        ],
      })
      expect(result.fontSize).toBe(fontSize)
      expect(result.framePlane).toBe('XY')
    })

    it.each(['[0, 0]', '[-12mm, -8mm]'])(
      'preserves an explicit position %s',
      async (position) => {
        const framePosition = kclValue(position)
        const data = {
          objects,
          framePosition,
          framePlane: 'YZ',
          fontSize: kclValue('2mm'),
        } as ModelingCommandSchema['GDT Distance']
        const sendSceneCommand = vi.fn()
        const result = await withDefaultGdtFrameDefaults({
          data,
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result).toBe(data)
        expect(sendSceneCommand).not.toHaveBeenCalled()
      }
    )

    it.each([0, 4])(
      'uses selected edge bounds of %s mm, falling back to the model only for empty bounds',
      async (edgeSize) => {
        const sendSceneCommand = vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'bounding_box',
                  data: { dimensions: { x: edgeSize, y: edgeSize, z: 0 } },
                },
              },
            },
          })
          .mockResolvedValue({
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'bounding_box',
                  data: { dimensions: { x: 25, y: 40, z: 10 } },
                },
              },
            },
          })
        const selections: Selections = {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              primitiveType: 'edge',
              primitiveIndex: 0,
              parentEntityId: 'body',
              entityId: 'hole-rim',
            },
          ],
        }
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: selections,
            framePlane: 'XY',
            fontSize: kclValue('100mm'),
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePosition?.valueText).toBe(
          edgeSize === 0 ? '[0mm, 25mm]' : '[0mm, 4mm]'
        )
        expect(sendSceneCommand).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'bounding_box',
              entity_ids: ['hole-rim'],
            }),
          })
        )
        if (edgeSize === 0) {
          expect(sendSceneCommand).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
              cmd: expect.objectContaining({
                type: 'bounding_box',
                entity_ids: [],
              }),
            })
          )
        } else {
          expect(
            sendSceneCommand.mock.calls.filter(
              ([{ cmd }]) => cmd.type === 'bounding_box'
            )
          ).toHaveLength(1)
        }
      }
    )
  })

  describe('distance frame plane', () => {
    it.each([
      ['circular rims along Z', 'edge', { x: 0, y: 0, z: 3 }, 'XZ'],
      ['XZ rims along X', 'edge', { x: 8, y: 0, z: 0 }, 'XZ'],
      ['YZ rims along Y', 'edge', { x: 0, y: 8, z: 0 }, 'YZ'],
      ['circular rims along X', 'edge', { x: 8, y: 0, z: 0 }, 'XY'],
      ['cylindrical faces along Z', 'face', { x: 0, y: 0, z: 6 }, 'XZ'],
      ['cylindrical faces along Y', 'face', { x: 0, y: 8, z: 0 }, 'XY'],
      ['tilted separation in YZ', 'face', { x: 0, y: 4, z: 7 }, 'YZ'],
    ] as const)(
      'retains the measurement direction for %s',
      async (label, primitiveType, direction, expectedPlane) => {
        const sendSceneCommand = vi
          .fn()
          .mockImplementation(async ({ cmd }) => ({
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response:
                  cmd.type === 'bounding_box'
                    ? {
                        type: 'bounding_box',
                        data: {
                          center:
                            cmd.entity_ids[0] === 'to'
                              ? {
                                  x: 10 + direction.x,
                                  y: -5 + direction.y,
                                  z: 7 + direction.z,
                                }
                              : { x: 10, y: -5, z: 7 },
                          dimensions:
                            label === 'XZ rims along X'
                              ? { x: 4, y: 0, z: 4 }
                              : label === 'YZ rims along Y'
                                ? { x: 0, y: 4, z: 4 }
                                : { x: 4, y: 4, z: 10 },
                        },
                      }
                    : {
                        type: 'face_is_planar',
                        data: { z_axis: { x: 1, y: 0, z: 0 } },
                      },
              },
            },
          }))
        const objects: Selections = {
          graphSelections: [],
          otherSelections: ['from', 'to'].map((entityId, primitiveIndex) => ({
            type: 'enginePrimitive',
            primitiveType,
            entityId,
            primitiveIndex,
            parentEntityId: 'body',
          })),
        }
        if (primitiveType === 'face') {
          objects.otherSelections = []
          objects.graphSelections = ['from', 'to'].map((id) => ({
            artifact: testArtifact({ type: 'wall', id }),
          }))
        }
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: { objects, fontSize: kclValue('1mm') },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePlane).toBe(expectedPlane)
        expect(sendSceneCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'bounding_box',
              entity_ids: ['from'],
            }),
          })
        )
        expect(sendSceneCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            cmd: expect.objectContaining({
              type: 'bounding_box',
              entity_ids: ['to'],
            }),
          })
        )
      }
    )

    it.each([
      ['vertical edge', 'edge', { x: 0, y: 0, z: 10 }, 'XZ'],
      ['cylindrical face', 'face', { x: 4, y: 4, z: 10 }, 'XZ'],
      ['horizontal circular rim', 'edge', { x: 4, y: 4, z: 0 }, 'XY'],
    ] as const)(
      'uses the bounds of a single %s when planar normals are unavailable',
      async (_, primitiveType, dimensions, expectedPlane) => {
        const sendSceneCommand = vi.fn().mockResolvedValue({
          success: true,
          resp: {
            type: 'modeling',
            data: {
              modeling_response: {
                type: 'bounding_box',
                data: { dimensions },
              },
            },
          },
        })
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: {
              graphSelections: [],
              otherSelections: [
                {
                  type: 'enginePrimitive',
                  primitiveType,
                  entityId: 'entity',
                  parentEntityId: 'body',
                  primitiveIndex: 1,
                },
              ],
            },
            fontSize: kclValue('1mm'),
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePlane).toBe(expectedPlane)
      }
    )

    it.each([
      ['XY', { x: 0, y: 0, z: 1 }],
      ['XZ', { x: 0, y: 1, z: 0 }],
      ['YZ', { x: 1, y: 0, z: 0 }],
    ] as const)(
      'keeps two hole rims in their common %s face when edge bounds are unavailable',
      async (plane, normal) => {
        const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
          if (cmd.type !== 'face_is_planar')
            throw new Error('Bounds unavailable')
          return {
            success: true,
            resp: {
              type: 'modeling',
              data: {
                modeling_response: {
                  type: 'face_is_planar',
                  data: cmd.object_id === 'cap' ? { z_axis: normal } : {},
                },
              },
            },
          }
        })
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: {
              graphSelections: ['left', 'right'].map((id) => ({
                engineEntityId: id,
                entityRef: { type: 'edge', side_faces: ['cap', id + '-wall'] },
              })),
              otherSelections: [],
            },
            fontSize: kclValue('1mm'),
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePlane).toBe(plane)
      }
    )

    it.each([true, false])(
      'retains Z direction with misleading body bounds; endpoints available: %s',
      async (endpoints) => {
        const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => {
          const data =
            cmd.type === 'curve_get_end_points' && endpoints
              ? {
                  type: 'curve_get_end_points',
                  data: {
                    start: { x: 20, y: 40, z: -3 },
                    end: { x: 20, y: 40, z: 7 },
                  },
                }
              : cmd.type === 'face_is_planar'
                ? {
                    type: 'face_is_planar',
                    data: {
                      z_axis:
                        cmd.object_id === 'wallX'
                          ? { x: 1, y: 0, z: 0 }
                          : { x: 0, y: 1, z: 0 },
                    },
                  }
                : {
                    type: 'bounding_box',
                    data: { dimensions: { x: 100, y: 100, z: 10 } },
                  }
          return {
            success: true,
            resp: { type: 'modeling', data: { modeling_response: data } },
          }
        })
        const result = await withDefaultGdtFrameDefaults<
          ModelingCommandSchema['GDT Distance']
        >({
          data: {
            objects: {
              graphSelections: [
                {
                  engineEntityId: 'vertical',
                  entityRef: {
                    type: 'edge',
                    side_faces: ['wallX', 'wallY'],
                    end_faces: ['cap'],
                  },
                },
              ],
              otherSelections: [],
            },
            fontSize: kclValue('1mm'),
          },
          distance: true,
          engineCommandManager: {
            sendSceneCommand,
          } as unknown as ConnectionManager,
          wasmInstance,
        })
        expect(result.framePlane).toBe('XZ')
      }
    )

    it('uses adjacent planar faces for the cap-rim regression in #14251', async () => {
      const sendSceneCommand = vi.fn().mockImplementation(async ({ cmd }) => ({
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response:
              cmd.type === 'face_is_planar'
                ? {
                    type: 'face_is_planar',
                    data:
                      cmd.object_id === 'cylindricalWall'
                        ? {}
                        : {
                            z_axis: { x: 0, y: 0, z: 1 },
                            origin: {
                              x: 0,
                              y: 0,
                              z: cmd.object_id === 'capEnd' ? 3 : 0,
                            },
                          },
                  }
                : {
                    type: 'bounding_box',
                    data: { dimensions: { x: 4, y: 4, z: 3 } },
                  },
          },
        },
      }))
      const result = await withDefaultGdtFrameDefaults<
        ModelingCommandSchema['GDT Distance']
      >({
        data: {
          objects: {
            graphSelections: ['capEnd', 'capStart'].map((cap) => ({
              entityRef: { type: 'edge', side_faces: [cap, 'cylindricalWall'] },
            })),
            otherSelections: [],
          },
          fontSize: kclValue('1mm'),
        },
        distance: true,
        engineCommandManager: {
          sendSceneCommand,
        } as unknown as ConnectionManager,
        wasmInstance,
      })
      expect(result.framePlane).toBe('XZ')
      expect(sendSceneCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: { type: 'face_is_planar', object_id: 'capEnd' },
        })
      )
    })
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
