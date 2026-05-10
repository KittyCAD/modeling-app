import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  DefaultPlanes,
  filterOpenCascadeEphemeralOperations,
  getFeatureTreeValueDetail,
  selectedFeatureTreeDefaultPlaneKeys,
} from '@src/components/layout/areas/FeatureTreePane'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import { defaultSourceRange } from '@src/lang/sourceRange'

const { sendMock, modelingContextState, modelingContextValue } = vi.hoisted(
  () => {
    const sendMock = vi.fn()
    const modelingContextState = {
      matches: () => false,
      context: {
        defaultPlaneVisibility: {
          origin: true,
          xy: true,
          xz: true,
          yz: true,
        },
        selectionRanges: {
          graphSelections: [],
          otherSelections: [],
        },
        store: {
          useSketchSolveMode: { current: undefined },
        },
      },
    } as any
    return {
      sendMock,
      modelingContextState,
      modelingContextValue: {
        current: {
          send: sendMock,
          state: modelingContextState,
        } as any,
      },
    }
  }
)

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => modelingContextValue.current,
}))

describe('FeatureTreePane', () => {
  describe('DefaultPlanes', () => {
    beforeEach(() => {
      sendMock.mockClear()
      modelingContextState.context.selectionRanges = {
        graphSelections: [],
        otherSelections: [],
      }
      modelingContextValue.current = {
        send: sendMock,
        state: modelingContextState,
      } as any
    })

    function createSystemDeps({
      isOpenCascade,
      defaultPlanes,
    }: {
      isOpenCascade: boolean
      defaultPlanes: {
        xy: string
        xz: string
        yz: string
        negXy?: string
        negXz?: string
        negYz?: string
      } | null
    }) {
      return {
        rustContext: {
          defaultPlanes,
        },
        sceneInfra: {
          modelingSend: vi.fn(),
        },
        kclManager: {
          engineCommandManager: {
            isOpenCascade,
          },
        },
      } as any
    }

    it('renders while modeling context state is temporarily missing', () => {
      modelingContextValue.current = {
        send: sendMock,
      } as any

      expect(() =>
        render(
          createElement(DefaultPlanes, {
            systemDeps: createSystemDeps({
              isOpenCascade: true,
              defaultPlanes: {
                xy: 'plane-xy',
                xz: 'plane-xz',
                yz: 'plane-yz',
              },
            }),
          })
        )
      ).not.toThrow()
      expect(screen.getByText('Origin')).toBeTruthy()
    })

    it('shows the Origin row only for OpenCascade', () => {
      const { rerender } = render(
        createElement(DefaultPlanes, {
          systemDeps: createSystemDeps({
            isOpenCascade: false,
            defaultPlanes: null,
          }),
        })
      )

      expect(screen.queryByText('Origin')).toBeNull()

      rerender(
        createElement(DefaultPlanes, {
          systemDeps: createSystemDeps({
            isOpenCascade: true,
            defaultPlanes: null,
          }),
        })
      )

      expect(screen.getByText('Origin')).toBeTruthy()
    })

    it('sends origin and default-plane visibility toggle events', () => {
      render(
        createElement(DefaultPlanes, {
          systemDeps: createSystemDeps({
            isOpenCascade: true,
            defaultPlanes: { xy: 'plane-xy', xz: 'plane-xz', yz: 'plane-yz' },
          }),
        })
      )

      const toggles = screen.getAllByTestId('feature-tree-visibility-toggle')
      fireEvent.click(toggles[0])
      fireEvent.click(toggles[2])

      expect(sendMock).toHaveBeenNthCalledWith(1, {
        type: 'Toggle default plane visibility',
        planeKey: 'origin',
      })
      expect(sendMock).toHaveBeenNthCalledWith(2, {
        type: 'Toggle default plane visibility',
        planeId: 'plane-xy',
        planeKey: 'xy',
      })
    })

    it('highlights selected default plane rows', () => {
      modelingContextState.context.selectionRanges = {
        graphSelections: [],
        otherSelections: [{ name: '-XZ', id: 'plane-neg-xz' }] as unknown[],
      }

      render(
        createElement(DefaultPlanes, {
          systemDeps: createSystemDeps({
            isOpenCascade: true,
            defaultPlanes: {
              xy: 'plane-xy',
              xz: 'plane-xz',
              yz: 'plane-yz',
              negXy: 'plane-neg-xy',
              negXz: 'plane-neg-xz',
              negYz: 'plane-neg-yz',
            },
          }),
        })
      )

      expect(
        screen
          .getByText('Front plane')
          .closest('[data-testid="feature-tree-operation-item"]')
      ).toHaveClass('bg-primary/25')
      expect(
        screen
          .getByText('Top plane')
          .closest('[data-testid="feature-tree-operation-item"]')
      ).not.toHaveClass('bg-primary/25')
    })

    it('maps positive and negative default plane selections to feature tree rows', () => {
      expect(
        selectedFeatureTreeDefaultPlaneKeys(
          {
            otherSelections: [
              { name: 'XY', id: 'plane-xy' },
              { name: '-YZ', id: 'plane-neg-yz' },
            ],
          },
          {
            xy: 'plane-xy',
            xz: 'plane-xz',
            yz: 'plane-yz',
            negXy: 'plane-neg-xy',
            negXz: 'plane-neg-xz',
            negYz: 'plane-neg-yz',
          } as never
        )
      ).toEqual(new Set(['xy', 'yz']))
    })
  })

  describe('getFeatureTreeValueDetail', () => {
    describe('VariableDeclaration operations', () => {
      function createVariableDeclarationOperation(
        sourceRange: [number, number, number],
        value: any,
        name: string
      ): Operation {
        return {
          type: 'VariableDeclaration',
          name,
          value,
          visibility: 'default',
          nodePath: defaultNodePath(),
          sourceRange,
        }
      }

      it('should extract variable name and value from VariableDeclaration operation', () => {
        const mockCode = 'const myVariable = 42'
        const sourceRange: [number, number, number] = [0, mockCode.length, 0]
        const mockValue = { type: 'Number', value: 42 }
        const mockOperation = createVariableDeclarationOperation(
          sourceRange,
          mockValue,
          'myVariable'
        )

        const valueDetail = getFeatureTreeValueDetail(mockOperation, mockCode)

        expect(valueDetail?.display).toBe('const myVariable = 42')
        expect(valueDetail?.calculated).toEqual(mockValue)
      })
    })

    describe('datum name extraction', () => {
      function createGdtDatumOperation(
        nameSourceRange: [number, number, number]
      ): Operation {
        return {
          type: 'StdLibCall',
          name: 'gdt::datum',
          unlabeledArg: null,
          labeledArgs: {
            name: {
              value: { type: 'String', value: 'A' },
              sourceRange: nameSourceRange,
            },
          },
          nodePath: defaultNodePath(),
          sourceRange: defaultSourceRange(),
          isError: false,
        }
      }

      it('should extract datum name from GDT datum operation', () => {
        const mockCode = 'gdt::datum(face = extrude001, name = "A")'
        // Calculate sourceRange positions dynamically
        const nameStart = mockCode.indexOf('"A"')
        const nameEnd = nameStart + 3 // Length of "A" including quotes
        const nameSourceRange: [number, number, number] = [
          nameStart,
          nameEnd,
          0,
        ]
        const mockOperation = createGdtDatumOperation(nameSourceRange)

        const valueDetail = getFeatureTreeValueDetail(mockOperation, mockCode)

        expect(valueDetail?.display).toBe('A')
        expect(valueDetail?.calculated).toEqual({ type: 'String', value: 'A' })
      })
    })
  })

  describe('filterOpenCascadeEphemeralOperations', () => {
    it('filters region operations from the OpenCascade feature tree list', () => {
      const regionOperation: Operation = {
        type: 'StdLibCall',
        name: 'region',
        unlabeledArg: null,
        labeledArgs: {},
        nodePath: defaultNodePath(),
        sourceRange: defaultSourceRange(),
        isError: false,
      }
      const extrudeOperation: Operation = {
        ...regionOperation,
        name: 'extrude',
      }

      expect(
        filterOpenCascadeEphemeralOperations([
          regionOperation,
          extrudeOperation,
        ])
      ).toEqual([extrudeOperation])
    })
  })
})
