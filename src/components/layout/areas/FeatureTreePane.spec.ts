import { describe, it, expect } from 'vitest'
import { getFeatureTreeValueDetail } from '@src/components/layout/areas/FeatureTreePane'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultNodePath } from '@src/lang/wasm'
import { defaultSourceRange } from '@src/lang/sourceRange'

describe('FeatureTreePane', () => {
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
      const nameSourceRange: [number, number, number] = [nameStart, nameEnd, 0]
      const mockOperation = createGdtDatumOperation(nameSourceRange)

      const valueDetail = getFeatureTreeValueDetail(mockOperation, mockCode)

      expect(valueDetail?.display).toBe('A')
      expect(valueDetail?.calculated).toEqual({ type: 'String', value: 'A' })
    })
  })
})
