import type { FeatureHistory } from '@src/lib/featureTree/featureHistory'
import type { OperationTreeNode } from '@src/lib/featureTree/featureTreeOperationTree'
import { useRollbackTreeSnapshot } from '@src/lib/featureTree/useRollbackTreeSnapshot'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const code = 'a = 1\nb = 2\n'
const rolledBack = 'a = 1\nexit() // zds:rollback\nb = 2\n'
const history: FeatureHistory = {
  prefix: '',
  blocks: [],
  rollbackIndex: 2,
  code,
}
const operations: OperationTreeNode[] = ['first', 'second'].map(
  (name, index) => ({
    type: 'VariableDeclaration',
    name,
    value: { type: 'KclNone' },
    visibility: 'default',
    nodePath: { steps: [] },
    sourceRange: [index * 6, index * 6 + 5, 0],
  })
)
const initial = { file: { id: 0, path: 'main.kcl' }, code, history, operations }

describe('rollback tree snapshots', () => {
  it('keeps the complete timeline while live operations clear and stream back in', () => {
    const { result, rerender } = renderHook(useRollbackTreeSnapshot, {
      initialProps: initial,
    })
    act(() => result.current.beginRollback(rolledBack, 1))
    rerender({ ...initial, code: rolledBack, operations: [] })
    expect(result.current.active).toBe(true)
    expect(result.current.operations).toEqual(operations)
    expect(result.current.history.blocks).toBe(history.blocks)
    expect(result.current.history.rollbackIndex).toBe(1)
    const retained = result.current.operations
    rerender({
      ...initial,
      code: rolledBack,
      operations: operations.slice(0, 1),
    })
    expect(result.current.operations).toBe(retained)
    expect(result.current.operationsCode).toBe(code)
  })

  it('keeps the same source blocks and rows for repeated bar moves and restoration', () => {
    const { result, rerender } = renderHook(useRollbackTreeSnapshot, {
      initialProps: initial,
    })
    act(() => result.current.beginRollback(rolledBack, 1))
    rerender({ ...initial, code: rolledBack, operations: [] })
    const retained = result.current.operations
    act(() => result.current.beginRollback(code, 2))
    rerender(initial)
    expect(result.current.operations).toBe(retained)
    expect(result.current.history.blocks).toBe(history.blocks)
    expect(result.current.history.rollbackIndex).toBe(2)
  })

  it('invalidates the snapshot for an ordinary code edit or feature reorder', () => {
    const { result, rerender } = renderHook(useRollbackTreeSnapshot, {
      initialProps: initial,
    })
    act(() => result.current.beginRollback(rolledBack, 1))
    rerender({ ...initial, code: rolledBack })
    const changed = {
      ...initial,
      code: 'b = 2\na = 1\n',
      operations: operations.slice(0, 1),
    }
    rerender(changed)
    expect(result.current.active).toBe(false)
    expect(result.current.operations).toBe(changed.operations)
    rerender({ ...initial, code: rolledBack })
    expect(result.current.active).toBe(false)
  })

  it('invalidates the snapshot on a file switch even when code and project-local file IDs match', () => {
    const { result, rerender } = renderHook(useRollbackTreeSnapshot, {
      initialProps: initial,
    })
    act(() => result.current.beginRollback(rolledBack, 1))
    rerender({ ...initial, code: rolledBack })
    rerender({
      ...initial,
      file: { id: 0, path: 'main.kcl' },
      code: rolledBack,
      operations: [],
    })
    expect(result.current.active).toBe(false)
    expect(result.current.operations).toEqual([])
  })

  it('does not change normal execution before a rollback request', () => {
    const { result, rerender } = renderHook(useRollbackTreeSnapshot, {
      initialProps: initial,
    })
    rerender({ ...initial, operations: [] })
    expect(result.current.active).toBe(false)
    expect(result.current.operations).toEqual([])
  })
})
