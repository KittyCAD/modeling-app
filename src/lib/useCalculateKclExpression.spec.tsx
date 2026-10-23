import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { assertParse } from '@src/lang/wasm'
import * as kclHelpers from '@src/lib/kclHelpers'
import { useCalculateKclExpression } from '@src/lib/useCalculateKclExpression'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

const calculate = kclHelpers.getCalculatedKclExpressionValue

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useCalculateKclExpression calculation ownership', () => {
  const pending = new Map<string, ReturnType<typeof deferred>>()
  let world: Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
  let hookProps: Parameters<typeof useCalculateKclExpression>[0]

  beforeAll(async () => {
    world = await buildTheWorldAndNoEngineConnection()
  })

  afterAll(() => {
    world.commandBarActor.stop()
    world.settingsActor.stop()
    world.engineCommandManager.tearDown({
      route: 'user-requested',
      initiatedBy: 'client',
    })
  })

  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    pending.clear()
    // Control completion order while keeping parsing and evaluation real.
    vi.spyOn(kclHelpers, 'getCalculatedKclExpressionValue').mockImplementation(
      async (value, rustContext, options) => {
        let request = pending.get(value)
        if (!request) {
          request = deferred()
          pending.set(value, request)
        }
        await request.promise
        return calculate(value, rustContext, options)
      }
    )
    const code = '@settings(kclVersion = 3.0)\nanchor = 0'
    hookProps = {
      value: '10',
      code,
      ast: assertParse(code, world.instance),
      variables: {},
      selectionRanges: { graphSelections: [], otherSelections: [] },
      rustContext: world.rustContext,
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
    expect(result.current.valueNode).toBeNull()
    expect(result.current.calcResult).toBe('NAN')
    expect(result.current.isExecuting).toBe(true)
    await act(async () => pending.get('10')?.resolve())
    await waitFor(() =>
      expect(result.current.valueNode).toMatchObject({ raw: '10' })
    )

    snapshots.length = 0
    rerender({ ...hookProps, value: '20' })

    expect(snapshots.length).toBeGreaterThan(0)
    for (const snapshot of snapshots) {
      expect(snapshot.valueNode).toBeNull()
      expect(snapshot.isExecuting).toBe(true)
    }
    await act(async () => pending.get('20')?.resolve())
    await waitFor(() =>
      expect(result.current.valueNode).toMatchObject({ raw: '20' })
    )
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
      await act(async () => pending.get('20')?.resolve())
      await waitFor(() =>
        expect(result.current.valueNode).toMatchObject({ raw: '20' })
      )

      await act(async () => {
        if (outcome === 'resolve') {
          pending.get('10')?.resolve()
        } else {
          pending.get('10')?.reject(new Error('Old calculation failed'))
        }
      })

      expect(result.current.valueNode).toMatchObject({ raw: '20' })
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
    await act(async () => pending.get('10')?.resolve())

    expect(result.current.valueNode).toBeNull()
    expect(result.current.calcResult).toBe('NAN')
    expect(result.current.isExecuting).toBe(false)
  })
})
