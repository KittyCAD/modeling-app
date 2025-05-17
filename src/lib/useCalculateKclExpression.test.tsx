import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'

import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'

vi.mock('@src/lib/kclHelpers', () => {
  return {
    getCalculatedKclExpressionValue: vi.fn(),
  }
})

vi.mock('@src/lang/KclProvider', () => {
  return {
    useKclContext: () => ({ code: '', variables: {} }),
  }
})

vi.mock('@src/hooks/useModelingContext', () => {
  return {
    useModelingContext: () => ({ context: { selectionRanges: { graphSelections: [] } } }),
  }
})

const mockedGetValue = getCalculatedKclExpressionValue as unknown as ReturnType<typeof vi.fn>

describe('useCalculateKclExpression', () => {
  it('ignores outdated asynchronous results', async () => {
    let resolveFirst: (v: any) => void
    let resolveSecond: (v: any) => void

    mockedGetValue
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFirst = res
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveSecond = res
          })
      )

    const { result, rerender } = renderHook(
      ({ value }) => useCalculateKclExpression({ value }),
      { initialProps: { value: '1+1' } }
    )

    // Trigger a new calculation before the first one resolves
    rerender({ value: '2+2' })

    await act(async () => {
      resolveSecond!({ astNode: {}, valueAsString: '4' })
      await Promise.resolve()
    })

    expect(result.current.calcResult).toBe('4')

    await act(async () => {
      resolveFirst!({ astNode: {}, valueAsString: '2' })
      await Promise.resolve()
    })

    expect(result.current.calcResult).toBe('4')
  })
})
