import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/create', () => ({ findUniqueName: () => 'length' }))
vi.mock('@src/lang/queryAst', () => ({
  findAllPreviousVariables: () => ({
    variables: [],
    insertIndex: 0,
    bodyPath: [],
  }),
}))
vi.mock('@src/lang/queryAst/getSafeInsertIndex', () => ({
  getSafeInsertIndex: () => 0,
}))
vi.mock('@src/lang/wasm', () => ({
  parse: () => ({}),
  resultIsOk: () => true,
}))
vi.mock('@src/lib/kclHelpers', () => ({
  getCalculatedKclExpressionValue: vi.fn(),
}))

import type { Expr } from '@src/lang/wasm'
import { getCalculatedKclExpressionValue } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'

type CalculationResult = Awaited<
  ReturnType<typeof getCalculatedKclExpressionValue>
>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function calculated(value: string): { astNode: Expr; valueAsString: string } {
  return {
    astNode: {
      type: 'Literal',
      value: { value: Number(value), suffix: 'None' },
      raw: value,
      start: 0,
      end: value.length,
      moduleId: 0,
      commentStart: 0,
    },
    valueAsString: value,
  }
}

describe('useCalculateKclExpression calculation ownership', () => {
  const pending = new Map<
    string,
    ReturnType<typeof deferred<CalculationResult>>
  >()
  let hookProps: Parameters<typeof useCalculateKclExpression>[0]

  beforeEach(() => {
    pending.clear()
    vi.mocked(getCalculatedKclExpressionValue).mockImplementation((value) => {
      let request = pending.get(value)
      if (!request) {
        request = deferred<CalculationResult>()
        pending.set(value, request)
      }
      return request.promise
    })
    hookProps = {
      value: '10',
      code: '',
      ast: { body: [], start: 0, end: 0, moduleId: 0, commentStart: 0 },
      variables: {},
      selectionRanges: { graphSelections: [], otherSelections: [] },
      rustContext: {
        wasmInstancePromise: Promise.resolve({}),
      } as unknown as RustContext,
    }
  })

  it('withholds an old AST on the first render of a changed value', async () => {
    const snapshots: ReturnType<typeof useCalculateKclExpression>[] = []
    const { result, rerender } = await act(async () =>
      renderHook(
        (props) => {
          const calculation = useCalculateKclExpression(props)
          useLayoutEffect(() => {
            snapshots.push(calculation)
          })
          return calculation
        },
        { initialProps: hookProps }
      )
    )
    await waitFor(() => expect(pending.has('10')).toBe(true))
    await act(async () => pending.get('10')?.resolve(calculated('10')))
    expect(result.current.valueNode).toEqual(calculated('10').astNode)

    snapshots.length = 0
    rerender({ ...hookProps, value: '20' })

    expect(snapshots.length).toBeGreaterThan(0)
    for (const snapshot of snapshots) {
      expect(snapshot.valueNode).toBeNull()
      expect(snapshot.isExecuting).toBe(true)
    }
    await act(async () => pending.get('20')?.resolve(calculated('20')))
    expect(result.current.valueNode).toEqual(calculated('20').astNode)
    expect(result.current.isExecuting).toBe(false)
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores an older calculation that finishes with %s after the current one',
    async (outcome) => {
      const { result, rerender } = await act(async () =>
        renderHook(useCalculateKclExpression, {
          initialProps: hookProps,
        })
      )
      await waitFor(() => expect(pending.has('10')).toBe(true))
      rerender({ ...hookProps, value: '20' })
      await act(async () => pending.get('20')?.resolve(calculated('20')))

      await act(async () => {
        if (outcome === 'resolve') {
          pending.get('10')?.resolve(calculated('10'))
        } else {
          pending.get('10')?.reject(new Error('Old calculation failed'))
        }
      })

      expect(result.current.valueNode).toEqual(calculated('20').astNode)
      expect(result.current.calcResult).toBe('20')
      expect(result.current.isExecuting).toBe(false)
    }
  )

  it('clears an expression while its calculation is pending', async () => {
    const { result, rerender } = await act(async () =>
      renderHook(useCalculateKclExpression, {
        initialProps: hookProps,
      })
    )
    await waitFor(() => expect(pending.has('10')).toBe(true))
    rerender({ ...hookProps, value: '' })
    await act(async () => pending.get('10')?.resolve(calculated('10')))

    expect(result.current.valueNode).toBeNull()
    expect(result.current.calcResult).toBe('NAN')
    expect(result.current.isExecuting).toBe(false)
  })
})
