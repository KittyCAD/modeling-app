import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import {
  DefaultPlanes,
  getFeatureTreeValueDetail,
} from '@src/components/layout/areas/FeatureTreePane'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import { defaultSourceRange } from '@src/lang/sourceRange'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    send: sendMock,
    state: {
      matches: () => false,
      context: {
        defaultPlaneVisibility: {
          origin: true,
          xy: true,
          xz: true,
          yz: true,
        },
        store: {
          useSketchSolveMode: { current: undefined },
        },
      },
    },
  }),
}))

describe('FeatureTreePane', () => {
  describe('DefaultPlanes', () => {
    function createSystemDeps({
      isOpenCascade,
      defaultPlanes,
    }: {
      isOpenCascade: boolean
      defaultPlanes: { xy: string; xz: string; yz: string } | null
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
      sendMock.mockClear()
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
})
